import { randomBytes } from "node:crypto";
import { from, maybe, rpc, run, type Plan } from "@/server/db";
import { logger } from "@/server/logger";
import { initializeTransaction, verifyTransaction } from "./paystack";

export const appUrl = () => (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

export const listPaidPlans = () =>
  run<Plan[]>(from("Plan").select("*").eq("active", true).gt("priceCents", 0).order("priceCents", { ascending: true }));

/** Creates a pending transaction and a Paystack checkout; returns the URL to send the customer to. */
export async function startCheckout(input: { organizationId: string; email: string; planKey: string }) {
  const plan = await maybe<Plan>(from("Plan").select("*").eq("key", input.planKey).eq("active", true).maybeSingle());
  if (!plan || plan.priceCents <= 0) throw new Error("That plan can't be bought online. Contact support.");
  const reference = `wa_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
  await run(from("BillingTransaction").insert({ organizationId: input.organizationId, planId: plan.id, reference, amountCents: plan.priceCents, currency: plan.currency }));
  const init = await initializeTransaction({
    email: input.email, amountKobo: plan.priceCents, currency: plan.currency, reference,
    callbackUrl: `${appUrl()}/api/billing/verify`,
    metadata: { organizationId: input.organizationId, planKey: plan.key },
  });
  return { url: init.authorization_url, reference };
}

/**
 * Confirms a payment with Paystack (never trusts the browser or the webhook body alone) and activates the plan.
 * Idempotent: the database function locks the transaction row, so the webhook and the return page can both call this.
 */
export async function confirmPayment(reference: string) {
  const tx = await maybe<{ id: string; organizationId: string; currency: string }>(from("BillingTransaction").select("id, organizationId, currency").eq("reference", reference).maybeSingle());
  if (!tx) return { ok: false as const, error: "unknown_reference" };
  const v = await verifyTransaction(reference);
  if (v.status !== "success") {
    if (v.status === "failed" || v.status === "abandoned") await run(from("BillingTransaction").update({ status: "failed", gatewayPayload: v }).eq("id", tx.id).eq("status", "pending"));
    return { ok: false as const, error: `payment_${v.status}` };
  }
  if (v.currency !== tx.currency) return { ok: false as const, error: "currency_mismatch" };
  const r = await rpc<{ ok: boolean; error?: string; organizationId?: string; already?: boolean }>("app_activate_plan", { p_reference: reference, p_paid_kobo: v.amount, p_payload: v });
  if (!r.ok) logger.warn({ reference, error: r.error }, "plan activation refused");
  return r;
}

export const recentTransactions = (organizationId: string) =>
  run<{ id: string; reference: string; amountCents: number; status: string; createdAt: Date; paidAt: Date | null; plan: { name: string } }[]>(
    from("BillingTransaction").select("id, reference, amountCents, status, createdAt, paidAt, plan:Plan(name)").eq("organizationId", organizationId).order("createdAt", { ascending: false }).limit(10),
  );


