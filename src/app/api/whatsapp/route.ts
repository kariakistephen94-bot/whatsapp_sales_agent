import QRCode from "qrcode";
import { withTenant } from "@/modules/tenancy/context";
import { controlQueue } from "@/server/queue";
import { run, maybe, must, count, type WhatsappConnection } from "@/server/db";
import { workerOnline } from "@/server/heartbeat";

/** List this org's connections. The QR is rendered server-side; credentials are never selected. */
export const GET = withTenant("STAFF", async (ctx) => {
  const rows = await run<Pick<WhatsappConnection, "id" | "label" | "provider" | "status" | "phoneNumber" | "lastSeenAt" | "lastError" | "qr">[]>(
    ctx.db.from("WhatsappConnection").select("id, label, provider, status, phoneNumber, lastSeenAt, lastError, qr").order("id", { ascending: true }),
  );
  const since = new Date(Date.now() - 864e5).toISOString();
  const [in24h, out24h] = await Promise.all([
    count(ctx.db.from("Message").select("*", { count: "exact", head: true }).eq("direction", "in").gte("createdAt", since)),
    count(ctx.db.from("Message").select("*", { count: "exact", head: true }).eq("direction", "out").gte("createdAt", since)),
  ]);
  const connections = await Promise.all(rows.map(async ({ qr, ...c }) => ({ ...c, qrDataUrl: qr ? await QRCode.toDataURL(qr, { margin: 1, width: 280 }) : null })));
  return { connections, activity: { in24h, out24h }, workerOnline: await workerOnline() };
});

/** Create a connection (respecting the plan limit) and start pairing. */
export const POST = withTenant("ADMIN", async (ctx) => {
  const sub = await maybe<{ plan: { limits: unknown } }>(ctx.db.from("Subscription").select("plan:Plan(limits)").maybeSingle());
  const max = (sub?.plan.limits as any)?.whatsappConnections ?? 1;
  const existing = await count(ctx.db.from("WhatsappConnection").select("*", { count: "exact", head: true }));
  if (max !== -1 && existing >= max) return Response.json({ error: `Your plan allows ${max} WhatsApp connection(s)` }, { status: 403 });

  const conn = await must<{ id: string }>(ctx.db.from("WhatsappConnection").insert({ provider: process.env.WHATSAPP_PROVIDER || "baileys", status: "connecting", desiredState: "running" }).select("id").single());
  await controlQueue().add("start", { connectionId: conn.id, action: "start" });
  return { id: conn.id };
});
