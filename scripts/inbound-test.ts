import "dotenv/config";
import { from, must, count, type WhatsappConnection, type Customer } from "@/server/db";
import { handleInbound } from "@/modules/whatsapp/inbound";

// Simulates inbound WhatsApp messages through the real pipeline (no phone needed).
async function main() {
  const conn = await must<WhatsappConnection>(from("WhatsappConnection").select("*").order("id", { ascending: false }).limit(1).single());
  const base = { from: "+15550001111", fromName: "Test Customer", timestamp: new Date() };
  await handleInbound(conn.id, { ...base, externalId: "TEST-1", text: "Hi, do you have slots Saturday?" });
  await handleInbound(conn.id, { ...base, externalId: "TEST-1", text: "Hi, do you have slots Saturday?" }); // duplicate delivery
  await handleInbound(conn.id, { ...base, externalId: "TEST-2", text: "STOP" });
  const c = await must<Customer>(from("Customer").select("*").eq("phone", base.from).eq("organizationId", conn.organizationId).limit(1).single());
  const msgs = await count(from("Message").select("id, conversation:Conversation!inner(customerId)", { count: "exact", head: true }).eq("conversation.customerId", c.id));
  console.log({ customer: c.name, optedOut: c.optedOut, messages: msgs, expectedMessages: 2 });
  process.exit(0);
}
main();
