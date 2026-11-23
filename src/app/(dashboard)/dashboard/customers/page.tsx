import Link from "next/link";
import { Users } from "lucide-react";
import { getTenantContext } from "@/modules/tenancy/context";
import { count, from, must, run, type TenantDb } from "@/server/db";
import { STATUS_LABEL } from "@/modules/customers/service";
import { RELATIONSHIP_LABEL, RELATIONSHIP_TONE } from "@/modules/relationships/model";
import { formatKobo } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { Avatar, Badge, PageHeader, Table, Td, Th, btn } from "@/components/ui";
import { relativeTime } from "@/components/crm/format";
import { CustomerSearch } from "@/components/crm/customer-search";
import { AddCustomer } from "@/components/crm/add-customer";
import { customerSearchWhere } from "@/components/inbox/queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUS_SEGMENTS = ["new", "returning", "high_value", "potential", "inactive"] as const;
const REL_SEGMENTS = ["due", "at_risk", "lapsed"] as const;
type Seg = (typeof STATUS_SEGMENTS)[number] | (typeof REL_SEGMENTS)[number] | "abandoned" | "upcoming";

type CustomerQuery = ReturnType<ReturnType<TenantDb["from"]>["select"]>;

/**
 * Applies a segment filter. "abandoned"/"upcoming" filter through an inner-joined relation, which must
 * be part of the select (see segmentEmbed); embedding never duplicates customer rows.
 */
function segmentEmbed(seg: Seg | null) {
  if (seg === "abandoned") return ", segOrders:Order!inner(id)";
  if (seg === "upcoming") return ", segAppts:Appointment!inner(id)";
  return "";
}
function applySegment(q: CustomerQuery, seg: Seg | null, now: Date): CustomerQuery {
  if (!seg) return q;
  if (seg === "abandoned") {
    return q.eq("segOrders.status", "PENDING").eq("segOrders.paymentStatus", "UNPAID").lt("segOrders.createdAt", new Date(now.getTime() - 864e5).toISOString());
  }
  if (seg === "upcoming") return q.eq("segAppts.status", "booked").gt("segAppts.startsAt", now.toISOString());
  if ((REL_SEGMENTS as readonly string[]).includes(seg)) return q.eq("relationship", seg);
  return q.eq("status", seg);
}

/** Name/email/phone search, shared with the inbox. */
function applySearch(q: CustomerQuery, term: string): CustomerQuery {
  const expr = customerSearchWhere(term);
  return expr ? q.or(expr) : q;
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; seg?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await getTenantContext();
  const q = (sp.q ?? "").slice(0, 100);
  const seg = ([...STATUS_SEGMENTS, ...REL_SEGMENTS, "abandoned", "upcoming"] as string[]).includes(sp.seg ?? "") ? (sp.seg as Seg) : null;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const now = new Date();

  const db = ctx.db;
  const head = { count: "exact" as const, head: true };
  const statusCount$ = (st: string) => count(db.from("Customer").select("id", head).eq("status", st));
  const filtered = (cols: string, opts?: typeof head) => applySearch(applySegment(db.from("Customer").select(cols + segmentEmbed(seg), opts), seg, now), q);

  type Row = {
    id: string; name: string | null; phone: string; status: string; relationship: string; expectedNextAt: Date | null; lifetimeValueCents: number; lastInteractionAt: Date | null; assignedToId: string | null;
    tags: { tag: { id: string; name: string } }[]; paidOrders: { count: number }[]; completedAppts: { count: number }[];
  };
  const relCount$ = (r: string) => count(db.from("Customer").select("id", head).eq("relationship", r));
  const [org, relCounts, statusCounts, abandoned, upcoming, allCount, total, rawRows] = await Promise.all([
    must<{ timezone: string }>(from("Organization").select("timezone").eq("id", ctx.organizationId).single()),
    Promise.all(REL_SEGMENTS.map((r) => relCount$(r))),
    Promise.all(STATUS_SEGMENTS.map(async (st) => ({ status: st as string, n: await statusCount$(st) }))),
    count(applySegment(db.from("Customer").select("id" + segmentEmbed("abandoned"), head), "abandoned", now)),
    count(applySegment(db.from("Customer").select("id" + segmentEmbed("upcoming"), head), "upcoming", now)),
    count(db.from("Customer").select("id", head)),
    count(filtered("id", head)),
    run<Row[]>(
      filtered(
        "id, name, phone, status, relationship, expectedNextAt, lifetimeValueCents, lastInteractionAt, assignedToId, " +
        "tags:CustomerTag(tag:Tag(id, name)), paidOrders:Order(count), completedAppts:Appointment(count)",
      )
        .eq("paidOrders.paymentStatus", "PAID")
        .eq("completedAppts.status", "completed")
        .order("lastInteractionAt", { ascending: false, nullsFirst: false })
        .order("createdAt", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    ),
  ]);
  const rows = rawRows.map((r) => ({ ...r, _count: { orders: r.paidOrders[0]?.count ?? 0, appointments: r.completedAppts[0]?.count ?? 0 } }));
  const tz = org.timezone || "Africa/Lagos";

  // Assigned staff: only resolve users who are members of this organization.
  const assigneeIds = [...new Set(rows.map((r) => r.assignedToId).filter((x): x is string => !!x))];
  const members = assigneeIds.length
    ? await run<{ userId: string; user: { name: string | null; email: string } }[]>(
        db.from("Membership").select("userId, user:User(name, email)").in("userId", assigneeIds),
      )
    : [];
  const assignee = (uid: string | null) => { const m = uid ? members.find((x) => x.userId === uid) : null; return m ? m.user.name || m.user.email : "—"; };

  const statusCount = (s: string) => statusCounts.find((b) => b.status === s)?.n ?? 0;
  const chips: { key: Seg; label: string; n: number }[] = [
    ...STATUS_SEGMENTS.map((s) => ({ key: s as Seg, label: STATUS_LABEL[s], n: statusCount(s) })),
    ...REL_SEGMENTS.map((r, i) => ({ key: r as Seg, label: RELATIONSHIP_LABEL[r], n: relCounts[i] })),
    { key: "abandoned", label: "Abandoned orders", n: abandoned },
    { key: "upcoming", label: "Upcoming appointments", n: upcoming },
  ];
  const href = (p: { seg?: Seg | null; page?: number }) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    const s = p.seg === undefined ? seg : p.seg;
    if (s) u.set("seg", s);
    if (p.page && p.page > 1) u.set("page", String(p.page));
    const str = u.toString();
    return `/dashboard/customers${str ? `?${str}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Customers" sub="Every person who messages you gets a profile automatically." actions={<AddCustomer />} />

      {allCount === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface px-6 py-16 text-center">
          <Users size={20} className="text-muted" />
          <p className="text-sm font-medium">No customers yet</p>
          <p className="max-w-sm text-xs text-muted">Profiles are created automatically when someone messages your WhatsApp number or orders from your storefront. You can also add one manually.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {chips.map((s) => (
              <Link key={s.key} href={href({ seg: seg === s.key ? null : s.key, page: 1 })} scroll={false}
                className={cn("rounded-full border px-3 py-1 text-xs", seg === s.key ? "border-accent bg-accent/10" : "border-border bg-surface text-muted hover:text-fg")}>
                {s.label} <span className="tabular-nums opacity-70">{s.n}</span>
              </Link>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <CustomerSearch initial={q} />
            <span className="text-xs text-muted tabular-nums">{total} {total === 1 ? "customer" : "customers"}{seg || q ? ` of ${allCount}` : ""}</span>
          </div>
          <Table>
            <thead><tr><Th>Customer</Th><Th>Status</Th><Th>Relationship</Th><Th right>Purchases</Th><Th right>Spent</Th><Th>Last interaction</Th><Th>Tags</Th><Th>Assigned</Th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const name = c.name?.trim() || c.phone;
                return (
                  <tr key={c.id} className="hover:bg-bg">
                    <Td><Link href={`/dashboard/customers/${c.id}`} className="flex items-center gap-3"><Avatar name={name} /><span><span className="block font-medium">{name}</span><span className="text-xs text-muted">{c.phone}</span></span></Link></Td>
                    <Td label="Status"><Badge>{STATUS_LABEL[c.status] ?? c.status}</Badge></Td>
                    <Td label="Relationship"><div className="flex flex-col items-start gap-0.5"><Badge tone={RELATIONSHIP_TONE[c.relationship] ?? "gray"}>{RELATIONSHIP_LABEL[c.relationship] ?? c.relationship}</Badge>{c.expectedNextAt && <span className="text-[11px] text-muted">expected {relativeTime(c.expectedNextAt, tz)}</span>}</div></Td>
                    <Td right label="Purchases">{c._count.orders + c._count.appointments}</Td>
                    <Td right label="Spent">{formatKobo(c.lifetimeValueCents)}</Td>
                    <Td label="Last interaction" className="text-muted">{relativeTime(c.lastInteractionAt, tz)}</Td>
                    <Td label="Tags">{c.tags.length ? <div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t.tag.id} tone="gray">{t.tag.name}</Badge>)}</div> : <span className="text-muted">—</span>}</Td>
                    <Td label="Assigned" className="text-muted">{assignee(c.assignedToId)}</Td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">No customers match{q ? ` “${q}”` : ""}.</td></tr>}
            </tbody>
          </Table>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>Page {page} of {pages}</span>
              <div className="flex gap-2">
                {page > 1 ? <Link href={href({ page: page - 1 })} className={btn}>Previous</Link> : <span className={cn(btn, "pointer-events-none opacity-50")}>Previous</span>}
                {page < pages ? <Link href={href({ page: page + 1 })} className={btn}>Next</Link> : <span className={cn(btn, "pointer-events-none opacity-50")}>Next</span>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
