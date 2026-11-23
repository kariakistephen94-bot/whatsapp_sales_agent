import { from, run, rpc, isUniqueViolation } from "./db";

export type CareStage = "rebook" | "check_in" | "win_back";
export type ControlJob = { connectionId: string; action: "start" | "stop" | "logout" };
export type OutboundJob = { organizationId: string; conversationId: string; sender: "human" | "ai" | "system"; text: string; /** send this picture, with `text` as its caption */ imageUrl?: string; meta?: unknown };
export type AiReplyJob = { organizationId: string; conversationId: string; messageId: string };
export type ReminderJob = { appointmentId: string; automationKey: string; startsAtMs: number };
export type FollowupJob = { followupId: string } | { kind: "abandoned_enquiry"; organizationId: string; customerId: string; since: number } | { kind: "order_confirmation"; organizationId: string; orderId: string } | { kind: "customer_care"; organizationId: string; customerId: string; stage: CareStage; queuedAt: number };

/** A direct WhatsApp message to a team member (invite link, hand-off alert). Not part of any customer chat. */
export type NotifyJob = { organizationId: string; to: string; text: string; kind: "invite" | "handoff" };

export type AddOptions = { delay?: number; jobId?: string; attempts?: number };
export type ClaimedJob<T> = { id: string; name: string; data: T; attempts: number; maxAttempts: number };

/**
 * A durable job queue stored in Supabase (the "Job" table). Jobs survive restarts,
 * `jobId` dedupes (a second add with the same id is ignored), and workers claim jobs through
 * app_claim_jobs (FOR UPDATE SKIP LOCKED) so several workers never run the same job twice.
 */
export class DbQueue<T> {
  constructor(readonly name: string) {}

  async add(name: string, data: T, opts: AddOptions = {}) {
    try {
      return await run<{ id: string }>(from("Job").insert({
        queue: this.name, name, key: opts.jobId ?? null, data,
        runAt: new Date(Date.now() + Math.max(0, opts.delay ?? 0)).toISOString(), maxAttempts: opts.attempts ?? 5,
      }).select("id").single());
    } catch (e) {
      if (isUniqueViolation(e)) return null; // already queued
      throw e;
    }
  }

  /** Atomically claim up to `limit` due jobs. */
  claim(limit: number) {
    return rpc<ClaimedJob<T>[]>("app_claim_jobs", { p_queue: this.name, p_limit: limit });
  }

  async complete(id: string) {
    await run(from("Job").update({ status: "done", lockedAt: null }).eq("id", id));
  }

  /** Retry with exponential backoff (2s, 4s, 8s…) until attempts run out. */
  async fail(job: ClaimedJob<T>, err: unknown) {
    const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    const final = job.attempts >= job.maxAttempts;
    await run(from("Job").update(final
      ? { status: "failed", lockedAt: null, lastError }
      : { status: "pending", lockedAt: null, lastError, runAt: new Date(Date.now() + 2000 * 2 ** (job.attempts - 1)).toISOString() },
    ).eq("id", job.id));
    return final;
  }
}

const g = globalThis as unknown as { __queues?: Record<string, DbQueue<unknown>> };
function queue<T>(name: string) {
  g.__queues ??= {};
  return (g.__queues[name] ??= new DbQueue<unknown>(name)) as DbQueue<T>;
}

export const controlQueue = () => queue<ControlJob>("wa-control");
export const outboundQueue = () => queue<OutboundJob>("wa-outbound");
export const aiReplyQueue = () => queue<AiReplyJob>("ai-reply");
export const remindersQueue = () => queue<ReminderJob>("reminders");
export const followupQueue = () => queue<FollowupJob>("followups");
export const notifyQueue = () => queue<NotifyJob>("wa-notify");

/** Housekeeping, run by the worker: requeue jobs from a crashed worker, prune old rows. */
export async function maintainJobs() {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  await run(from("Job").update({ status: "pending", lockedAt: null }).eq("status", "running").lt("lockedAt", ago(10 * 60_000)));
  await run(from("Job").delete().eq("status", "done").lt("updatedAt", ago(7 * 86_400_000)));
  await run(from("Job").delete().eq("status", "failed").lt("updatedAt", ago(30 * 86_400_000)));
  await run(from("RateLimitBucket").delete().lt("resetAt", new Date().toISOString()));
}
