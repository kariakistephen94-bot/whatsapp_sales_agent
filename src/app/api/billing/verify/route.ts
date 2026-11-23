import { NextResponse, type NextRequest } from "next/server";
import { confirmPayment, appUrl } from "@/modules/billing/service";
import { logger } from "@/server/logger";

/** Paystack sends the customer back here after checkout. Verified server-side; the URL alone proves nothing. */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference") || req.nextUrl.searchParams.get("trxref");
  let result = "failed";
  if (reference) {
    try { const r = await confirmPayment(reference); result = r.ok ? "success" : "failed"; }
    catch (e) { logger.error({ err: (e as Error).message, reference }, "payment verification failed"); result = "pending"; }
  }
  return NextResponse.redirect(`${appUrl()}/dashboard/billing?payment=${result}`);
}
