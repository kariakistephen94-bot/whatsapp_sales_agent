import "dotenv/config";
import { from, tenant, must, type WhatsappConnection } from "@/server/db";
import { controlQueue } from "@/server/queue";

// Dev smoke test: creates a connection for the first org, asks the worker to start it, waits for a QR.
async function main() {
  const org = await must<{ id: string }>(from("Organization").select("id").limit(1).single());
  const conn = await must<WhatsappConnection>(tenant(org.id).from("WhatsappConnection").insert({ provider: "baileys", status: "connecting", desiredState: "running" }).select("*").single());
  await controlQueue().add("start", { connectionId: conn.id, action: "start" });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const c = await must<WhatsappConnection>(from("WhatsappConnection").select("*").eq("id", conn.id).single());
    console.log(i, c.status, c.qr ? `qr(${c.qr.length} chars)` : "-", c.lastError ?? "");
    if (c.status === "qr" && c.qr) { console.log("OK: QR generated"); break; }
  }
  console.log("connection id", conn.id);
  process.exit(0);
}
main();
