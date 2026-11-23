import { from, tenant, run, maybe, must, isUniqueViolation, type Conversation, type Customer } from "@/server/db";
import { logger } from "@/server/logger";
import { aiReplyQueue, outboundQueue } from "@/server/queue";
import type { InboundMessage, StatusUpdate } from "./types";

const OPT_OUT = new Set(["stop", "stopall", "unsubscribe", "optout"]); // "cancel" / "end" are common in bookings and orders, so they are NOT opt-outs
const OPT_IN = new Set(["start", "subscribe", "unstop"]);
const RANK: Record<string, number> = { queued: 0, failed: 0, sent: 1, delivered: 2, read: 3 };

/**
 * Inbound pipeline: dedupe -> customer upsert -> conversation -> persist -> (opt-out | AI queue).
 * Idempotent: the (organizationId, externalId) unique key drops duplicate deliveries.
 */
export async function handleInbound(connectionId: string, m: InboundMessage) {
  const conn = await maybe<{ organizationId: string; organization: { status: string } }>(
    from("WhatsappConnection").select("organizationId, organization:Organization(status)").eq("id", connectionId).maybeSingle(),
  );
  if (!conn || conn.organization.status === "SUSPENDED" || conn.organization.status === "CANCELLED") return;
  const organizationId = conn.organizationId;
  const t = tenant(organizationId);

  // Team members messaging the business number (e.g. replying to an alert) are not customers:
  // no customer record, no conversation, no AI reply.
  const teammate = await maybe<{ id: string }>(t.from("Membership").select("id").eq("phone", m.from).limit(1).maybeSingle());
  if (teammate) { logger.info({ organizationId, membershipId: teammate.id }, "message from a team member's number ignored"); return; }

  // Customer upsert on (organizationId, phone): create with name/consent, otherwise only touch lastInteractionAt.
  await run(t.from("Customer").upsert(
    { phone: m.from, name: m.fromName ?? null, lastInteractionAt: m.timestamp.toISOString(), consentAt: new Date().toISOString() },
    { onConflict: "organizationId,phone", ignoreDuplicates: true },
  ));
  const customer = await must<Customer>(
    t.from("Customer").update({ lastInteractionAt: m.timestamp.toISOString() }).eq("phone", m.from).select("*").single(),
  );
  // They wrote to us: the care sequence starts over (we never nudge someone who is talking to us).
  if (customer.nudgeCount > 0) await run(t.from("Customer").update({ nudgeCount: 0, nextNudgeAt: null }).eq("id", customer.id));
  if (!customer.name && m.fromName) await run(t.from("Customer").update({ name: m.fromName }).eq("id", customer.id));

  // One thread per customer: reuse the latest conversation and reopen it if it was resolved.
  let convo = await maybe<Conversation>(
    t.from("Conversation").select("*").eq("customerId", customer.id).order("lastMessageAt", { ascending: false }).limit(1).maybeSingle(),
  );
  if (convo?.status === "resolved") {
    convo = await must<Conversation>(t.from("Conversation").update({ status: "open", connectionId }).eq("id", convo.id).select("*").single());
  }
  convo ??= await must<Conversation>(t.from("Conversation").insert({ customerId: customer.id, connectionId }).select("*").single());

  let msgId: string;
  try {
    const row = await must<{ id: string }>(t.from("Message").insert({
      conversationId: convo.id, externalId: m.externalId, direction: "in", sender: "customer",
      body: m.text ?? null, mediaType: m.mediaType ?? null, status: "delivered", createdAt: m.timestamp.toISOString(),
    }).select("id").single());
    msgId = row.id;
  } catch (e) {
    if (isUniqueViolation(e)) return; // duplicate delivery
    throw e;
  }
  await run(t.from("Conversation").update({ lastMessageAt: m.timestamp.toISOString() }).eq("id", convo.id));

  // Messaging-policy compliance: STOP / START keywords.
  const word = m.text?.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (word && OPT_OUT.has(word)) {
    await run(t.from("Customer").update({ optedOut: true }).eq("id", customer.id));
    await outboundQueue().add("send", { organizationId, conversationId: convo.id, sender: "system", text: "You've been unsubscribed and won't receive further automated messages. Reply START to opt back in.", meta: { optOutConfirmation: true } }, { jobId: `optout-${msgId}` });
    return;
  }
  if (word && OPT_IN.has(word)) {
    await run(t.from("Customer").update({ optedOut: false }).eq("id", customer.id));
  }

  // Human takeover: the AI stays silent until a human explicitly resumes it.
  if (convo.handler !== "AI") return;
  const agent = await maybe<{ active: boolean }>(t.from("AiAgent").select("active").maybeSingle());
  if (!agent?.active) return;
  await aiReplyQueue().add("reply", { organizationId, conversationId: convo.id, messageId: msgId }, { jobId: `ai-${msgId}`, delay: 1500 }); // short delay batches rapid-fire messages
  logger.debug({ organizationId, conversationId: convo.id }, "queued AI reply");
}

export async function handleStatus(connectionId: string, u: StatusUpdate) {
  const lower = Object.entries(RANK).filter(([, r]) => r < RANK[u.status]).map(([s]) => s);
  if (!lower.length) return;
  // Only messages on this connection's conversations; the status re-check keeps updates monotonic.
  // A receipt names the message only; an empty connectionId means "whichever connection owns it" (gateway receipts).
  let q = from("Message").select("id, conversation:Conversation!inner(connectionId)")
    .eq("externalId", u.externalId).eq("direction", "out").in("status", lower);
  if (connectionId) q = q.eq("conversation.connectionId", connectionId);
  const rows = await run<{ id: string }[]>(q);
  if (!rows.length) return;
  await run(from("Message").update({ status: u.status }).in("id", rows.map((r) => r.id)).in("status", lower));
}
