import { logger } from "@/server/logger";
import type { ProviderEvents, ProviderFactory, WhatsAppProvider, ConnectionState } from "../types";

/**
 * WhatsApp provider that talks to the self-hosted gateway (see /gateway): a small service that holds the
 * linked-device session (Baileys 7) and exposes HTTP. We send through POST /send and poll /status for the
 * pairing QR and connection state. Incoming messages and delivery receipts arrive on the app's webhooks.
 */
const cfg = () => {
  const url = (process.env.GATEWAY_URL || "").replace(/\/$/, "");
  const key = process.env.GATEWAY_API_KEY || "";
  if (!url || !key) throw new Error("WhatsApp gateway is not configured (set GATEWAY_URL and GATEWAY_API_KEY in .env)");
  return { url, key };
};

async function call<T = any>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { url, key } = cfg();
  const res = await fetch(`${url}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${key}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 && (data as any)?.state === "none") return data as T; // session not started yet
  if (!res.ok) throw new Error((data as any)?.error || `Gateway HTTP ${res.status}`);
  return data as T;
}

/** Customer id -> what the gateway accepts as `to`: a phone number, or a full JID when WhatsApp hid the number. */
const toTarget = (phone: string) => (phone.startsWith("lid:") ? `${phone.slice(4)}@lid` : phone.replace(/[^0-9]/g, ""));

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

class GatewayProvider implements WhatsAppProvider {
  readonly kind = "baileys" as const; // the gateway runs Baileys underneath
  private timer?: ReturnType<typeof setInterval>;
  private last = "";
  private lastEmit = 0;
  private stopped = true;

  constructor(private connectionId: string, private events: ProviderEvents) {}

  private get base() { return `/sessions/${encodeURIComponent(this.connectionId)}`; }

  async connect() {
    this.stopped = false;
    await this.events.onState({ state: "connecting" });
    // Starts this business's session in the gateway (or returns it if it already runs). It reconnects by itself when already linked.
    try { await call(`${this.base}/start`, { method: "POST", body: {}, timeoutMs: 30_000 }); }
    catch (e) { await this.emit("disconnected", { error: "WhatsApp gateway is not reachable. Is it running?" }).catch(() => {}); logger.warn({ err: (e as Error).message, connectionId: this.connectionId }, "gateway start failed"); }
    await this.poll();
    this.timer = setInterval(() => void this.poll(), 4000);
  }

  private async emit(state: ConnectionState, extra: { qr?: string; phoneNumber?: string; error?: string } = {}) {
    const sig = `${state}|${extra.qr ?? ""}|${extra.phoneNumber ?? ""}|${extra.error ?? ""}`;
    // Report changes at once; repeat the same state only now and then (keeps "last seen" fresh without hammering the DB).
    if (sig === this.last && Date.now() - this.lastEmit < 60_000) return;
    this.last = sig; this.lastEmit = Date.now();
    await this.events.onState({ state, ...extra });
  }

  private async poll() {
    if (this.stopped) return;
    try {
      const s = await call<{ state: string; connected: boolean; needsQr: boolean; me?: { id: string } | null }>(`${this.base}/status`, { timeoutMs: 8000 });
      if (this.stopped) return;
      if (s.connected) {
        const id = s.me?.id?.split("@")[0].split(":")[0];
        return this.emit("connected", id ? { phoneNumber: `+${id}` } : {});
      }
      if (s.needsQr) {
        const q = await call<{ qr: string | null }>(`${this.base}/qr.json`, { timeoutMs: 8000 });
        return q.qr ? this.emit("qr", { qr: q.qr }) : this.emit("connecting");
      }
      if (s.state === "logged_out") return this.emit("disconnected", { error: "Logged out from the phone" });
      if (s.state === "none") { await call(`${this.base}/start`, { method: "POST", body: {} }); return this.emit("connecting"); }
      return this.emit("connecting");
    } catch (e) {
      if (!this.stopped) await this.emit("disconnected", { error: "WhatsApp gateway is not reachable. Is it running?" }).catch(() => {});
      logger.warn({ err: (e as Error).message, connectionId: this.connectionId }, "gateway status check failed");
    }
  }

  async sendText(toPhone: string, text: string) {
    const r = await call<{ id: string }>(`${this.base}/send`, { body: { to: toTarget(toPhone), text } });
    if (!r.id) throw new Error("WhatsApp did not return a message id");
    return { externalId: r.id };
  }

  async sendImage(toPhone: string, imageUrl: string, caption?: string) {
    const ext = new URL(imageUrl).pathname.split(".").pop()?.toLowerCase() ?? "";
    const r = await call<{ id: string }>(`${this.base}/send`, { body: { to: toTarget(toPhone), media: { url: imageUrl, mimetype: MIME[ext] ?? "image/jpeg", caption } } });
    if (!r.id) throw new Error("WhatsApp did not return a message id");
    return { externalId: r.id };
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await call(`${this.base}/stop`, { method: "POST", body: {} }).catch(() => {});
    await this.events.onState({ state: "disconnected" });
  }

  async logout() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await call(`${this.base}/logout`, { method: "POST", body: {} }).catch((e) => logger.warn({ err: (e as Error).message }, "gateway logout failed"));
    await this.events.onState({ state: "disconnected" });
  }
}

export const createGatewayProvider: ProviderFactory = ({ connectionId, events }) => new GatewayProvider(connectionId, events);
