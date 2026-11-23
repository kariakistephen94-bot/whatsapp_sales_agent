import { tenant, maybe, must, type Conversation } from "@/server/db";

/** Latest open conversation with a customer, or a new one on the org's connected WhatsApp number. */
export async function getOrCreateConversation(organizationId: string, customerId: string): Promise<Conversation | null> {
  const t = tenant(organizationId);
  const existing = await maybe<Conversation>(
    t.from("Conversation").select("*").eq("customerId", customerId).order("lastMessageAt", { ascending: false }).limit(1).maybeSingle(),
  );
  if (existing) return existing;
  const conn = await maybe<{ id: string }>(
    t.from("WhatsappConnection").select("id").order("status", { ascending: true }).order("lastSeenAt", { ascending: false }).limit(1).maybeSingle(),
  );
  if (!conn) return null;
  return must<Conversation>(t.from("Conversation").insert({ customerId, connectionId: conn.id }).select("*").single());
}
