import makeWASocket, {
  DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, type WASocket, type proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { from, run, maybe } from "@/server/db";
import { logger } from "@/server/logger";
import { useDbAuthState } from "./auth-state";
import type { ProviderEvents, WhatsAppProvider, ProviderFactory } from "../types";

const silent = pino({ level: "silent" });

const toE164 = (jid: string) => `+${jid.split("@")[0].split(":")[0]}`;
const toJid = (phone: string) => `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;

/** Isolated Baileys adapter (unofficial WhatsApp Web). Nothing outside this folder imports Baileys. */
export class BaileysProvider implements WhatsAppProvider {
  readonly kind = "baileys" as const;
  private sock?: WASocket;
  private stopped = false;
  private lids = new Set<string>();
  private retries = 0;
  private retryCache = (() => {
    const m = new Map<string, number>();
    return { get: <T>(k: string) => m.get(k) as T | undefined, set: <T>(k: string, v: T) => { if (m.size > 5000) m.clear(); m.set(k, v as unknown as number); }, del: (k: string) => { m.delete(k); }, flushAll: () => m.clear() };
  })();
  private flush?: () => Promise<void>;

  constructor(private connectionId: string, private events: ProviderEvents) {}

  async connect() {
    this.stopped = false;
    await this.events.onState({ state: "connecting" });
    const { state, saveCreds, flushNow } = await useDbAuthState(this.connectionId);
    this.flush = flushNow;
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as any }));

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, silent) },
      logger: silent,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      msgRetryCounterCache: this.retryCache,
      // When a customer's phone can't decrypt one of our messages ("Waiting for this message…") it asks us to
      // send it again. Baileys can only do that if we can hand back the original content.
      getMessage: async (key) => {
        const id = key.id;
        if (!id) return undefined;
        const m = await maybe<{ body: string | null }>(from("Message").select("body").eq("externalId", id).eq("direction", "out").maybeSingle()).catch(() => null);
        return m?.body ? { conversation: m.body } : undefined;
      },
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (u.qr) await this.events.onState({ state: "qr", qr: u.qr });
      if (u.connection === "open") {
        this.retries = 0;
        await this.events.onState({ state: "connected", phoneNumber: sock.user?.id ? toE164(sock.user.id) : undefined });
      }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        if (loggedOut) {
          await this.wipe();
          await this.events.onState({ state: "disconnected", error: "Logged out from the phone" });
        } else if (!this.stopped) {
          await this.flush?.().catch(() => {}); // make sure the latest creds are saved before reloading them
          // Transient drop (incl. 515 restartRequired right after QR pairing): reconnect with backoff.
          const delay = Math.min(30_000, 1000 * 2 ** this.retries++);
          logger.warn({ connectionId: this.connectionId, code, delay }, "whatsapp socket closed, reconnecting");
          await this.events.onState({ state: "connecting" });
          setTimeout(() => { if (!this.stopped) void this.connect().catch((e) => logger.error(e)); }, delay);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const parsed = this.parse(m);
        if (parsed) await this.events.onMessage(parsed);
      }
    });

    sock.ev.on("messages.update", async (updates) => {
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id || update.status == null) continue;
        // 2 = server ack, 3 = delivered, 4 = read
        const status = update.status >= 4 ? "read" : update.status === 3 ? "delivered" : update.status === 0 ? "failed" : "sent";
        await this.events.onStatus({ externalId: key.id, status });
      }
    });
  }

  private parse(m: proto.IWebMessageInfo) {
    const key = m.key;
    if (!key?.id || key.fromMe) return null;
    const jid = key.remoteJid ?? "";
    // Groups, communities, channels and status updates are not customers.
    if (!jid || jid.endsWith("@g.us") || jid.endsWith("@newsletter") || jid.endsWith("@broadcast")) return null;
    const realJid: string = (key as any).senderPn ?? (key as any).remoteJidAlt ?? jid;
    const id = realJid.split("@")[0].split(":")[0];
    if (!/^\d{7,15}$/.test(id) || id.startsWith("120363")) return null; // 120363… is a group/community/channel id, not a phone
    // WhatsApp sometimes hides the number behind a private "@lid" id; remember it so replies go to the right address.
    if (realJid.endsWith("@lid")) this.lids.add(id);
    const msg = m.message;
    if (!msg) return null;
    const text = msg.conversation ?? msg.extendedTextMessage?.text ?? msg.imageMessage?.caption ?? msg.videoMessage?.caption ?? undefined;
    const mediaType = msg.imageMessage ? "image" : msg.videoMessage ? "video" : msg.audioMessage ? "audio" : msg.documentMessage ? "document" : undefined;
    if (!text && !mediaType) return null;
    return {
      externalId: key.id, from: toE164(realJid), fromName: m.pushName ?? undefined, text, mediaType,
      timestamp: new Date(Number(m.messageTimestamp ?? Date.now() / 1000) * 1000),
    };
  }

  async sendText(toPhone: string, text: string) {
    if (!this.sock) throw new Error("WhatsApp not connected");
    const digits = toPhone.replace(/[^0-9]/g, "");
    const res = await this.sock.sendMessage(this.lids.has(digits) ? `${digits}@lid` : toJid(toPhone), { text });
    if (!res?.key.id) throw new Error("WhatsApp did not return a message id");
    return { externalId: res.key.id };
  }

  async sendImage(toPhone: string, imageUrl: string, caption?: string) {
    if (!this.sock) throw new Error("WhatsApp not connected");
    const digits = toPhone.replace(/[^0-9]/g, "");
    const res = await this.sock.sendMessage(this.lids.has(digits) ? `${digits}@lid` : toJid(toPhone), { image: { url: imageUrl }, ...(caption ? { caption } : {}) });
    if (!res?.key.id) throw new Error("WhatsApp did not return a message id");
    return { externalId: res.key.id };
  }

  async stop() {
    this.stopped = true;
    await this.flush?.().catch(() => {});
    this.sock?.end(undefined);
    this.sock = undefined;
    await this.events.onState({ state: "disconnected" });
  }

  async logout() {
    this.stopped = true;
    try { await this.sock?.logout(); } catch { /* already closed */ }
    this.sock?.end(undefined);
    this.sock = undefined;
    await this.wipe();
    await this.events.onState({ state: "disconnected" });
  }

  private async wipe() {
    await run(from("WhatsappConnection").update({ credsEncrypted: null, phoneNumber: null, qr: null }).eq("id", this.connectionId));
  }
}

export const createBaileysProvider: ProviderFactory = ({ connectionId, events }) => new BaileysProvider(connectionId, events);
