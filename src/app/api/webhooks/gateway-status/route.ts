import { handleStatus } from "@/modules/whatsapp/inbound";
import { secretMatches, toStatus } from "@/modules/whatsapp/gateway/webhook";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/** Delivery / read receipts for messages we sent through the gateway. */
export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-helios-gateway-key"), process.env.GATEWAY_STATUS_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "bad request" }, { status: 400 });
  const u = toStatus(body as any);
  if (!u) return Response.json({ ok: true, ignored: true });
  try { await handleStatus("", u); } catch (e) { logger.error({ err: (e as Error).message }, "gateway status failed"); return Response.json({ error: "failed" }, { status: 500 }); }
  return Response.json({ ok: true });
}
