import { validSignature } from "@/modules/billing/paystack";
import { confirmPayment } from "@/modules/billing/service";
import { logger } from "@/server/logger";

/** Paystack → us. The body is only trusted after the HMAC check, and the payment is re-verified with Paystack. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-paystack-signature"))) return new Response("invalid signature", { status: 401 });
  let event: { event?: string; data?: { reference?: string } };
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (event.event === "charge.success" && event.data?.reference) {
    try { await confirmPayment(event.data.reference); }
    catch (e) { logger.error({ err: (e as Error).message }, "paystack webhook processing failed"); return new Response("retry", { status: 500 }); } // Paystack retries
  }
  return new Response("ok");
}
