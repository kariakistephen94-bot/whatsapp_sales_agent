import { handleInbound } from "@/modules/whatsapp/inbound";
import { connectionForSession, secretMatches, toInbound } from "@/modules/whatsapp/gateway/webhook";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/** Incoming customer messages from the WhatsApp gateway. Non-2xx makes the gateway keep the message and retry. */
export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-helios-key"), process.env.GATEWAY_WEBHOOK_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "bad request" }, { status: 400 });
  const msg = toInbound(body as any);
  if (!msg) return Response.json({ ok: true, ignored: true }); // groups, channels, empty messages
  const connectionId = await connectionForSession((body as any).session);
  if (!connectionId) return Response.json({ ok: true, ignored: true, reason: "unknown session" }); // not ours: never retry
  try {
    await handleInbound(connectionId, msg);
  } catch (e) {
    logger.error({ err: (e as Error).message }, "gateway inbound failed");
    return Response.json({ error: "failed" }, { status: 500 }); // gateway retries
  }
  return Response.json({ ok: true });
}
