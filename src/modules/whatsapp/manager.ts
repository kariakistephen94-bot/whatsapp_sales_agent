import { from, run, maybe, type WhatsappConnection } from "@/server/db";
import { logger } from "@/server/logger";
import { createBaileysProvider } from "./baileys/adapter";
import { createGatewayProvider } from "./gateway/adapter";
import { handleInbound, handleStatus } from "./inbound";
import type { ProviderFactory, WhatsAppProvider } from "./types";

const factories: Record<string, ProviderFactory> = {
  baileys: createBaileysProvider,
  gateway: createGatewayProvider,
  // cloud_api: createCloudApiProvider  (official WhatsApp Business Cloud API — same interface, webhook-driven)
};

/** Lives in the worker process only: owns the long-lived sockets. */
class ConnectionManager {
  private providers = new Map<string, WhatsAppProvider>();

  get(connectionId: string) { return this.providers.get(connectionId); }

  async start(connectionId: string) {
    const conn = await maybe<WhatsappConnection>(from("WhatsappConnection").select("*").eq("id", connectionId).maybeSingle());
    if (!conn) return;
    // WHATSAPP_PROVIDER=gateway routes every connection through the self-hosted gateway (the connection row keeps working unchanged).
    const providerKey = process.env.WHATSAPP_PROVIDER || conn.provider;
    const factory = factories[providerKey];
    if (!factory) throw new Error(`Unsupported WhatsApp provider: ${providerKey}`);

    await this.providers.get(connectionId)?.stop().catch(() => {});
    await run(from("WhatsappConnection").update({ desiredState: "running", lastError: null }).eq("id", connectionId));

    const provider = factory({
      connectionId,
      events: {
        onState: async (s) => {
          await run(from("WhatsappConnection").update({
            status: s.state,
            qr: s.state === "qr" ? s.qr : null,
            ...(s.phoneNumber ? { phoneNumber: s.phoneNumber } : {}),
            ...(s.error ? { lastError: s.error } : {}),
            lastSeenAt: new Date().toISOString(),
          }).eq("id", connectionId)).catch((e) => logger.error(e, "failed to persist connection state"));
        },
        onMessage: (m) => handleInbound(connectionId, m).catch((e) => logger.error({ err: e, connectionId }, "inbound failed")),
        onStatus: (u) => handleStatus(connectionId, u).catch((e) => logger.error({ err: e }, "status update failed")),
      },
    });
    this.providers.set(connectionId, provider);
    await provider.connect();
  }

  async stop(connectionId: string) {
    await run(from("WhatsappConnection").update({ desiredState: "stopped" }).eq("id", connectionId)).catch(() => {});
    await this.providers.get(connectionId)?.stop();
    this.providers.delete(connectionId);
  }

  async logout(connectionId: string) {
    await run(from("WhatsappConnection").update({ desiredState: "stopped" }).eq("id", connectionId)).catch(() => {});
    const p = this.providers.get(connectionId);
    if (p) await p.logout();
    else if ((process.env.WHATSAPP_PROVIDER || "") && factories[process.env.WHATSAPP_PROVIDER!]) {
      // Not running in this process (e.g. after a restart): still tell the provider to unlink and delete its saved login.
      await factories[process.env.WHATSAPP_PROVIDER!]({ connectionId, events: { onState: () => {}, onMessage: () => {}, onStatus: () => {} } }).logout().catch((e) => logger.warn({ err: e }, "provider logout failed"));
      await run(from("WhatsappConnection").update({ credsEncrypted: null, phoneNumber: null, qr: null, status: "disconnected" }).eq("id", connectionId));
    } else await run(from("WhatsappConnection").update({ credsEncrypted: null, phoneNumber: null, qr: null, status: "disconnected" }).eq("id", connectionId));
    this.providers.delete(connectionId);
  }

  /** Graceful worker exit: close every socket and save its encryption keys (losing them makes customers see "Waiting for this message"). */
  async shutdown() {
    await Promise.allSettled([...this.providers.values()].map((p) => p.stop()));
  }

  /** On worker boot, bring back every connection that was running. */
  async restoreAll() {
    // Anything not meant to be running can't really be connected: clear stale status/QR left by a crash.
    await run(from("WhatsappConnection").update({ status: "disconnected", qr: null }).eq("desiredState", "stopped").neq("status", "disconnected"));
    const rows = await run<{ id: string }[]>(from("WhatsappConnection").select("id").eq("desiredState", "running"));
    for (const r of rows) await this.start(r.id).catch((e) => logger.error({ err: e, id: r.id }, "restore failed"));
  }
}

const g = globalThis as unknown as { __wa?: ConnectionManager };
export const connectionManager = (g.__wa ??= new ConnectionManager());
