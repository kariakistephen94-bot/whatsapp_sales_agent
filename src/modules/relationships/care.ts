import { DateTime } from "luxon";
import { from, tenant, run, maybe, count, rpc, type Automation, type Customer, type Conversation, type Organization, type AiAgent } from "@/server/db";
import { logger } from "@/server/logger";
import { followupQueue, type FollowupJob } from "@/server/queue";
import { sendOutbound } from "@/modules/whatsapp/outbound";
import { getOrCreateConversation } from "@/modules/conversations/service";
import { renderTemplate } from "@/modules/automations/render";
import { serviceState, incrementUsage, withinMonthlyLimit } from "@/modules/billing/usage";
import { completeText, aiConfigured } from "@/modules/ai/engine";
import { careConfig, nudgeDecision, NUDGE_GAP_DAYS, NUDGE_STAGE, type CareConfig } from "./model";
import type { CareStage } from "@/server/queue";

type CareJob = Extract<FollowupJob, { kind: "customer_care" }>;
const hourIn = (tz: string, now: Date) => DateTime.fromJSDate(now, { zone: tz }).hour;
const inWindow = (cfg: CareConfig, tz: string, now: Date) => { const h = hourIn(tz, now); return h >= cfg.sendFromHour && h < cfg.sendToHour; };

/**
 * Hourly sweep (run by the worker). For every workspace with "Keep in touch with customers" switched on:
 *   1. recompute each customer's relationship (active / due / at risk / lapsed) from their orders and bookings,
 *   2. pick the customers who are due a nudge, within the daily cap and the allowed sending hours,
 *   3. queue one staggered job per customer (the job re-checks everything before sending).
 */
export async function runCareSweep(now = new Date()) {
  const autos = await run<(Automation & { organization: Pick<Organization, "id" | "timezone" | "status"> })[]>(
    from("Automation").select("*, organization:Organization(id, timezone, status)").eq("key", "customer_care").eq("enabled", true),
  );
  let queued = 0;

  // Keep every workspace's customer badges (active / due / at risk / lapsed) fresh, even those that never switch the automation on.
  const configured = new Map(autos.map((a) => [a.organizationId, careConfig(a.config).defaultCycleDays]));
  const orgs = await run<{ id: string }[]>(from("Organization").select("id").in("status", ["TRIAL", "ACTIVE"]));
  for (const o of orgs) {
    await rpc("app_refresh_relationships", { p_org: o.id, p_default_days: configured.get(o.id) ?? 30 })
      .catch((e) => logger.warn({ organizationId: o.id, err: (e as Error).message }, "relationship refresh failed"));
  }

  for (const a of autos) {
    const org = a.organization;
    try {
      if (!org || org.status === "SUSPENDED" || org.status === "CANCELLED") continue;
      const cfg = careConfig(a.config);
      if (!inWindow(cfg, org.timezone, now)) continue;
      if (!(await serviceState(org.id)).active) continue;
      const t = tenant(org.id);
      if (!(await count(t.from("WhatsappConnection").select("id", { count: "exact", head: true }).eq("status", "connected")))) continue;

      const dayStart = DateTime.fromJSDate(now, { zone: org.timezone }).startOf("day").toJSDate();
      const sentToday = await count(t.from("Customer").select("id", { count: "exact", head: true }).gte("lastNudgedAt", dayStart.toISOString()));
      const room = Math.min(cfg.dailyCap - sentToday, 15); // per hourly sweep, so the staggered sends finish inside the window
      if (room <= 0) continue;

      const rows = await run<Customer[]>(
        t.from("Customer").select("*").in("relationship", Object.keys(NUDGE_STAGE)).eq("optedOut", false).lt("nudgeCount", cfg.maxNudges)
          .or(`nextNudgeAt.is.null,nextNudgeAt.lte.${now.toISOString()}`).order("expectedNextAt", { ascending: true, nullsFirst: false }).limit(room * 3),
      );
      let n = 0;
      for (const c of rows) {
        if (n >= room) break;
        const d = nudgeDecision(c, cfg, now);
        if (!d.send) continue;
        // Spread sends out (45–120s apart) so the number doesn't blast a burst of messages.
        const delay = n * 45_000 + Math.floor(Math.random() * 75_000);
        const bucket = Math.floor(now.getTime() / (4 * 864e5));
        await followupQueue().add("care", { kind: "customer_care", organizationId: org.id, customerId: c.id, stage: d.stage, queuedAt: now.getTime() }, { delay, jobId: `care-${c.id}-${c.nudgeCount}-${bucket}`, attempts: 3 });
        n++; queued++;
      }
    } catch (e) {
      logger.error({ organizationId: org?.id, err: (e as Error).message }, "care sweep failed for workspace");
    }
  }
  return { workspaces: autos.length, queued };
}

const STAGE_GOAL: Record<CareStage, string> = {
  rebook: "They are about due for their usual visit/order. Gently invite them to book or reorder.",
  check_in: "It has been longer than usual since their last visit/order. Check in warmly and ask if they'd like to come again, without pressure.",
  win_back: "They haven't been in touch for a long time. Send a friendly, low-pressure message saying they're missed and the door is open.",
};

async function compose(args: { c: Customer; org: Organization; agent: AiAgent | null; cfg: CareConfig; stage: CareStage; usual: string[]; ai: boolean }) {
  const first = args.c.name?.trim().split(/\s+/)[0] || "";
  const days = args.c.lastPurchaseAt ? Math.floor((Date.now() - args.c.lastPurchaseAt.getTime()) / 864e5) : null;
  const vars = { name: first || "there", business: args.org.name, service: args.usual[0], item: args.usual[0], days: days != null ? String(days) : undefined };
  const fallback = renderTemplate(args.cfg.template, vars).replace(/\s{2,}/g, " ").trim();
  if (!args.ai) return { text: fallback, tokens: 0, aiWritten: false };
  try {
    const system = `You write ONE proactive WhatsApp message from the business "${args.org.name}" to a past customer, in the voice of its assistant${args.agent?.name ? ` "${args.agent.name}"` : ""}.
Tone: ${args.agent?.tone ?? "warm"}, ${args.agent?.formality ?? "neutral"}. Language: ${args.agent?.language && args.agent.language !== "en" ? args.agent.language : "English (Nigerian Pidgin only if the customer's notes suggest it)"}.
Rules: 1–3 short sentences. At most one emoji. Plain text. Address them by first name if known. Invite them to reply to book or order. Do NOT invent prices, discounts, offers, opening times or availability. Do NOT mention that you are tracking them or "our records". No pressure, no guilt. Output only the message.`;
    const user = JSON.stringify({
      goal: STAGE_GOAL[args.stage], firstName: first || null, daysSinceLastVisit: days, usualCycleDays: args.c.avgGapDays,
      usuallyGets: args.usual, customerNotes: args.c.notes?.slice(0, 300) ?? null, preferences: (args.c.preferences as any)?.notes?.slice?.(-4) ?? null,
    });
    const r = await completeText(system, user, { model: args.agent?.model || undefined, maxTokens: 160 });
    const text = r.text.replace(/^["“]|["”]$/g, "").trim();
    if (text.length >= 10 && text.length <= 600) return { text, tokens: r.tokens, aiWritten: true };
  } catch (e) { logger.warn({ err: (e as Error).message }, "AI nudge failed, using template"); }
  return { text: fallback, tokens: 0, aiWritten: false };
}

/** Runs one queued nudge: re-checks everything, writes the message (AI or template) and sends it. */
export async function handleCareNudge(job: CareJob) {
  const t = tenant(job.organizationId);
  const now = new Date();
  const [c, org, auto, agent] = await Promise.all([
    maybe<Customer>(t.from("Customer").select("*").eq("id", job.customerId).maybeSingle()),
    maybe<Organization>(from("Organization").select("*").eq("id", job.organizationId).maybeSingle()),
    maybe<Automation>(t.from("Automation").select("*").eq("key", "customer_care").maybeSingle()),
    maybe<AiAgent>(t.from("AiAgent").select("*").maybeSingle()),
  ]);
  if (!c || !org || !auto?.enabled) return { skipped: "disabled_or_gone" };
  if (org.status === "SUSPENDED" || org.status === "CANCELLED") return { skipped: "workspace_inactive" };
  if (!(await serviceState(org.id)).active) return { skipped: "subscription_inactive" };
  const cfg = careConfig(auto.config);
  if (!inWindow(cfg, org.timezone, now)) return { skipped: "outside_sending_hours" };

  const d = nudgeDecision(c, cfg, now);
  if (!d.send) return { skipped: d.reason };
  // They did something since this was queued: leave them alone.
  const sinceIso = new Date(job.queuedAt).toISOString();
  const [orders, upcoming] = await Promise.all([
    count(t.from("Order").select("id", { count: "exact", head: true }).eq("customerId", c.id).gte("createdAt", sinceIso)),
    count(t.from("Appointment").select("id", { count: "exact", head: true }).eq("customerId", c.id).eq("status", "booked").gt("startsAt", now.toISOString())),
  ]);
  if (orders || upcoming) return { skipped: "converted" };
  if (c.lastInteractionAt && c.lastInteractionAt.getTime() > job.queuedAt) return { skipped: "customer_replied" };

  const convo = await getOrCreateConversation(org.id, c.id);
  if (!convo) return { skipped: "no_whatsapp_connection" };
  const live = await maybe<Conversation>(t.from("Conversation").select("*").eq("id", convo.id).maybeSingle());
  if (live?.handler === "HUMAN" && now.getTime() - live.lastMessageAt.getTime() < 7 * 864e5) return { skipped: "human_handling" };

  const [orderRows, apptRows] = await Promise.all([
    run<{ items: { name: string }[] }[]>(t.from("Order").select("items:OrderItem(name)").eq("customerId", c.id).neq("status", "CANCELLED").order("createdAt", { ascending: false }).limit(3)),
    run<{ service: { name: string } }[]>(t.from("Appointment").select("service:CatalogItem(name)").eq("customerId", c.id).in("status", ["booked", "completed"]).lte("startsAt", now.toISOString()).order("startsAt", { ascending: false }).limit(3)),
  ]);
  const usual = [...new Set([...orderRows.flatMap((o) => o.items.map((i) => i.name)), ...apptRows.map((a) => a.service.name)])].slice(0, 4);

  const useAi = cfg.aiPersonalize && aiConfigured() && Boolean(agent) && (await withinMonthlyLimit(org.id, "aiMessagesMonthly", "ai_messages"));
  const msg = await compose({ c, org, agent, cfg, stage: d.stage, usual, ai: useAi });
  // The first proactive message a customer ever gets tells them how to opt out.
  const text = c.lastNudgedAt ? msg.text : `${msg.text}\n\nReply STOP anytime if you'd rather not hear from us.`;

  const r = await sendOutbound({ organizationId: org.id, conversationId: convo.id, sender: "system", text, meta: { care: d.stage, ai: msg.aiWritten } });
  if (!("sent" in r)) return r; // opted out / human took over meanwhile: not counted as a nudge

  // Bookkeeping must never make the job retry (that would send the message twice).
  try {
    await run(t.from("Customer").update({
      lastNudgedAt: now.toISOString(), nudgeCount: c.nudgeCount + 1,
      nextNudgeAt: new Date(now.getTime() + NUDGE_GAP_DAYS[d.stage] * 864e5).toISOString(),
    }).eq("id", c.id));
    await run(t.from("Followup").insert({ customerId: c.id, dueAt: now.toISOString(), reason: `care:${d.stage}`, message: text, conversationId: convo.id, status: "sent", sentAt: now.toISOString() }));
    await rpc("app_automation_sent", { p_org: org.id, p_automation_id: auto.id });
    if (msg.aiWritten) await incrementUsage(org.id, "ai_messages");
  } catch (e) { logger.error({ err: (e as Error).message, customerId: c.id }, "care nudge sent but bookkeeping failed"); }
  return { sent: true, stage: d.stage, ai: msg.aiWritten };
}
