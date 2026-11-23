/**
 * Provider-agnostic WhatsApp contract. The rest of the app depends ONLY on this file;
 * Baileys (unofficial) and the Cloud API (official) are interchangeable adapters.
 */
export type ConnectionState = "disconnected" | "qr" | "connecting" | "connected";

export interface InboundMessage {
  externalId: string;
  /** E.164 phone of the customer, e.g. +2348012345678 (or a provider id if no phone is exposed) */
  from: string;
  fromName?: string;
  text?: string;
  mediaType?: string;
  timestamp: Date;
}

export interface StatusUpdate {
  externalId: string;
  status: "sent" | "delivered" | "read" | "failed";
}

export interface ProviderEvents {
  onState(s: { state: ConnectionState; qr?: string; phoneNumber?: string; error?: string }): void | Promise<void>;
  onMessage(m: InboundMessage): void | Promise<void>;
  onStatus(u: StatusUpdate): void | Promise<void>;
}

export interface WhatsAppProvider {
  readonly kind: "baileys" | "cloud_api";
  connect(): Promise<void>;
  /** Close the socket but keep credentials (can reconnect without a new QR). */
  stop(): Promise<void>;
  /** Log out of WhatsApp and wipe credentials. */
  logout(): Promise<void>;
  /** Returns the provider message id. */
  sendText(toPhone: string, text: string): Promise<{ externalId: string }>;
  /** Sends a picture from a public URL, with an optional caption. */
  sendImage(toPhone: string, imageUrl: string, caption?: string): Promise<{ externalId: string }>;
}

export type ProviderFactory = (opts: { connectionId: string; events: ProviderEvents }) => WhatsAppProvider;
