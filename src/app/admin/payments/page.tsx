import { requireSuperAdmin } from "@/modules/admin/guard";
import { DateTime } from "luxon";
import { from, run } from "@/server/db";
import { formatKobo } from "@/lib/locale";
import { Badge, PageHeader, Table, Td, Th } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Payments() {
  await requireSuperAdmin(); // never rely on the layout alone
  const rows = await run<{ id: string; reference: string; amountCents: number; status: string; createdAt: Date; paidAt: Date | null; org: { id: string; name: string }; plan: { name: string } }[]>(
    from("BillingTransaction").select("id, reference, amountCents, status, createdAt, paidAt, org:Organization(id, name), plan:Plan(name)").order("createdAt", { ascending: false }).limit(200),
  );
  return (
    <div>
      <PageHeader title="Payments" sub="Latest 200 Paystack transactions." />
      <Table>
        <thead><tr><Th>When</Th><Th>Workspace</Th><Th>Plan</Th><Th right>Amount</Th><Th>Status</Th><Th>Reference</Th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <Td className="text-muted">{DateTime.fromJSDate(t.paidAt ?? t.createdAt).setZone("Africa/Lagos").toFormat("d LLL yyyy, h:mm a")}</Td>
              <Td label="Workspace">{t.org.name}</Td><Td label="Plan">{t.plan.name}</Td>
              <Td right label="Amount">{formatKobo(t.amountCents)}</Td>
              <Td label="Status"><Badge tone={t.status === "success" ? "green" : t.status === "failed" ? "red" : "gray"}>{t.status}</Badge></Td>
              <Td label="Reference" className="font-mono text-xs text-muted">{t.reference}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {rows.length === 0 && <p className="mt-6 text-center text-sm text-muted">No payments yet.</p>}
    </div>
  );
}
