import { requireSuperAdmin } from "@/modules/admin/guard";
import { count, from, run } from "@/server/db";
import { formatKobo } from "@/lib/locale";
import { workerOnline } from "@/server/heartbeat";
import { serviceStateOf } from "@/modules/billing/usage";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  await requireSuperAdmin(); // never rely on the layout alone
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * 864e5).toISOString();
  const head = { count: "exact" as const, head: true };
  const [orgs, new7, new30, subs, paid30, msgs7, customers, online, failedJobs] = await Promise.all([
    count(from("Organization").select("id", head)),
    count(from("Organization").select("id", head).gte("createdAt", ago(7))),
    count(from("Organization").select("id", head).gte("createdAt", ago(30))),
    run<{ status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; plan: { key: string; name: string; priceCents: number } }[]>(from("Subscription").select("status, trialEndsAt, currentPeriodEnd, plan:Plan(key, name, priceCents)")),
    run<{ amountCents: number }[]>(from("BillingTransaction").select("amountCents").eq("status", "success").gte("paidAt", ago(30))),
    count(from("Message").select("id", head).gte("createdAt", ago(7))),
    count(from("Customer").select("id", head)),
    workerOnline(),
    count(from("Job").select("id", head).eq("status", "failed")),
  ]);
  const states = subs.map((s) => ({ s, st: serviceStateOf(s, now) }));
  const paying = states.filter(({ s, st }) => s.status === "active" && st.active && s.plan.priceCents > 0);
  const mrr = paying.reduce((n, { s }) => n + s.plan.priceCents, 0);
  const trialing = states.filter(({ st }) => st.status === "trialing");
  const endingSoon = trialing.filter(({ st }) => st.daysLeft != null && st.daysLeft <= 3).length;
  const expired = states.filter(({ st }) => st.status === "expired").length;
  const byPlan = new Map<string, number>();
  for (const { s, st } of states) if (st.active) byPlan.set(s.plan.name, (byPlan.get(s.plan.name) ?? 0) + 1);

  return (
    <div>
      <PageHeader title="Overview" sub="Health of the whole platform." actions={<Badge tone={online ? "green" : "red"}>{online ? "Worker online" : "Worker offline"}</Badge>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Workspaces" value={String(orgs)} delta={`+${new7} this week · +${new30} this month`} />
        <Stat label="Monthly recurring revenue" value={formatKobo(mrr)} delta={`${paying.length} paying workspace${paying.length === 1 ? "" : "s"}`} />
        <Stat label="Paid in last 30 days" value={formatKobo(paid30.reduce((n, t) => n + t.amountCents, 0))} delta={`${paid30.length} payment${paid30.length === 1 ? "" : "s"}`} />
        <Stat label="On trial" value={String(trialing.length)} delta={`${endingSoon} ending within 3 days`} />
        <Stat label="Expired (not renewed)" value={String(expired)} delta="AI + automations paused" />
        <Stat label="Customers (all workspaces)" value={customers.toLocaleString("en-NG")} />
        <Stat label="Messages, last 7 days" value={msgs7.toLocaleString("en-NG")} />
        <Stat label="Failed background jobs" value={String(failedJobs)} delta="see System" />
      </div>
      <Card title="Active workspaces by plan" className="mt-4">
        {byPlan.size === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
          <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">{[...byPlan].map(([n, c]) => <li key={n} className="flex justify-between rounded-md bg-bg px-3 py-2"><span>{n}</span><span className="tabular-nums">{c}</span></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
