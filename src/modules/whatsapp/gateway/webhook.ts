import { timingSafeEqual } from "node:crypto";
import { from, run } from "@/server/db";
import type { InboundMessage, StatusUpdate } from "../types";

export function secretMatches(given: string | null, expected: string | undefined) {
  if (!given || !expected || expected.length < 16) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The gateway names each session after our connection id. Only ids that exist in our database are accepted. */
export async function connectionForSession(session: unknown): Promise<string | null> {
  if (typeof session !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(session)) return null;
  const rows = await run<{ id: string }[]>(from("WhatsappConnection").select("id").eq("id", session).limit(1));
  return rows[0]?.id ?? null;
}

type GatewayMessage = { session?: string; id?: string; from?: string; rawFrom?: string; participant?: string | null; pushName?: string | null; timestamp?: number | null; text?: string | null; type?: string | null };

const MEDIA: Record<string, string> = { imageMessage: "image", videoMessage: "video", audioMessage: "audio", documentMessage: "document", stickerMessage: "sticker" };

/** Gateway inbound payload -> our InboundMessage. Returns null for anything that is not a one-to-one customer chat. */
export function toInbound(m: GatewayMessage): InboundMessage | null {
  const raw = String(m.rawFrom ?? m.from ?? "");
  if (!m.id || !raw || m.participant) return null;
  // Groups, communities, channels and status updates are not customers.
  if (/@(g\.us|newsletter|broadcast)$/.test(raw) || raw === "status@broadcast") return null;
  const from = String(m.from ?? raw);
  const digits = from.split("@")[0].split(":")[0];
  if (!/^\d{5,20}$/.test(digits) || digits.startsWith("120363")) return null;
  // `from` is a phone JID when WhatsApp exposed the number; an @lid JID means it stayed hidden: keep it, flagged.
  const phone = from.endsWith("@lid") ? `lid:${digits}` : `+${digits}`;
  const mediaType = m.type ? MEDIA[m.type] : undefined;
  if (!m.text && !mediaType) return null;
  return {
    externalId: m.id, from: phone, fromName: m.pushName ?? undefined, text: m.text ?? undefined, mediaType,
    timestamp: m.timestamp ? new Date(m.timestamp * 1000) : new Date(),
  };
}

const CODES: Record<string, StatusUpdate["status"]> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
export function toStatus(e: { event?: string; message_id?: string; status?: string }): StatusUpdate | null {
  const status = e.status ? CODES[e.status] : undefined;
  return e.event === "message_status" && e.message_id && status ? { externalId: e.message_id, status } : null;
}
