import { randomUUID } from "node:crypto";
import { tenant, run, maybe, must, type Conversation, type Customer, type WhatsappConnection } from "@/server/db";
import type { NotifyJob, OutboundJob } from "@/server/queue";
import { logger } from "@/server/logger";
import { connectionManager } from "./manager";

/**
 * Single choke point for every outgoing message (AI, human, automation).
 * Enforces: handler lock (AI vs human never collide), opt-out, org suspension.
 */
export async function sendOutbound(job: OutboundJob) {
  const t = tenant(job.organizationId);
  const convo = await maybe<Conversation & { customer: Customer; connection: WhatsappConnection; organization: { status: string } }>(
    t.from("Conversation").select("*, customer:Customer(*), connection:WhatsappConnection(*), organization:Organization(status)").eq("id", job.conversationId).maybeSingle(),
  );
  if (!convo) return { skipped: "not_found" as const };
  if (convo.organization.status === "SUSPENDED") return { skipped: "suspended" as const };

  // Handler lock, checked at send time (not just enqueue time): a takeover during AI generation wins.
  if (job.sender === "ai" && convo.handler !== "AI") return { skipped: "human_has_control" as const };
  if (job.sender === "human" && convo.handler !== "HUMAN") return { skipped: "ai_has_control" as const };
  if (job.sender !== "human" && convo.customer.optedOut && !(job.meta as { optOutConfirmation?: boolean } | null)?.optOutConfirmation) return { skipped: "opted_out" as const };

  const provider = connectionManager.get(convo.connectionId);
  if (!provider || convo.connection.status !== "connected") throw new Error("WhatsApp connection is not ready"); // the job queue retries

  const row = await must<{ id: string }>(t.from("Message").insert({
    conversationId: convo.id, externalId: `pending:${randomUUID()}`,
    direction: "out", sender: job.sender, body: job.text, status: "queued", meta: job.meta ?? null,
    ...(job.imageUrl ? { mediaUrl: job.imageUrl, mediaType: "image" } : {}),
  }).select("id").single());
  let externalId: string;
  try {
    ({ externalId } = job.imageUrl
      ? await provider.sendImage(convo.customer.phone, job.imageUrl, job.text || undefined)
      : await provider.sendText(convo.customer.phone, job.text));
  } catch (e) {
    await run(t.from("Message").update({ status: "failed" }).eq("id", row.id));
    throw e; // nothing was delivered: the job queue may retry
  }
  // The message HAS been delivered. Bookkeeping problems must never make the job retry (that would send it twice).
  try {
    await run(t.from("Message").update({ externalId, status: "sent" }).eq("id", row.id));
    await run(t.from("Conversation").update({ lastMessageAt: new Date().toISOString() }).eq("id", convo.id));
  } catch (e) { logger.error({ err: (e as Error).message, messageId: row.id }, "message sent but bookkeeping failed"); }
  return { sent: true as const, messageId: row.id };
}

/**
 * Direct message to a team member from the business's connected WhatsApp number (invites, hand-off alerts).
 * Not stored as a customer conversation. Throws while WhatsApp isn't connected, so the job queue retries.
 */
export async function sendTeamMessage(job: NotifyJob) {
  const t = tenant(job.organizationId);
  const conn = await maybe<WhatsappConnection>(t.from("WhatsappConnection").select("*").eq("status", "connected").order("lastSeenAt", { ascending: false }).limit(1).maybeSingle());
  const provider = conn ? connectionManager.get(conn.id) : undefined;
  if (!conn || !provider) throw new Error("WhatsApp connection is not ready");
  if (conn.phoneNumber && conn.phoneNumber.replace(/\D/g, "") === job.to.replace(/\D/g, "")) return { skipped: "same_as_business_number" as const };
  const { externalId } = await provider.sendText(job.to, job.text);
  return { sent: true as const, kind: job.kind, externalId };
}
