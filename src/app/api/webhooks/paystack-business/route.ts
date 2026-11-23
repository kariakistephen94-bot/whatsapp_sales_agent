import { confirmOrderPayment, secretForReference } from "@/modules/payments/service";
import { signatureMatches } from "@/modules/payments/paystack";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Paystack → us, for a business's own account. The signature is checked with that business's secret key
 * (found via the payment reference), and the payment is then re-verified with Paystack before anything is marked paid.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event: { event?: string; data?: { reference?: string } };
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const reference = event.data?.reference;
  if (!reference) return new Response("ok");
  const owner = await secretForReference(reference);
  if (!owner) return new Response("ok"); // not one of our payments (or the business removed its keys): nothing to retry
  if (!signatureMatches(raw, req.headers.get("x-paystack-signature"), owner.secret)) return new Response("invalid signature", { status: 401 });
  if (event.event === "charge.success") {
    try { await confirmOrderPayment(reference); }
    catch (e) { logger.error({ err: (e as Error).message }, "business payment webhook failed"); return new Response("retry", { status: 500 }); }
  }
  return new Response("ok");
}
