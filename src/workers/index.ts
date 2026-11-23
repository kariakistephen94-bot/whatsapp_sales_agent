import "dotenv/config";
import { logger } from "@/server/logger";
import { DbQueue, maintainJobs, controlQueue, outboundQueue, aiReplyQueue, remindersQueue, followupQueue, notifyQueue } from "@/server/queue";
import { connectionManager } from "@/modules/whatsapp/manager";
import { paymentSweep } from "@/modules/payments/service";
import { sendOutbound, sendTeamMessage } from "@/modules/whatsapp/outbound";
import { handleAiReply } from "@/modules/ai/reply";
import { handleReminder, handleFollowup } from "@/modules/automations/jobs";
import { startHeartbeat } from "@/server/heartbeat";
import { runCareSweep } from "@/modules/relationships/care";
import { billingSweep } from "@/modules/billing/sweep";

let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls one database queue, running up to `concurrency` jobs at a time. */
function consume<T>(q: DbQueue<T>, concurrency: number, handler: (data: T) => Promise<unknown>, idleMs = 1000) {
  let running = 0;
  (async () => {
    while (!stopping) {
      const free = concurrency - running;
      let claimed: Awaited<ReturnType<DbQueue<T>["claim"]>> = [];
      if (free > 0) {
        try { claimed = await q.claim(free); }
        catch (e) { logger.error({ queue: q.name, err: (e as Error).message }, "claim failed"); await sleep(5000); continue; }
      }
      for (const job of claimed) {
        running++;
        handler(job.data)
          .then(async (result) => {
            logger.info({ queue: q.name, job: job.id, result }, "job done");
            // The handler already ran (the message may be sent). If marking it done fails, never retry it:
            // the stuck-job sweeper requeues it only if it stays "running" for 10 minutes.
            await q.complete(job.id).catch((e) => logger.error({ queue: q.name, job: job.id, err: e?.message }, "could not mark job done"));
          }, async (err) => {
            const final = await q.fail(job, err).catch(() => true);
            logger.error({ queue: q.name, job: job.id, attempt: job.attempts, final, err: err?.message ?? String(err) }, "job failed");
          })
          .finally(() => { running--; });
      }
      await sleep(claimed.length ? 50 : idleMs);
    }
  })();
}

async function main() {
  // Restore first, THEN start consuming jobs: otherwise a queued stop/logout can race the restore
  // and a connection that should be off comes back to life.
  await connectionManager.restoreAll();

  // Socket lifecycle commands from the web app. concurrency 1 => connection changes are serialized.
  consume(controlQueue(), 1, async (d) => {
    if (d.action === "start") await connectionManager.start(d.connectionId);
    if (d.action === "stop") await connectionManager.stop(d.connectionId);
    if (d.action === "logout") await connectionManager.logout(d.connectionId);
  }, 500);
  consume(outboundQueue(), 5, (d) => sendOutbound(d), 500);
  consume(notifyQueue(), 3, (d) => sendTeamMessage(d), 1000);
  consume(aiReplyQueue(), 4, (d) => handleAiReply(d), 500);
  consume(remindersQueue(), 4, (d) => handleReminder(d), 5000);
  consume(followupQueue(), 4, (d) => handleFollowup(d), 5000);

  startHeartbeat();
  const housekeeping = () => maintainJobs().catch((e) => logger.warn({ err: e.message }, "job housekeeping failed"));
  void housekeeping();
  setInterval(housekeeping, 5 * 60_000);
  // Customer relationships (hourly): refresh who is due / at risk / lapsed and queue the AI's check-in messages.
  const care = () => runCareSweep().then((r) => r.queued && logger.info(r, "care sweep queued nudges")).catch((e) => logger.warn({ err: e.message }, "care sweep failed"));
  setTimeout(care, 60_000);
  setInterval(care, 60 * 60_000);
  // Customer payments (every 2 min): confirm Paystack payments whose webhook never arrived.
  const payments = () => paymentSweep().then((r) => r.paid && logger.info(r, "payments confirmed")).catch((e) => logger.warn({ err: e.message }, "payment sweep failed"));
  setTimeout(payments, 45_000);
  setInterval(payments, 2 * 60_000);
  // Subscriptions (every 6h): mark expired trials / lapsed plans.
  const billing = () => billingSweep().catch((e) => logger.warn({ err: e.message }, "billing sweep failed"));
  setTimeout(billing, 30_000);
  setInterval(billing, 6 * 60 * 60_000);
  logger.info("worker ready (database job queue)");
}

main().catch((e) => { logger.error(e, "worker failed to start"); process.exit(1); });
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => {
  stopping = true;
  setTimeout(() => process.exit(0), 8000).unref(); // hard stop if saving hangs
  connectionManager.shutdown().catch(() => {}).finally(() => process.exit(0));
});
