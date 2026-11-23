import { maybe, rpc, tenant, type Json } from "@/server/db";

export type Limit = "whatsappConnections" | "aiMessagesMonthly" | "conversationsMonthly" | "teamMembers" | "products" | "automations" | "customers";
const period = () => new Date().toISOString().slice(0, 7);

export async function planLimits(organizationId: string): Promise<Record<Limit, number>> {
  const sub = await maybe<{ plan: { limits: Json } | null }>(
    tenant(organizationId).from("Subscription").select("plan:Plan(limits)").maybeSingle(),
  );
  const fallback = { whatsappConnections: 1, aiMessagesMonthly: 300, conversationsMonthly: 100, teamMembers: 2, products: 50, automations: 3, customers: 200 };
  return { ...fallback, ...((sub?.plan?.limits as any) ?? {}) };
}

export async function usage(organizationId: string, metric: string) {
  const row = await maybe<{ count: number }>(
    tenant(organizationId).from("UsageCounter").select("count").eq("metric", metric).eq("period", period()).maybeSingle(),
  );
  return row?.count ?? 0;
}

export async function incrementUsage(organizationId: string, metric: string, by = 1) {
  // Atomic upsert-and-increment in Postgres (no read-modify-write race).
  await rpc("app_increment_usage", { p_organization_id: organizationId, p_metric: metric, p_period: period(), p_by: by });
}

/** true if the org may use one more unit of this monthly metric (-1 = unlimited). */
export async function withinMonthlyLimit(organizationId: string, limit: Limit, metric: string) {
  const max = (await planLimits(organizationId))[limit];
  return max === -1 || (await usage(organizationId, metric)) < max;
}

export type ServiceState = {
  /** false once a trial or paid period has run out (after the grace period). */
  active: boolean;
  status: "trialing" | "active" | "grace" | "expired" | "none";
  planKey: string | null;
  planName: string | null;
  endsAt: Date | null;
  daysLeft: number | null;
};
export const GRACE_DAYS = 3;

/** Pure: derive the service state from a subscription row. */
export function serviceStateOf(sub: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; plan: { key: string; name: string } | null } | null, now = new Date()): ServiceState {
  if (!sub) return { active: true, status: "none", planKey: null, planName: null, endsAt: null, daysLeft: null };
  const base = { planKey: sub.plan?.key ?? null, planName: sub.plan?.name ?? null };
  const daysTo = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / 864e5);
  if (sub.status === "trialing") {
    const end = sub.trialEndsAt;
    if (!end || end > now) return { ...base, active: true, status: "trialing", endsAt: end, daysLeft: end ? daysTo(end) : null };
    return { ...base, active: false, status: "expired", endsAt: end, daysLeft: 0 };
  }
  if (sub.status === "active") {
    const end = sub.currentPeriodEnd;
    if (!end || end > now) return { ...base, active: true, status: "active", endsAt: end, daysLeft: end ? daysTo(end) : null };
    if (now.getTime() - end.getTime() < GRACE_DAYS * 864e5) return { ...base, active: true, status: "grace", endsAt: end, daysLeft: 0 };
    return { ...base, active: false, status: "expired", endsAt: end, daysLeft: 0 };
  }
  return { ...base, active: false, status: "expired", endsAt: sub.currentPeriodEnd ?? sub.trialEndsAt, daysLeft: 0 };
}

/** Is this workspace's trial / subscription still running? Gates the AI and every automated message. */
export async function serviceState(organizationId: string): Promise<ServiceState> {
  const sub = await maybe<{ status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; plan: { key: string; name: string } | null }>(
    tenant(organizationId).from("Subscription").select("status, trialEndsAt, currentPeriodEnd, plan:Plan(key, name)").maybeSingle(),
  );
  return serviceStateOf(sub);
}
