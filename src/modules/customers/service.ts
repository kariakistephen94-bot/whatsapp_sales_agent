import { from, maybe, rpc } from "@/server/db";

export const HIGH_VALUE_KOBO = 100_000_00; // ₦100,000 lifetime paid spend
const INACTIVE_DAYS = 60;

/** Recomputes lifetime value (paid orders + completed appointments) and status for one customer. */
export async function refreshCustomer(customerId: string) {
  // Looked up by id only (as before); the recompute itself is scoped to the customer's own organization.
  const c = await maybe<{ id: string; organizationId: string }>(from("Customer").select("id, organizationId").eq("id", customerId).maybeSingle());
  if (!c) return;
  // One statement in Postgres (app_refresh_customer): sums paid orders + completed visits and sets the status.
  await rpc("app_refresh_customer", { p_org: c.organizationId, p_customer: c.id, p_high_value: HIGH_VALUE_KOBO, p_inactive_days: INACTIVE_DAYS });
}

export const STATUS_LABEL: Record<string, string> = {
  new: "New", returning: "Returning", high_value: "High value", potential: "Potential", inactive: "Inactive",
};
