import "server-only";
import { DateTime } from "luxon";
import { count, rpc, run, tenant } from "@/server/db";

/**
 * Shared analytics queries. Every function takes the organizationId resolved from the session
 * (TenantContext) and filters by it explicitly — the app_analytics_* Postgres functions take it as a
 * parameter, so never pass an id that came from request input.
 *
 * Definitions (kept honest on purpose):
 *  - Revenue = PAID orders (by paidAt) + COMPLETED appointments valued at the service's listed price (by startsAt).
 *    Unpaid / pending orders never count.
 *  - AI-attributed revenue = paid orders created by the AI (createdByAi or inside a conversation)
 *    + completed appointments booked by the AI.
 */

export const TZ = "Africa/Lagos";

/** Start of the window: midnight (Lagos) `days - 1` days ago, so "7 days" = today + previous 6. */
export const rangeStart = (days: number) => DateTime.now().setZone(TZ).startOf("day").minus({ days: days - 1 });

/** Ordered day keys (yyyy-MM-dd, Lagos) for the window. */
export function dayKeys(days: number) {
  const start = rangeStart(days);
  return Array.from({ length: days }, (_, i) => start.plus({ days: i }));
}

export const dayLabel = (dt: DateTime, days: number) => (days <= 7 ? dt.toFormat("ccc") : dt.toFormat("d LLL"));

export interface DayRow {
  date: string; label: string;
  messagesIn: number; messagesOut: number; newCustomers: number; orders: number;
  orderRevenueKobo: number; appointmentRevenueKobo: number; aiRevenueKobo: number;
}

/** Per-day series for charts and CSV export. */
export async function dailySeries(organizationId: string, days: number): Promise<DayRow[]> {
  const start = rangeStart(days).toJSDate();
  const agg = await rpc<{
    day: string; messagesIn: number; messagesOut: number; newCustomers: number; orders: number;
    orderRevenueKobo: number; appointmentRevenueKobo: number; aiRevenueKobo: number;
  }[]>("app_analytics_daily", { p_org: organizationId, p_since: start.toISOString(), p_tz: TZ });

  const rows = new Map<string, DayRow>();
  for (const dt of dayKeys(days)) {
    const date = dt.toFormat("yyyy-MM-dd");
    rows.set(date, { date, label: dayLabel(dt, days), messagesIn: 0, messagesOut: 0, newCustomers: 0, orders: 0, orderRevenueKobo: 0, appointmentRevenueKobo: 0, aiRevenueKobo: 0 });
  }
  for (const g of agg ?? []) {
    const r = rows.get(g.day);
    if (!r) continue;
    r.messagesIn += Number(g.messagesIn); r.messagesOut += Number(g.messagesOut);
    r.newCustomers += Number(g.newCustomers); r.orders += Number(g.orders);
    r.orderRevenueKobo += Number(g.orderRevenueKobo); r.appointmentRevenueKobo += Number(g.appointmentRevenueKobo);
    r.aiRevenueKobo += Number(g.aiRevenueKobo);
  }
  return [...rows.values()];
}

/** Conversations with ≥1 AI message in the window, and how many had no human message. */
export async function aiResolution(organizationId: string, since: Date) {
  const [r] = await rpc<{ resolved: number; total: number }[]>("app_analytics_ai_resolution", { p_org: organizationId, p_since: since.toISOString() });
  return { resolved: r?.resolved ?? 0, total: r?.total ?? 0, rate: r?.total ? r.resolved / r.total : null };
}

/**
 * Average seconds from an inbound message to the AI's reply. Only inbound messages whose very next
 * non-inbound message is from the AI are counted (so bursts of customer messages count once, and
 * human replies are excluded).
 */
export async function avgAiResponseSeconds(organizationId: string, since: Date) {
  const [r] = await rpc<{ secs: number | null; n: number }[]>("app_analytics_avg_ai_response", { p_org: organizationId, p_since: since.toISOString() });
  return r?.n ? r.secs : null;
}

/** Funnel + conversion: customers who messaged in the window, how many ordered/booked, how many paid/completed. */
export async function funnel(organizationId: string, since: Date) {
  const [r] = await rpc<{ conversations: number; enquired: number; ordered: number; converted: number; paid: number }[]>(
    "app_analytics_funnel", { p_org: organizationId, p_since: since.toISOString() },
  );
  return {
    conversations: r?.conversations ?? 0, enquired: r?.enquired ?? 0, ordered: r?.ordered ?? 0, paid: r?.paid ?? 0,
    converted: r?.converted ?? 0,
  };
}

/** Customers with ≥2 purchases/visits ÷ customers with ≥1 (paid orders + completed appointments, all time). */
export async function retention(organizationId: string) {
  const [r] = await rpc<{ buyers: number; repeat: number }[]>("app_analytics_retention", { p_org: organizationId });
  const buyers = r?.buyers ?? 0, repeat = r?.repeat ?? 0;
  return { buyers, repeat, rate: buyers ? repeat / buyers : null };
}

/** Top items by revenue: paid order lines + completed appointments (service price). */
export async function revenueByItem(organizationId: string, since: Date, top = 6) {
  const totals = await rpc<{ name: string; kobo: number }[]>("app_analytics_revenue_by_item", { p_org: organizationId, p_since: since.toISOString() });
  const sorted = (totals ?? []).map((t) => [t.name, Number(t.kobo)] as [string, number]).sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, top - 1);
  const rest = sorted.slice(top - 1).reduce((s, [, v]) => s + v, 0);
  const out = (sorted.length <= top ? sorted : [...head, ["Other", rest] as [string, number]]).map(([name, kobo]) => ({ name, kobo }));
  return out.filter((x) => x.kobo > 0);
}

/** Distinct conversations handed to a human in the window (escalation audit log ∪ handler = HUMAN). */
export async function humanHandoffs(organizationId: string, since: Date) {
  return (await rpc<number>("app_analytics_handoffs", { p_org: organizationId, p_since: since.toISOString() })) ?? 0;
}

export const sumRevenue = (rows: DayRow[]) => ({
  orders: rows.reduce((s, r) => s + r.orderRevenueKobo, 0),
  appointments: rows.reduce((s, r) => s + r.appointmentRevenueKobo, 0),
  ai: rows.reduce((s, r) => s + r.aiRevenueKobo, 0),
});

/** Full analytics bundle for the analytics page. */
export async function analyticsSummary(organizationId: string, days: number) {
  const since = rangeStart(days).toJSDate();
  const sinceIso = since.toISOString(), nowIso = new Date().toISOString();
  const [series, resolution, avgResp, fun, ret, items, handoffs, newLeads, returning, followups, completed, noShow] = await Promise.all([
    dailySeries(organizationId, days),
    aiResolution(organizationId, since),
    avgAiResponseSeconds(organizationId, since),
    funnel(organizationId, since),
    retention(organizationId),
    revenueByItem(organizationId, since),
    humanHandoffs(organizationId, since),
    count(tenant(organizationId).from("Customer").select("id", { count: "exact", head: true }).gte("createdAt", sinceIso)),
    rpc<number>("app_analytics_returning", { p_org: organizationId, p_since: sinceIso }),
    count(tenant(organizationId).from("Followup").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sentAt", sinceIso)),
    count(tenant(organizationId).from("Appointment").select("id", { count: "exact", head: true }).eq("status", "completed").gte("startsAt", sinceIso).lte("startsAt", nowIso)),
    count(tenant(organizationId).from("Appointment").select("id", { count: "exact", head: true }).eq("status", "no_show").gte("startsAt", sinceIso).lte("startsAt", nowIso)),
  ]);
  const rev = sumRevenue(series);
  return {
    series, resolution, avgResponseSecs: avgResp, funnel: fun, retention: ret, revenueByItem: items, handoffs,
    newLeads, returningCustomers: returning ?? 0, followupsSent: followups,
    messagesIn: series.reduce((s, r) => s + r.messagesIn, 0), messagesOut: series.reduce((s, r) => s + r.messagesOut, 0),
    orders: series.reduce((s, r) => s + r.orders, 0),
    revenue: rev, totalRevenueKobo: rev.orders + rev.appointments,
    attendance: { completed, noShow, rate: completed + noShow ? completed / (completed + noShow) : null },
    conversionRate: fun.enquired ? fun.converted / fun.enquired : null,
  };
}

// ───────────── Overview ─────────────

const AUDIT_LABEL: Record<string, string> = {
  "org.created": "Workspace created",
  "onboarding.completed": "Onboarding completed",
  "invitation.accepted": "A team member joined",
  "conversation.escalated": "A conversation was handed to your team",
  "ai.limit_reached": "Monthly AI message limit reached",
  "settings.profile_updated": "Business profile updated",
  "settings.hours_updated": "Business hours updated",
  "agent.updated": "AI agent settings updated",
  "storefront.published": "Storefront published",
  "storefront.unpublished": "Storefront unpublished",
  "storefront.order": "New storefront order",
  "storefront.booking": "New storefront booking",
  "data.exported": "Workspace data exported",
};
export const auditLabel = (action: string) => AUDIT_LABEL[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export async function recentActivity(organizationId: string, limit = 8) {
  const db = tenant(organizationId);
  const [logs, msgs] = await Promise.all([
    run<{ id: string; action: string; createdAt: Date; meta: unknown }[]>(
      db.from("AuditLog").select("id, action, createdAt, meta").order("createdAt", { ascending: false }).limit(limit),
    ),
    run<{ id: string; body: string | null; createdAt: Date; conversationId: string; conversation: { customer: { name: string | null; phone: string } } }[]>(
      db.from("Message")
        .select("id, body, createdAt, conversationId, conversation:Conversation!inner(customer:Customer!inner(name, phone))")
        .eq("direction", "in").order("createdAt", { ascending: false }).limit(limit),
    ),
  ]);
  const items = [
    ...logs.map((l) => ({ id: `a-${l.id}`, text: auditLabel(l.action), at: l.createdAt, href: null as string | null })),
    ...msgs.map((m) => ({
      id: `m-${m.id}`,
      text: `${m.conversation.customer.name ?? m.conversation.customer.phone}: ${(m.body ?? "[media]").slice(0, 70)}`,
      at: m.createdAt, href: `/dashboard/conversations?c=${m.conversationId}`,
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
