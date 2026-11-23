import OpenAI from "openai";
import { DateTime } from "luxon";
import { formatNaira } from "@/lib/locale";
import { from, tenant, run, maybe, must, count, type Organization, type AiAgent, type Customer } from "@/server/db";
import { getIndustry, toolsForCapabilities, type AiTool } from "@/modules/industries/templates";
import { asHours, describeHours, DEFAULT_HOURS } from "@/modules/appointments/hours";
import { retrieveKnowledge } from "./knowledge";
import { TOOL_DEFS, executeTool, type ToolContext } from "./tools";
import { relationshipBlock } from "@/modules/relationships/context";

export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface ToolTrace { name: string; args: unknown; result: unknown }
export interface AgentResult { reply: string; tools: ToolTrace[]; escalated: { reason: string } | null; model: string; tokens: number }

let client: OpenAI | null = null;
export const aiConfigured = () => Boolean(process.env.OPENAI_API_KEY);
function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

/** One-shot text completion (no tools). Used for proactive messages. */
export async function completeText(system: string, user: string, opts: { model?: string; maxTokens?: number; temperature?: number; json?: boolean } = {}) {
  const res = await openai().chat.completions.create({
    model: opts.model || process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini", temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? 200,
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  });
  return { text: (res.choices[0].message.content ?? "").trim(), tokens: res.usage?.total_tokens ?? 0 };
}

const LENGTH: Record<string, string> = { short: "1–2 short sentences", medium: "2–4 sentences", long: "up to 6 sentences when needed" };

async function buildSystemPrompt(organizationId: string, customerId: string | null, lastUserText: string, tools: AiTool[]) {
  const t0 = tenant(organizationId);
  const [orgRow, agentRow, staffMembers] = await Promise.all([
    must<Organization>(from("Organization").select("*").eq("id", organizationId).single()),
    maybe<AiAgent>(t0.from("AiAgent").select("*").maybeSingle()),
    run<{ id: string; name: string; role: string | null }[]>(t0.from("StaffMember").select("id, name, role").eq("active", true)),
  ]);
  const org = { ...orgRow, staffMembers };
  const agent = agentRow!;
  const t = getIndustry(org.industryTemplateKey);
  const knowledge = await retrieveKnowledge(organizationId, lastUserText);
  // Live catalogue: the model sees what is really on sale, so it never mistakes the business's short description for the full range.
  const items = await run<{ id: string; name: string; kind: string; priceCents: number; category: string | null; trackInventory: boolean; stock: number | null }[]>(
    t0.from("CatalogItem").select("id, name, kind, priceCents, category, trackInventory, stock").eq("active", true).order("name", { ascending: true }).limit(60),
  );
  const STOP = new Set(["the", "you", "your", "and", "for", "are", "any", "have", "has", "sell", "does", "do", "can", "how", "much", "what", "price", "want", "need", "get", "see", "there", "this", "that", "with", "store", "shop", "please", "pls", "i", "me", "do", "is", "it", "in", "on", "a", "an", "of", "to", "my", "we", "us"]);
  const qwords = lastUserText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const hit = (i: { name: string; category: string | null }) => qwords.some((w) => `${i.name} ${i.category ?? ""}`.toLowerCase().includes(w.length > 4 ? w.slice(0, -1) : w));
  const matches = qwords.length ? items.filter(hit) : [];
  const fmtItem = (i: (typeof items)[number]) => `${i.name} [id ${i.id}] — ${i.kind === "SERVICE" ? "service" : "product"}, ${formatNaira(i.priceCents / 100)}${i.trackInventory ? (i.stock ?? 0) > 0 ? "" : ", OUT OF STOCK" : ""}`;
  const catalogueBlock = items.length
    ? `\nCATALOGUE (live, everything currently on sale; this is the full range even if the description above mentions only one kind of thing):\n${items.slice(0, 40).map((i) => `- ${fmtItem(i)}`).join("\n")}${items.length > 40 ? "\n- …more: use search_products" : ""}\n${matches.length ? `The customer's latest message matches: ${matches.map((m) => m.name).join(", ")}. These ARE sold here. Do NOT say the business doesn't sell them or that it's off-topic.\n` : ""}`
    : "";
  const ops = (org.operations ?? {}) as Record<string, unknown>;
  const policies = Object.entries(ops).filter(([k, v]) => typeof v === "string" && /polic|deliver|pickup|warranty|return|describe/i.test(k) && v).map(([k, v]) => `- ${k}: ${v}`);

  let customerBlock = "This is a test chat in the dashboard playground (no real customer).";
  if (customerId) {
    const cust = await maybe<Customer>(t0.from("Customer").select("*").eq("id", customerId).maybeSingle());
    const c = cust && await (async () => {
      const [appointments, orders, appts] = await Promise.all([
        run<{ id: string; startsAt: Date; service: { name: string }; staff: { name: string } | null }[]>(
          t0.from("Appointment").select("id, startsAt, service:CatalogItem(name), staff:StaffMember(name)")
            .eq("customerId", cust.id).eq("status", "booked").gt("startsAt", new Date().toISOString()).limit(3),
        ),
        count(t0.from("Order").select("*", { count: "exact", head: true }).eq("customerId", cust.id)),
        count(t0.from("Appointment").select("*", { count: "exact", head: true }).eq("customerId", cust.id)),
      ]);
      return { ...cust, appointments, _count: { orders, appointments: appts } };
    })();
    if (c) {
      const upcoming = c.appointments.map((a) => `${a.service.name}${a.staff ? ` with ${a.staff.name}` : ""} on ${DateTime.fromJSDate(a.startsAt, { zone: org.timezone }).toFormat("ccc d LLL, h:mm a")} (id ${a.id})`);
      customerBlock = [
        `Customer: ${c.name ?? "name unknown (ask naturally if useful)"} · WhatsApp ${c.phone}`,
        `Returning customer: ${c._count.orders + c._count.appointments > 0 ? "yes" : "no — this may be their first contact"}`,
        c.preferences ? `Saved preferences: ${JSON.stringify((c.preferences as any).notes ?? c.preferences)}` : "",
        c.notes ? `Staff notes: ${c.notes}` : "",
        upcoming.length ? `Upcoming: ${upcoming.join("; ")}` : "",
        await relationshipBlock(t0, c, org.timezone),
      ].filter(Boolean).join("\n");
    }
  }

  const now = DateTime.now().setZone(org.timezone);
  return `You are ${agent.name}, the WhatsApp assistant for ${org.name}, a ${t.label.toLowerCase()} business${org.city ? ` in ${org.city}` : ""}, ${org.country ?? "Nigeria"}.
${org.description ? `About the business: ${org.description}\n` : ""}${org.businessType ? `What they offer: ${org.businessType}\n` : ""}
Personality: ${agent.personality}. Tone: ${agent.tone}. Formality: ${agent.formality}. Sales approach: ${agent.salesStrategy ?? "consultative"}.
Reply in ${agent.language === "en" ? "English" : agent.language}${agent.language === "English" || agent.language === "en" ? " (switch to Nigerian Pidgin, Yoruba, Igbo or Hausa if the customer writes in it)" : ""}. Length: ${LENGTH[agent.responseLength] ?? LENGTH.medium}. This is WhatsApp: plain text, no markdown headings, at most one emoji.
${agent.greeting ? `When greeting a new customer, use this greeting: "${agent.greeting}"` : ""}

Current date and time: ${now.toFormat("cccc d LLLL yyyy, h:mm a")} (${org.timezone}). Currency: Naira (₦).
Calendar for the next 14 days. ALWAYS take dates from this list, never calculate them: ${Array.from({ length: 14 }, (_, i) => { const d = now.plus({ days: i }); return `${i === 0 ? "today " : i === 1 ? "tomorrow " : ""}${d.toFormat("cccc d LLL")} = ${d.toISODate()}`; }).join("; ")}.
Business hours: ${describeHours(asHours(org.businessHours) ?? DEFAULT_HOURS)}.${catalogueBlock}
${org.staffMembers.length ? `Staff: ${org.staffMembers.map((s) => `${s.name}${s.role ? ` (${s.role})` : ""} [id ${s.id}]`).join(", ")}` : ""}
${org.address ? `Address: ${org.address}` : ""}${org.phone ? `\nBusiness phone: ${org.phone}` : ""}

RULES — follow strictly:
1. Never invent prices, stock, availability, delivery fees, policies or opening times. Get prices/items from search_products, times from check_appointment_availability, and facts from the verified knowledge below. If you don't have it, say you'll check with the team and use escalate_to_human.
2. Never say an order, booking, cancellation or payment is done unless the tool result says ok: true. If a tool fails, say so honestly and offer an alternative.
3. Orders are created UNPAID. Never say payment was received. If asked how to pay: when send_payment_link is available, call it to send the customer a secure Paystack link (do it right after create_order succeeds, without being asked), otherwise use the payment info in the knowledge below, and if there is none, escalate.
4. Confirm details (item, quantity, date, time) with the customer before calling create_order or book_appointment.
5. Escalate to a human for complaints, refunds, angry customers, or when the customer asks for a person.
6. Use the customer's saved information naturally; don't recite it.
6b. THE CATALOGUE IS THE TRUTH ABOUT WHAT ${org.name} SELLS, not the short description above (which may be incomplete). Whenever a customer asks whether the business sells, has or offers ANY item, product, service or price, call search_products FIRST, even if it doesn't sound like what the business usually sells. Only say it isn't available after search_products returns no match, and then say that plainly and offer what is available. Never refuse a buying or booking question as "off-topic" without searching.
7. STAY ON THE BUSINESS. You only discuss ${org.name} and what it offers: products/services, prices, availability, orders, bookings, delivery, payments, policies, opening hours, location and the customer's own orders and appointments. You are not a general chat companion.
8. Off-topic messages (only things that have nothing to do with buying, booking or the business, such as sports, politics, news, entertainment, personal advice, jokes, trivia, coding, homework, anything unrelated to the business): do NOT discuss it, share opinions, ask about it, or ask follow-up questions about it. Reply with one short, friendly sentence that you can only help with ${org.name}, then offer one concrete thing you can help with (for example a product, a booking or an order). If they stay off-topic a second time, say once, politely, that you can only help with ${org.name} and that they can message anytime they need that, and then stop trying to chat. After that, keep any further off-topic reply to a few words and never repeat the same sentence.
9. NO CYCLES. Never ask small-talk questions ("how's your day going?", "what are you up to?"). Never repeat a question or an offer you already made in this chat, and never reply with the same idea in different words. Read the earlier assistant messages: if you already asked something and the customer did not answer it, do not ask it again; either move forward with what you know, give a clear next step, or use escalate_to_human. Every reply must move the customer one step closer to getting help with the business.
10. A short greeting or thanks is fine; answer it in a few words and invite them to say what they need.
11. When a customer asks to see an item or what it looks like, call send_item_photos with its itemId (if it has photos), then add one short line. If it has no photo, say so and describe it from the catalogue.
${agent.instructions ? `\nBusiness instructions from the owner:\n${agent.instructions}\n` : ""}
${customerBlock}

Verified knowledge:
${knowledge.length ? knowledge.map((k) => `### ${k.title}\n${k.content}`).join("\n\n") : "(none added yet)"}
${policies.length ? `\nPolicies from setup:\n${policies.join("\n")}` : ""}

Tools available: ${tools.join(", ")}.`;
}

/**
 * Runs one agent turn: prompt + tools loop (max 6 tool rounds). Tools hit the real backend;
 * in dryRun (playground) write tools are simulated.
 */
export async function runAgent(input: {
  organizationId: string; customerId: string | null; conversationId: string | null; history: ChatTurn[]; dryRun: boolean; extraSystem?: string;
}): Promise<AgentResult> {
  const [orgRow, agent] = await Promise.all([
    must<{ timezone: string; capabilities: string[] }>(from("Organization").select("timezone, capabilities").eq("id", input.organizationId).single()),
    maybe<{ enabledTools: string[] | null; model: string | null }>(tenant(input.organizationId).from("AiAgent").select("enabledTools, model").maybeSingle()),
  ]);
  const org = { ...orgRow, agent: agent ? { ...agent, enabledTools: agent.enabledTools ?? [] } : null };
  const allowed = toolsForCapabilities(org.capabilities);
  const enabled = org.agent?.enabledTools?.length ? allowed.filter((t) => org.agent!.enabledTools.includes(t)) : allowed;
  if (enabled.includes("send_payment_link") && !(await (await import("@/modules/payments/service")).paymentsEnabled(input.organizationId))) enabled.splice(enabled.indexOf("send_payment_link"), 1);
  if (!enabled.includes("escalate_to_human")) enabled.push("escalate_to_human"); // always possible to hand off

  const lastUser = [...input.history].reverse().find((h) => h.role === "user")?.content ?? "";
  const system = (await buildSystemPrompt(input.organizationId, input.customerId, input.history.slice(-4).map((h) => h.content).join(" ") || lastUser, enabled)) + (input.extraSystem ? `\n\n${input.extraSystem}` : "");
  const model = org.agent?.model || process.env.OPENAI_DEFAULT_MODEL || "gpt-4o-mini";
  const ctx: ToolContext = { organizationId: input.organizationId, customerId: input.customerId, conversationId: input.conversationId, timezone: org.timezone, dryRun: input.dryRun };

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: system }, ...input.history.slice(-24)];
  const trace: ToolTrace[] = [];
  let tokens = 0;

  for (let round = 0; round < 7; round++) {
    const res = await openai().chat.completions.create({
      model, messages, temperature: 0.4, max_tokens: 500,
      tools: enabled.map((t) => TOOL_DEFS[t]), tool_choice: round === 6 ? "none" : "auto",
    });
    tokens += res.usage?.total_tokens ?? 0;
    const msg = res.choices[0].message;
    if (!msg.tool_calls?.length) {
      return { reply: (msg.content ?? "").trim(), tools: trace, escalated: ctx.escalated ?? null, model, tokens };
    }
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      if (call.type !== "function") continue;
      const result = await executeTool(call.function.name, call.function.arguments, ctx);
      trace.push({ name: call.function.name, args: safeParse(call.function.arguments), result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return { reply: "Let me check with the team and get back to you shortly.", tools: trace, escalated: ctx.escalated ?? { reason: "Agent could not finish" }, model, tokens };
}

const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return s; } };
