import { tenant, run, maybe, type Conversation, type Customer, type Message, type AiAgent, type Automation } from "@/server/db";
import { logger } from "@/server/logger";
import { followupQueue, type AiReplyJob } from "@/server/queue";
import { sendOutbound } from "@/modules/whatsapp/outbound";
import { incrementUsage, withinMonthlyLimit, serviceState } from "@/modules/billing/usage";
import { runAgent, aiConfigured, type ChatTurn } from "./engine";
import { notifyHandoff } from "@/modules/team/notify";
import { connectionManager } from "@/modules/whatsapp/manager";

/**
 * Worker handler for one inbound message. Debounced: if the customer sent more messages after this one,
 * only the job for the newest message replies (with all of them as context).
 */
export async function handleAiReply(job: AiReplyJob) {
  const { organizationId, conversationId, messageId } = job;
  const t = tenant(organizationId);
  const convo = await maybe<Conversation & { customer: Customer }>(t.from("Conversation").select("*, customer:Customer(*)").eq("id", conversationId).maybeSingle());
  if (!convo || convo.handler !== "AI" || convo.customer.optedOut) return { skipped: "not_ai_or_opted_out" };

  const newest = await maybe<{ id: string }>(t.from("Message").select("id").eq("conversationId", conversationId).eq("direction", "in").order("createdAt", { ascending: false }).limit(1).maybeSingle());
  if (newest && newest.id !== messageId) return { skipped: "newer_message_pending" };

  const agent = await maybe<AiAgent>(t.from("AiAgent").select("*").maybeSingle());
  if (!agent?.active) return { skipped: "agent_inactive" };
  if (!aiConfigured()) { logger.warn({ organizationId }, "OPENAI_API_KEY missing — AI reply skipped"); return { skipped: "ai_not_configured" }; }
  if (!(await serviceState(organizationId)).active) {
    await run(t.from("Conversation").update({ handler: "HUMAN", status: "escalated" }).eq("id", conversationId));
    const last = await maybe<{ body: string | null }>(t.from("Message").select("body").eq("id", messageId).maybeSingle());
    await notifyHandoff({ organizationId, conversationId, reason: "Your plan has ended, so the AI is paused. Renew in Billing to turn it back on.", lastMessage: last?.body }).catch((e) => logger.warn({ err: e }, "hand-off alert failed"));
    return { skipped: "subscription_inactive" };
  }
  if (!(await withinMonthlyLimit(organizationId, "aiMessagesMonthly", "ai_messages"))) {
    await run(t.from("Conversation").update({ handler: "HUMAN", status: "escalated" }).eq("id", conversationId));
    await run(t.from("AuditLog").insert({ action: "ai.limit_reached", entity: "conversation", entityId: conversationId }));
    const last = await maybe<{ body: string | null }>(t.from("Message").select("body").eq("id", messageId).maybeSingle());
    await notifyHandoff({ organizationId, conversationId, reason: "The AI's monthly message limit is reached, so a person needs to reply.", lastMessage: last?.body }).catch((e) => logger.warn({ err: e }, "hand-off alert failed"));
    return { skipped: "ai_limit_reached" };
  }

  // Fail BEFORE the agent runs when we can't send: a retry would otherwise re-run write tools (orders, bookings).
  const link = await maybe<{ status: string }>(t.from("WhatsappConnection").select("status").eq("id", convo.connectionId).maybeSingle());
  if (!connectionManager.get(convo.connectionId) || link?.status !== "connected") throw new Error("WhatsApp connection is not ready");

  const recent = await run<Message[]>(t.from("Message").select("*").eq("conversationId", conversationId).order("createdAt", { ascending: false }).limit(30));
  const history: ChatTurn[] = recent.reverse().filter((m) => m.body && m.sender !== "system" && !(m.direction === "out" && m.status === "failed")).map((m) => ({
    role: m.sender === "customer" ? "user" : "assistant",
    content: m.sender === "human" ? `[staff member replied] ${m.body}` : m.body!,
  }));
  if (!history.length || history[history.length - 1].role !== "user") return { skipped: "nothing_to_answer" };

  const result = await runAgent({ organizationId, customerId: convo.customerId, conversationId, history, dryRun: false });
  await incrementUsage(organizationId, "ai_messages");

  // Loop guard: don't send (nearly) the same message we sent a moment ago. The customer's new message should get a real
  // answer, so first try once more with a nudge; only hand over to a person if it still can't say anything new.
  const norm = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const similar = (a: string, b: string) => { const x = norm(a), y = norm(b); if (!x.size || !y.size) return false; let n = 0; x.forEach((w) => y.has(w) && n++); return n / Math.min(x.size, y.size) >= 0.9; };
  // Only the AI's latest message, and only if it was sent in the last 30 minutes: a "Hi" hours later may get the same greeting.
  const lastAi = [...recent].reverse().find((m) => m.direction === "out" && m.sender === "ai" && m.body && m.status !== "failed");
  const wrote = (tr: typeof result) => tr.tools.some((x) => ["create_order", "book_appointment", "reschedule_appointment", "cancel_appointment", "create_customer_followup", "update_customer_profile"].includes(x.name));
  const repeats = (tr: typeof result) => !!tr.reply && !tr.escalated && !wrote(tr) && !!lastAi && Date.now() - lastAi.createdAt.getTime() < 30 * 60_000 && similar(lastAi.body!, tr.reply);
  if (repeats(result)) {
    logger.warn({ organizationId, conversationId }, "AI reply repeated its last message: retrying once");
    const again = await runAgent({ organizationId, customerId: convo.customerId, conversationId, history, dryRun: false,
      extraSystem: `IMPORTANT: your draft reply repeated your previous message almost word for word. Reply to the customer's LATEST message specifically. Acknowledge what is new in it (for example a quantity: state the quantity and the total, price times quantity), then ask only for what is still missing, in different words. Do not repeat the earlier wording. If something is missing, ask for that one thing only.` });
    result.tokens += again.tokens;
    if (again.reply && !repeats(again)) { result.reply = again.reply; result.tools = again.tools; result.escalated = again.escalated; }
    else {
      logger.warn({ organizationId, conversationId }, "AI still repeating: handing over to a person");
      result.reply = "Let me get a member of our team to help you with this. They'll reply here shortly.";
      result.escalated = { reason: "The AI was about to repeat itself and couldn't make progress with this customer." };
    }
  }

  if (result.reply) {
    await sendOutbound({ organizationId, conversationId, sender: "ai", text: result.reply, meta: { tools: result.tools, model: result.model, tokens: result.tokens } });
  }
  if (result.escalated) {
    // Flip after the hand-off message is sent, so the AI's last words get through the handler lock.
    await run(t.from("Conversation").update({ handler: "HUMAN", status: "escalated" }).eq("id", conversationId));
    await run(t.from("AuditLog").insert({ action: "conversation.escalated", entity: "conversation", entityId: conversationId, meta: { reason: result.escalated.reason } }));
    const lastIn = [...history].reverse().find((h) => h.role === "user")?.content;
    await notifyHandoff({ organizationId, conversationId, reason: result.escalated.reason || "The AI handed this chat over.", lastMessage: lastIn }).catch((e) => logger.warn({ err: e }, "hand-off alert failed"));
  }

  // Abandoned-enquiry: they looked at items but nothing was ordered or booked in this turn.
  const browsed = result.tools.some((t) => t.name === "search_products" || t.name === "check_appointment_availability");
  const converted = result.tools.some((t) => ["create_order", "book_appointment"].includes(t.name) && (t.result as any)?.ok);
  if (browsed && !converted) {
    const auto = await maybe<Automation & { enabled: boolean }>(t.from("Automation").select("*").eq("key", "abandoned_enquiry").maybeSingle());
    if (auto?.enabled) {
      const delay = Math.max(60_000, Number((auto.config as any)?.offsetMinutes ?? 1440) * 60_000);
      const week = Math.floor(Date.now() / (7 * 864e5));
      await followupQueue().add("abandoned", { kind: "abandoned_enquiry", organizationId, customerId: convo.customerId, since: Date.now() }, { delay, jobId: `ab-${convo.customerId}-${week}` }).catch(() => {});
    }
  }
  return { replied: !!result.reply, tools: result.tools.map((t) => t.name), escalated: !!result.escalated };
}
