import { RELATIONSHIP_LABEL, RELATIONSHIP_TONE } from "@/modules/relationships/model";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MessageSquare, Sparkles } from "lucide-react";
import { getTenantContext, hasRole } from "@/modules/tenancy/context";
import { count, from, maybe, must, run, type Customer, type HandlerMode, type OrderStatus, type PaymentStatus } from "@/server/db";
import { STATUS_LABEL } from "@/modules/customers/service";
import { formatKobo } from "@/lib/locale";
import { Avatar, Badge, Card, Stat, Table, Td, Th } from "@/components/ui";
import { fmtDate, fmtDateTime, relativeTime } from "@/components/crm/format";
import { DetailsEditor, PreferencesEditor, PrivacyControls, TagEditor } from "@/components/crm/profile-editors";

export const dynamic = "force-dynamic";

const ORDER_STATUS: Record<string, string> = { PENDING: "Pending", CONFIRMED: "Confirmed", PROCESSING: "Processing", COMPLETED: "Completed", CANCELLED: "Cancelled" };
const PAY_STATUS: Record<string, string> = { UNPAID: "Unpaid", PENDING: "Payment pending", PAID: "Paid", REFUNDED: "Refunded" };
const APPT_STATUS: Record<string, string> = { booked: "Booked", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };
const SENDER: Record<string, string> = { customer: "Customer", ai: "AI agent", human: "Staff", system: "System" };

export default async function CustomerProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getTenantContext();
  const db = ctx.db;
  const found = await maybe<Customer & { tags: { tag: { id: string; name: string } }[] }>(
    db.from("Customer").select("*, tags:CustomerTag(tag:Tag(id, name))").eq("id", id).maybeSingle(),
  );
  if (!found) notFound();
  const c = { ...found, tags: [...found.tags].sort((a, b) => a.tag.name.localeCompare(b.tag.name)) };

  const [org, orders, appointments, paidCount, conversations, allTags, assigneeMember] = await Promise.all([
    must<{ timezone: string }>(from("Organization").select("timezone").eq("id", ctx.organizationId).single()),
    run<{ id: string; number: number; totalCents: number; status: OrderStatus; paymentStatus: PaymentStatus; createdAt: Date; items: { count: number }[] }[]>(
      db.from("Order").select("id, number, totalCents, status, paymentStatus, createdAt, items:OrderItem(count)")
        .eq("customerId", c.id).order("createdAt", { ascending: false }).limit(25),
    ).then((rows) => rows.map((o) => ({ ...o, _count: { items: o.items[0]?.count ?? 0 } }))),
    run<{ id: string; startsAt: Date; status: string; service: { name: string }; staff: { name: string } | null }[]>(
      db.from("Appointment").select("id, startsAt, status, service:CatalogItem(name), staff:StaffMember(name)")
        .eq("customerId", c.id).order("startsAt", { ascending: false }).limit(25),
    ),
    count(db.from("Order").select("id", { count: "exact", head: true }).eq("customerId", c.id).eq("paymentStatus", "PAID")),
    // `first` = each conversation's earliest message (replaces a groupBy _min(createdAt)).
    run<{ id: string; status: string; handler: HandlerMode; lastMessageAt: Date; first: { createdAt: Date }[] }[]>(
      db.from("Conversation").select("id, status, handler, lastMessageAt, first:Message(createdAt)")
        .eq("customerId", c.id).order("lastMessageAt", { ascending: false })
        .order("createdAt", { referencedTable: "first", ascending: true }).limit(1, { referencedTable: "first" }),
    ),
    run<{ name: string }[]>(db.from("Tag").select("name").order("name", { ascending: true }).limit(200)),
    c.assignedToId
      ? maybe<{ user: { name: string | null; email: string } }>(
          db.from("Membership").select("user:User(name, email)").eq("userId", c.assignedToId).limit(1).maybeSingle(),
        )
      : null,
  ]);
  const completedVisits = await count(db.from("Appointment").select("id", { count: "exact", head: true }).eq("customerId", c.id).eq("status", "completed"));
  const latest = conversations[0] ?? null;
  const recentMessages = latest
    ? await run<{ id: string; sender: string; body: string | null; mediaType: string | null; createdAt: Date }[]>(
        db.from("Message").select("id, sender, body, mediaType, createdAt").eq("conversationId", latest.id).order("createdAt", { ascending: false }).limit(5),
      )
    : [];
  const convoStarts = conversations.map((x) => ({ _min: { createdAt: x.first[0]?.createdAt ?? null } }));

  const tz = org.timezone || "Africa/Lagos";
  const name = c.name?.trim() || c.phone;
  const prefsRaw = (c.preferences as { notes?: unknown } | null)?.notes;
  const preferences = Array.isArray(prefsRaw) ? prefsRaw.map(String) : [];
  const now = Date.now();

  type Ev = { at: Date; text: string };
  const timeline: Ev[] = [
    { at: c.createdAt, text: c.source === "manual" ? "Added manually by your team" : c.source === "storefront" ? "Profile created from a storefront order" : "Profile created from WhatsApp" },
    ...convoStarts.filter((s) => s._min.createdAt).map((s) => ({ at: s._min.createdAt as Date, text: "Started a WhatsApp conversation" })),
    ...orders.map((o) => ({ at: o.createdAt, text: `Order #${o.number} · ${formatKobo(o.totalCents)} · ${PAY_STATUS[o.paymentStatus] ?? o.paymentStatus}` })),
    ...appointments.map((a) => ({ at: a.startsAt, text: `${a.service.name}${a.staff ? ` with ${a.staff.name}` : ""} · ${APPT_STATUS[a.status] ?? a.status}` })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 15);

  return (
    <div>
      <Link href="/dashboard/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ChevronLeft size={14} />Customers</Link>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={name} size={48} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{name}</h1>
          <div className="text-sm text-muted">{c.phone}{c.email && ` · ${c.email}`}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{STATUS_LABEL[c.status] ?? c.status}</Badge>
          {c.optedOut && <Badge tone="gray">Opted out</Badge>}
        </div>
        {latest && (
          <Link href={`/dashboard/conversations?c=${latest.id}`} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-bg"><MessageSquare size={14} />Open chat</Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Lifetime value" value={formatKobo(c.lifetimeValueCents)} delta="Paid orders + completed visits" />
        <Stat label="Purchases" value={String(paidCount + completedVisits)} delta={`${paidCount} paid ${paidCount === 1 ? "order" : "orders"} · ${completedVisits} ${completedVisits === 1 ? "visit" : "visits"}`} />
        <Stat label="Last interaction" value={relativeTime(c.lastInteractionAt, tz)} delta={assigneeMember ? `Assigned to ${assigneeMember.user.name || assigneeMember.user.email}` : "Not assigned"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title="Relationship" action={<Badge tone={RELATIONSHIP_TONE[c.relationship] ?? "gray"}>{RELATIONSHIP_LABEL[c.relationship] ?? c.relationship}</Badge>}>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-muted">Visits / orders</dt><dd className="tabular-nums">{c.visitCount}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Usually returns every</dt><dd>{c.avgGapDays ? `~${c.avgGapDays} days` : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Last purchase / visit</dt><dd>{relativeTime(c.lastPurchaseAt, tz)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Expected back</dt><dd>{c.nextBookingAt ? `booked ${fmtDateTime(c.nextBookingAt, tz)}` : c.expectedNextAt ? fmtDate(c.expectedNextAt, tz) : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Last check-in from the AI</dt><dd>{c.lastNudgedAt ? `${relativeTime(c.lastNudgedAt, tz)} (${c.nudgeCount} so far)` : "None sent"}</dd></div>
            </dl>
          </Card>
          {c.insights && (
            <Card title="AI insights"><div className="flex gap-3 text-sm"><Sparkles size={16} className="mt-0.5 shrink-0 text-accent" /><p className="whitespace-pre-wrap">{c.insights}</p></div></Card>
          )}

          <Card title="Recent conversation" action={latest ? <Link href={`/dashboard/conversations?c=${latest.id}`} className="text-xs text-accent">Open in inbox</Link> : undefined}>
            {recentMessages.length ? (
              <ul className="space-y-3 text-sm">
                {[...recentMessages].reverse().map((m) => (
                  <li key={m.id}>
                    <span className="text-xs text-muted">{SENDER[m.sender] ?? m.sender} · {fmtDateTime(m.createdAt, tz)}</span>
                    <p className="whitespace-pre-wrap break-words">{m.body?.trim() || (m.mediaType ? `[${m.mediaType}]` : "")}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No conversations yet.</p>}
          </Card>

          <Card title="Orders">
            {orders.length === 0 ? <p className="text-sm text-muted">No orders yet.</p> : (
              <div className="-m-4">
                <Table>
                  <thead><tr><Th>Order</Th><Th right>Total</Th><Th>Status</Th><Th>Payment</Th><Th>Date</Th></tr></thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <Td><span className="font-medium">#{o.number}</span> <span className="text-xs text-muted">· {o._count.items} {o._count.items === 1 ? "item" : "items"}</span></Td>
                        <Td right label="Total">{formatKobo(o.totalCents)}</Td>
                        <Td label="Status"><Badge>{ORDER_STATUS[o.status] ?? o.status}</Badge></Td>
                        <Td label="Payment"><Badge>{PAY_STATUS[o.paymentStatus] ?? o.paymentStatus}</Badge></Td>
                        <Td label="Date" className="text-muted">{fmtDate(o.createdAt, tz)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>

          <Card title="Appointments">
            {appointments.length === 0 ? <p className="text-sm text-muted">No appointments yet.</p> : (
              <div className="-m-4">
                <Table>
                  <thead><tr><Th>Service</Th><Th>Staff</Th><Th>Time</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {appointments.map((a) => (
                      <tr key={a.id}>
                        <Td><span className="font-medium">{a.service.name}</span>{a.status === "booked" && a.startsAt.getTime() > now && <span className="ml-2 text-xs text-muted">upcoming</span>}</Td>
                        <Td label="Staff" className="text-muted">{a.staff?.name ?? "—"}</Td>
                        <Td label="Time">{fmtDateTime(a.startsAt, tz)}</Td>
                        <Td label="Status"><Badge>{APPT_STATUS[a.status] ?? a.status}</Badge></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card title="Details"><DetailsEditor customerId={c.id} name={c.name} email={c.email} notes={c.notes} /></Card>
          <Card title="Tags"><TagEditor customerId={c.id} tags={c.tags.map((t) => t.tag)} suggestions={allTags.map((t) => t.name)} /></Card>
          <Card title="Preferences"><PreferencesEditor customerId={c.id} preferences={preferences} /></Card>
          <Card title="Activity timeline">
            <ol className="space-y-3 border-l border-border pl-4 text-sm">
              {timeline.map((e, i) => <li key={i}><div className="text-xs text-muted">{fmtDateTime(e.at, tz)}</div>{e.text}</li>)}
            </ol>
          </Card>
          <Card title="Privacy">
            <PrivacyControls customerId={c.id} optedOut={c.optedOut} canDelete={hasRole(ctx.role, "ADMIN")} customerName={name} />
          </Card>
        </div>
      </div>
    </div>
  );
}
