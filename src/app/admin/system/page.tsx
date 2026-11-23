import { requireSuperAdmin } from "@/modules/admin/guard";
import { DateTime } from "luxon";
import { count, from, run } from "@/server/db";
import { workerOnline } from "@/server/heartbeat";
import { Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
const QUEUES = ["wa-control", "wa-outbound", "wa-notify", "ai-reply", "reminders", "followups"];

export default async function System() {
  await requireSuperAdmin(); // never rely on the layout alone
  const head = { count: "exact" as const, head: true };
  const [online, conns, failed, perQueue] = await Promise.all([
    workerOnline(),
    run<{ status: string; desiredState: string; phoneNumber: string | null; lastError: string | null; org: { name: string } }[]>(from("WhatsappConnection").select("status, desiredState, phoneNumber, lastError, org:Organization(name)").limit(300)),
    run<{ id: string; queue: string; name: string; lastError: string | null; updatedAt: Date }[]>(from("Job").select("id, queue, name, lastError, updatedAt").eq("status", "failed").order("updatedAt", { ascending: false }).limit(15)),
    Promise.all(QUEUES.map(async (q) => ({ q, pending: await count(from("Job").select("id", head).eq("queue", q).eq("status", "pending")), running: await count(from("Job").select("id", head).eq("queue", q).eq("status", "running")), failed: await count(from("Job").select("id", head).eq("queue", q).eq("status", "failed")) }))),
  ]);
  const connected = conns.filter((c) => c.status === "connected").length;
  const shouldRun = conns.filter((c) => c.desiredState === "running" && c.status !== "connected");
  return (
    <div className="space-y-4">
      <PageHeader title="System" sub="Background worker, WhatsApp sockets and the job queue." actions={<Badge tone={online ? "green" : "red"}>{online ? "Worker online" : "Worker offline"}</Badge>} />
      <Card title="Job queues">
        <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-normal">Queue</th><th className="pb-2 text-right font-normal">Pending</th><th className="pb-2 text-right font-normal">Running</th><th className="pb-2 text-right font-normal">Failed</th></tr></thead>
          <tbody>{perQueue.map((r) => <tr key={r.q} className="border-t border-border"><td className="py-1.5">{r.q}</td><td className="text-right tabular-nums">{r.pending}</td><td className="text-right tabular-nums">{r.running}</td><td className={`text-right tabular-nums ${r.failed ? "text-danger" : ""}`}>{r.failed}</td></tr>)}</tbody></table>
      </Card>
      <Card title={`WhatsApp connections · ${connected} of ${conns.length} connected`}>
        {shouldRun.length === 0 ? <p className="text-sm text-muted">Every connection that should be running is connected.</p> : (
          <ul className="divide-y divide-border text-sm">{shouldRun.map((c, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{c.org.name} <span className="text-muted">{c.phoneNumber ?? ""}</span></span><span className="text-xs text-muted">{c.status}{c.lastError ? ` · ${c.lastError.slice(0, 60)}` : ""}</span></li>)}</ul>
        )}
      </Card>
      <Card title="Recent failed jobs">
        {failed.length === 0 ? <p className="text-sm text-muted">None.</p> : (
          <ul className="divide-y divide-border text-sm">{failed.map((j) => <li key={j.id} className="py-2"><div className="flex justify-between gap-3"><span>{j.queue} · {j.name}</span><span className="text-xs text-muted">{DateTime.fromJSDate(j.updatedAt).setZone("Africa/Lagos").toFormat("d LLL, h:mm a")}</span></div><p className="mt-0.5 break-words text-xs text-muted">{j.lastError}</p></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
