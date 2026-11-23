import { confirmOrderPayment } from "@/modules/payments/service";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Where Paystack sends the customer after paying. Confirms with Paystack, then shows a plain result page. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const reference = u.searchParams.get("reference") || u.searchParams.get("trxref") || "";
  let r: Awaited<ReturnType<typeof confirmOrderPayment>> = { ok: false, status: "unknown" };
  if (/^[A-Za-z0-9_.-]{6,100}$/.test(reference)) { try { r = await confirmOrderPayment(reference); } catch { r = { ok: false, status: "pending" }; } }
  const [icon, title, msg] =
    r.status === "paid" ? ["✅", "Payment received", `Thank you! ${r.business ? esc(r.business) + " has" : "The business has"} been notified${r.orderNumber ? ` for order #${r.orderNumber}` : ""}. You can go back to WhatsApp.`]
    : r.status === "pending" ? ["⏳", "Still confirming", "We haven't had confirmation yet. If you were charged, don't pay again: the business will confirm on WhatsApp shortly."]
    : r.status === "failed" ? ["⚠️", "Payment didn't go through", "You weren't charged for this attempt. Go back to the WhatsApp chat and ask for a new payment link."]
    : ["❔", "We couldn't find this payment", "If you were charged, message the business on WhatsApp with your Paystack receipt."];
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1.25rem;text-align:center;color:#111">
<div style="font-size:3rem">${icon}</div><h1 style="font-size:1.4rem">${title}</h1><p style="color:#555;line-height:1.5">${msg}</p></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
