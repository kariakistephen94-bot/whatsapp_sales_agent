import { requireSuperAdmin } from "@/modules/admin/guard";
import Link from "next/link";
import { from, run } from "@/server/db";
import { serviceStateOf } from "@/modules/billing/usage";
import { relativeTime } from "@/components/crm/format";
import { Badge, PageHeader, Table, Td, Th } from "@/components/ui";

export const dynamic = "force-dynamic";
const esc = (s: string) => s.replace(/[%,()*\\]/g, " ").trim();

export default async function Workspaces({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSuperAdmin(); // never rely on the layout alone
  const q = esc(((await searchParams).q ?? "").slice(0, 80));
  let query = from("Organization").select("id, name, slug, status, createdAt, subscription:Subscription(status, trialEndsAt, currentPeriodEnd, plan:Plan(key, name))").order("createdAt", { ascending: false }).limit(200);
  if (q) query = query.or(`name.ilike.%${q}%,slug.ilike.%${q}%,email.ilike.%${q}%`);
  const rows = await run<{ id: string; name: string; slug: string; status: string; createdAt: Date; subscription: any }[]>(query);
  return (
    <div>
      <PageHeader title="Workspaces" sub={`${rows.length}${rows.length === 200 ? "+" : ""} shown`} />
      <form className="mb-4"><input name="q" defaultValue={q} placeholder="Search name, slug or email…" className="w-full max-w-sm rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40" /></form>
      <Table>
        <thead><tr><Th>Workspace</Th><Th>Status</Th><Th>Plan</Th><Th>Subscription</Th><Th>Created</Th></tr></thead>
        <tbody>
          {rows.map((o) => {
            const sub = Array.isArray(o.subscription) ? o.subscription[0] : o.subscription;
            const st = sub ? serviceStateOf(sub) : null;
            return (
              <tr key={o.id} className="hover:bg-bg">
                <Td><Link href={`/admin/workspaces/${o.id}`} className="font-medium hover:underline">{o.name}</Link><span className="block text-xs text-muted">{o.slug}</span></Td>
                <Td label="Status"><Badge tone={o.status === "SUSPENDED" ? "red" : o.status === "ACTIVE" ? "green" : "gray"}>{o.status.toLowerCase()}</Badge></Td>
                <Td label="Plan">{sub?.plan?.name ?? "—"}</Td>
                <Td label="Subscription">{st ? <Badge tone={st.status === "expired" ? "red" : st.status === "grace" ? "amber" : "green"}>{`${st.status}${st.daysLeft ? ` · ${st.daysLeft}d` : ""}`}</Badge> : "—"}</Td>
                <Td label="Created" className="text-muted">{relativeTime(o.createdAt, "Africa/Lagos")}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
