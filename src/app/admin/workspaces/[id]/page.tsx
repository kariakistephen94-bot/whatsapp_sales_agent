import { requireSuperAdmin } from "@/modules/admin/guard";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { count, from, maybe, run } from "@/server/db";
import { serviceStateOf } from "@/modules/billing/usage";
import { formatKobo } from "@/lib/locale";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { WorkspaceActions } from "@/components/admin/workspace-actions";

export const dynamic = "force-dynamic";
const fmt = (d: Date | null) => (d ? DateTime.fromJSDate(d).setZone("Africa/Lagos").toFormat("d LLL yyyy, h:mm a") : "—");

export default async function WorkspaceDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin(); // never rely on the layout alone
  const { id } = await params;
  const org = await maybe<{ id: string; name: string; slug: string; status: string; industry: string | null; email: string | null; phone: string | null; createdAt: Date }>(from("Organization").select("id, name, slug, status, industry, email, phone, createdAt").eq("id", id).maybeSingle());
  if (!org) notFound();
  const head = { count: "exact" as const, head: true };
  const month = new Date(Date.now() - 30 * 864e5).toISOString();
  const [sub, plans, members, customers, orders, msgs, wa, txs, logs] = await Promise.all([
    maybe<{ status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; plan: { key: string; name: string } }>(from("Subscription").select("status, trialEndsAt, currentPeriodEnd, plan:Plan(key, name)").eq("organizationId", id).maybeSingle()),
    run<{ key: string; name: string }[]>(from("Plan").select("key, name").eq("active", true).order("priceCents", { ascending: true })),
    run<{ role: string; phone: string | null; user: { email: string; name: string | null } }[]>(from("Membership").select("role, phone, user:User(email, name)").eq("organizationId", id)),
    count(from("Customer").select("id", head).eq("organizationId", id)),
    count(from("Order").select("id", head).eq("organizationId", id)),
    count(from("Message").select("id", head).eq("organizationId", id).gte("createdAt", month)),
    run<{ status: string; phoneNumber: string | null }[]>(from("WhatsappConnection").select("status, phoneNumber").eq("organizationId", id)),
    run<{ id: string; amountCents: number; status: string; createdAt: Date; paidAt: Date | null; plan: { name: string } }[]>(from("BillingTransaction").select("id, amountCents, status, createdAt, paidAt, plan:Plan(name)").eq("organizationId", id).order("createdAt", { ascending: false }).limit(8)),
    run<{ id: string; action: string; createdAt: Date }[]>(from("AuditLog").select("id, action, createdAt").eq("organizationId", id).order("createdAt", { ascending: false }).limit(10)),
  ]);
  const st = sub ? serviceStateOf(sub) : null;
  return (
    <div className="space-y-4">
      <Link href="/admin/workspaces" className="text-sm text-muted hover:text-fg">← Workspaces</Link>
      <PageHeader title={org.name} sub={`${org.slug} · ${org.industry ?? "no industry"} · created ${fmt(org.createdAt)}`} actions={<Badge tone={org.status === "SUSPENDED" ? "red" : "green"}>{org.status.toLowerCase()}</Badge>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Plan" value={sub?.plan.name ?? "—"} delta={st ? `${st.status}${st.endsAt ? ` · until ${fmt(st.endsAt)}` : ""}` : undefined} />
        <Stat label="Customers" value={String(customers)} />
        <Stat label="Orders" value={String(orders)} />
        <Stat label="Messages (30d)" value={msgs.toLocaleString("en-NG")} delta={wa.length ? wa.map((w) => `${w.phoneNumber ?? "number"}: ${w.status}`).join(", ") : "No WhatsApp number"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Manage"><WorkspaceActions orgId={org.id} status={org.status} plans={plans} currentPlan={sub?.plan.key ?? null} /></Card>
        <Card title="Team">
          <ul className="divide-y divide-border text-sm">{members.map((m) => <li key={m.user.email} className="flex justify-between gap-3 py-2"><span>{m.user.name ?? m.user.email}<span className="block text-xs text-muted">{m.user.email}{m.phone ? ` · ${m.phone}` : ""}</span></span><Badge tone="gray">{m.role.toLowerCase()}</Badge></li>)}</ul>
        </Card>
        <Card title="Payments">
          {txs.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="divide-y divide-border text-sm">{txs.map((t) => <li key={t.id} className="flex justify-between gap-3 py-2"><span>{t.plan.name} · {formatKobo(t.amountCents)}</span><span className="text-xs text-muted">{fmt(t.paidAt ?? t.createdAt)} · {t.status}</span></li>)}</ul>}
        </Card>
        <Card title="Recent activity">
          {logs.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="divide-y divide-border text-sm">{logs.map((l) => <li key={l.id} className="flex justify-between gap-3 py-2"><span>{l.action}</span><span className="text-xs text-muted">{fmt(l.createdAt)}</span></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}
