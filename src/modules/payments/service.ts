import { randomBytes } from "node:crypto";
import { from, tenant, run, maybe, type Order, type OrderPayment, type PaymentConfig, type Customer } from "@/server/db";
import { encrypt, decrypt } from "@/server/crypto";
import { logger } from "@/server/logger";
import { formatNaira } from "@/lib/locale";
import { outboundQueue } from "@/server/queue";
import { appUrl } from "@/modules/billing/service";
import { markOrderPaid } from "@/modules/orders/service";
import { getOrCreateConversation } from "@/modules/conversations/service";
import { checkSecretKey, initializeForBusiness, keyMode, verifyForBusiness } from "./paystack";

export type PaymentStatus = { connected: boolean; mode?: "live" | "test"; publicKey?: string; secretHint?: string };

/** What the settings page may show: never the secret key. */
export async function paymentStatus(organizationId: string): Promise<PaymentStatus> {
  const c = await maybe<PaymentConfig>(tenant(organizationId).from("PaymentConfig").select("*").maybeSingle());
  if (!c) return { connected: false };
  return { connected: true, mode: c.mode === "live" ? "live" : "test", publicKey: c.publicKey };
}

export const paymentsEnabled = async (organizationId: string) => (await paymentStatus(organizationId)).connected;

async function secretFor(organizationId: string): Promise<string | null> {
  const c = await maybe<PaymentConfig>(tenant(organizationId).from("PaymentConfig").select("*").maybeSingle());
  if (!c) return null;
  try { return decrypt(c.secretEncrypted); } catch { logger.error({ organizationId }, "could not decrypt the business's Paystack key"); return null; }
}

/** Check both keys with Paystack, then store the secret encrypted. Returns an error message for the owner, or null. */
export async function savePaymentKeys(organizationId: string, publicKey: string, secretKey: string): Promise<string | null> {
  const pk = publicKey.trim(), sk = secretKey.trim();
  const pm = keyMode(pk), sm = keyMode(sk);
  if (!pk.startsWith("pk_") || !pm) return "That doesn't look like a Paystack public key. It starts with pk_live_ or pk_test_.";
  if (!sk.startsWith("sk_") || !sm) return "That doesn't look like a Paystack secret key. It starts with sk_live_ or sk_test_.";
  if (pm !== sm) return `One key is ${pm} and the other is ${sm}. Use both from the same mode.`;
  if (!(await checkSecretKey(sk))) return "Paystack rejected the secret key. Copy it again from Paystack → Settings → API Keys.";
  await run(from("PaymentConfig").upsert({ organizationId, provider: "paystack", publicKey: pk, secretEncrypted: encrypt(sk), mode: sm, updatedAt: new Date().toISOString() }, { onConflict: "organizationId" }));
  return null;
}

export const removePaymentKeys = (organizationId: string) => run(tenant(organizationId).from("PaymentConfig").delete());

/** Return the pending payment link for an order, or create one. Throws a message that is safe to tell the AI. */
export async function createPaymentLink(organizationId: string, orderId: string): Promise<{ url: string; amountCents: number; number: number }> {
  const t = tenant(organizationId);
  const secret = await secretFor(organizationId);
  if (!secret) throw new Error("Online payment isn't set up for this business.");
  const order = await maybe<Order & { customer: Customer }>(t.from("Order").select("*, customer:Customer(*)").eq("id", orderId).maybeSingle());
  if (!order) throw new Error("Order not found.");
  if (order.paymentStatus === "PAID") throw new Error("This order is already paid.");
  if (order.status === "CANCELLED") throw new Error("This order was cancelled.");
  if (order.totalCents <= 0) throw new Error("This order has nothing to pay.");

  // Reuse a link made in the last 12 hours for the same amount, so repeats don't create a pile of references.
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const existing = await maybe<OrderPayment>(t.from("OrderPayment").select("*").eq("orderId", order.id).eq("status", "pending").eq("amountCents", order.totalCents).gte("createdAt", since).order("createdAt", { ascending: false }).limit(1).maybeSingle());
  if (existing?.authorizationUrl) return { url: existing.authorizationUrl, amountCents: order.totalCents, number: order.number };

  const reference = `ord_${order.number}_${Date.now().toString(36)}_${randomBytes(5).toString("hex")}`;
  const digits = order.customer.phone.replace(/\D/g, "");
  const email = order.customer.email || `customer-${digits || "anon"}@example.com`; // Paystack needs one; the customer's own is used when we have it
  const init = await initializeForBusiness(secret, {
    email, amountKobo: order.totalCents, currency: order.currency || "NGN", reference,
    callbackUrl: `${appUrl()}/api/pay/return`, metadata: { orderId: order.id, organizationId, orderNumber: order.number },
  });
  await run(t.from("OrderPayment").insert({ orderId: order.id, reference, amountCents: order.totalCents, currency: order.currency || "NGN", authorizationUrl: init.authorization_url }));
  return { url: init.authorization_url, amountCents: order.totalCents, number: order.number };
}

/**
 * Confirm a payment with Paystack itself (never trusting the browser or a webhook body), mark the order paid and tell the customer.
 * Idempotent: only the call that flips the payment row from pending acts.
 */
export async function confirmOrderPayment(reference: string): Promise<{ ok: boolean; status: "paid" | "pending" | "failed" | "unknown"; orderNumber?: number; business?: string }> {
  const pay = await maybe<OrderPayment & { order: { number: number } }>(from("OrderPayment").select("*, order:Order(number)").eq("reference", reference).maybeSingle());
  if (!pay) return { ok: false, status: "unknown" };
  const orgId = pay.organizationId;
  const org = await maybe<{ name: string }>(from("Organization").select("name").eq("id", orgId).maybeSingle());
  const base = { orderNumber: pay.order.number, business: org?.name };
  if (pay.status === "success") return { ok: true, status: "paid", ...base };
  const secret = await secretFor(orgId);
  if (!secret) return { ok: false, status: "unknown", ...base };

  const v = await verifyForBusiness(secret, reference);
  if (v.status !== "success") {
    if (v.status === "failed" || v.status === "abandoned") await run(from("OrderPayment").update({ status: "failed" }).eq("id", pay.id).eq("status", "pending"));
    return { ok: false, status: v.status === "failed" ? "failed" : "pending", ...base };
  }
  if (v.amount < pay.amountCents || v.currency !== pay.currency) {
    logger.warn({ reference, paid: v.amount, expected: pay.amountCents }, "payment amount or currency doesn't match the order");
    await run(from("OrderPayment").update({ status: "failed" }).eq("id", pay.id).eq("status", "pending"));
    return { ok: false, status: "failed", ...base };
  }
  const flipped = await run<{ id: string }[]>(from("OrderPayment").update({ status: "success", paidAt: new Date().toISOString() }).eq("id", pay.id).neq("status", "success").select("id"));
  if (!flipped.length) return { ok: true, status: "paid", ...base }; // a concurrent call already handled it
  const order = await markOrderPaid(orgId, pay.orderId, "paystack");
  if (order) {
    const convo = await getOrCreateConversation(orgId, order.customerId).catch(() => null);
    if (convo) {
      await outboundQueue().add("send", { organizationId: orgId, conversationId: convo.id, sender: "system", text: `✅ Payment received: ${formatNaira(pay.amountCents / 100)} for order #${pay.order.number}. Thank you! We'll be in touch about your order.` }, { jobId: `paid-${pay.id}` }).catch((e) => logger.warn({ err: e }, "couldn't queue payment confirmation"));
    }
  }
  return { ok: true, status: "paid", ...base };
}

/** The business whose Paystack account owns this payment reference (for webhook signature checks). */
export async function secretForReference(reference: string): Promise<{ organizationId: string; secret: string } | null> {
  const p = await maybe<{ organizationId: string }>(from("OrderPayment").select("organizationId").eq("reference", reference).maybeSingle());
  if (!p) return null;
  const secret = await secretFor(p.organizationId);
  return secret ? { organizationId: p.organizationId, secret } : null;
}
export { secretFor as secretForOrg };

/** Safety net for payments whose webhook never arrived and whose customer closed the page: check recent pending ones. */
export async function paymentSweep() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = await run<{ reference: string }[]>(from("OrderPayment").select("reference").eq("status", "pending").gte("createdAt", since).lt("createdAt", new Date(Date.now() - 60_000).toISOString()).limit(30));
  let paid = 0;
  for (const r of rows) {
    try { if ((await confirmOrderPayment(r.reference)).status === "paid") paid++; } catch (e) { logger.warn({ err: (e as Error).message }, "payment check failed"); }
  }
  return { checked: rows.length, paid };
}
