import { from, run } from "@/server/db";
import { logger } from "@/server/logger";
import { serviceStateOf, GRACE_DAYS } from "./usage";

/** Marks subscriptions whose trial / paid period (+ grace) has ended as "expired", so the dashboard and admin show the truth. */
export async function billingSweep(now = new Date()) {
  const subs = await run<{ id: string; organizationId: string; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null }[]>(
    from("Subscription").select("id, organizationId, status, trialEndsAt, currentPeriodEnd").in("status", ["trialing", "active"]),
  );
  let expired = 0;
  for (const s of subs) {
    if (serviceStateOf({ ...s, plan: null }, now).status !== "expired") continue;
    try {
      await run(from("Subscription").update({ status: "expired" }).eq("id", s.id).eq("status", s.status));
      await run(from("AuditLog").insert({ organizationId: s.organizationId, action: "billing.expired", entity: "subscription", entityId: s.id, meta: { graceDays: GRACE_DAYS } }));
      expired++;
    } catch (e) { logger.warn({ subscriptionId: s.id, err: (e as Error).message }, "could not expire subscription"); }
  }
  if (expired) logger.info({ expired }, "subscriptions expired");
  return { expired };
}
