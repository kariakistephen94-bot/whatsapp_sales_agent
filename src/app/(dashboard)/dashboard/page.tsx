import Link from "next/link";
import { DateTime } from "luxon";
import { getTenantContext } from "@/modules/tenancy/context";
import { count, run, maybe } from "@/server/db";
import { aiResolution, dailySeries, rangeStart, recentActivity, TZ } from "@/modules/analytics/queries";
import { formatKobo } from "@/lib/locale";
import { Card, PageHeader, Stat, Badge, btnPrimary } from "@/components/ui";
import { RevenueArea, MessagesBars, EmptyChart } from "@/components/charts";

export const dynamic = "force-dynamic";

const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);

function ago(d: Date) {
  return DateTime.fromJSDate(d).setZone(TZ).toRelative({ style: "short" }) ?? "";
}

export default async function Overview() {
  const ctx = await getTenantContext();
  const db = ctx.db;
  const orgId = ctx.organizationId;
  const caps = ctx.capabilities;
  const hasOrders = caps.includes("orders");
  const hasBookings = caps.includes("appointments") || caps.includes("reservations");

  const now = new Date();
  const d7 = rangeStart(7).toJSDate();
  const d30 = rangeStart(30).toJSDate();
  const in7 = new Date(now.getTime() + 7 * 864e5);

  const [
    totalCustomers, newCustomers, activeConvos, escalated, msgIn7, msgOut7, orders30, unpaidOld, waConnected,
    upcomingCount, upcoming, resolution, revenueSeries, messageSeries, activity,
  ] = await Promise.all([
    count(db.from("Customer").select("id", { count: "exact", head: true })),
    count(db.from("Customer").select("id", { count: "exact", head: true }).gte("createdAt", d7.toISOString())),
    count(db.from("Conversation").select("id", { count: "exact", head: true }).in("status", ["open", "escalated"])),
    count(db.from("Conversation").select("id", { count: "exact", head: true }).eq("status", "escalated")),
    count(db.from("Message").select("id", { count: "exact", head: true }).eq("direction", "in").gte("createdAt", d7.toISOString())),
    count(db.from("Message").select("id", { count: "exact", head: true }).eq("direction", "out").gte("createdAt", d7.toISOString())),
    hasOrders
      ? count(db.from("Order").select("id", { count: "exact", head: true }).gte("createdAt", d30.toISOString()).neq("status", "CANCELLED"))
      : Promise.resolve(0),
    hasOrders
      ? count(db.from("Order").select("id", { count: "exact", head: true })
          .in("paymentStatus", ["UNPAID", "PENDING"]).neq("status", "CANCELLED").lt("createdAt", new Date(now.getTime() - 864e5).toISOString()))
      : Promise.resolve(0),
    count(db.from("WhatsappConnection").select("id", { count: "exact", head: true }).eq("status", "connected")),
    hasBookings
      ? count(db.from("Appointment").select("id", { count: "exact", head: true }).eq("status", "booked").gte("startsAt", now.toISOString()).lte("startsAt", in7.toISOString()))
      : Promise.resolve(0),
    hasBookings
      ? run<{ id: string; startsAt: Date; status: string; customer: { name: string | null; phone: string }; service: { name: string }; staff: { name: string } | null }[]>(
          db.from("Appointment")
            .select("id, startsAt, status, customer:Customer(name, phone), service:CatalogItem(name), staff:StaffMember(name)")
            .eq("status", "booked").gte("startsAt", now.toISOString()).order("startsAt", { ascending: true }).limit(6),
        )
      : Promise.resolve([]),
    aiResolution(orgId, d30),
    dailySeries(orgId, 30),
    dailySeries(orgId, 7),
    recentActivity(orgId, 8),
  ]);

  const revenue30 = revenueSeries.reduce((s, r) => s + r.orderRevenueKobo + r.appointmentRevenueKobo, 0);
  const revenueChart = revenueSeries.map((r) => ({ day: r.label, revenue: (r.orderRevenueKobo + r.appointmentRevenueKobo) / 100 }));
  const messagesChart = messageSeries.map((r) => ({ day: r.label, received: r.messagesIn, sent: r.messagesOut }));
  const hasMessages = msgIn7 + msgOut7 > 0;

  const tiles: { label: string; value: string; delta?: string }[] = [
    { label: "Total customers", value: totalCustomers.toLocaleString("en-NG"), delta: `${newCustomers} new in the last 7 days` },
    { label: "Active conversations", value: activeConvos.toLocaleString("en-NG"), delta: escalated ? `${escalated} waiting for your team` : "Open or escalated" },
    { label: "Messages · 7 days", value: `${msgIn7.toLocaleString("en-NG")} in · ${msgOut7.toLocaleString("en-NG")} out` },
  ];
  if (hasOrders) tiles.push({ label: "Orders · 30 days", value: orders30.toLocaleString("en-NG"), delta: "Excludes cancelled orders" });
  if (hasOrders || hasBookings) tiles.push({ label: "Revenue · 30 days", value: revenue30 ? formatKobo(revenue30) : "—", delta: hasBookings ? "Paid orders + completed appointments" : "Paid orders only" });
  if (hasBookings) tiles.push({ label: "Upcoming appointments · 7 days", value: upcomingCount.toLocaleString("en-NG") });
  tiles.push({ label: "AI resolution rate · 30 days", value: pct(resolution.rate), delta: resolution.total ? `${resolution.resolved} of ${resolution.total} AI conversations needed no human` : "No AI conversations yet" });

  const myPhone = await maybe<{ phone: string | null }>(db.from("Membership").select("phone").eq("userId", ctx.userId).maybeSingle());
  const attention = [
    !myPhone?.phone && { text: "Add your WhatsApp number to get hand-off alerts", href: "/dashboard/team", cta: "Add" },
    escalated > 0 && { text: `${escalated} escalated conversation${escalated === 1 ? "" : "s"}`, href: "/dashboard/conversations", cta: "Open" },
    unpaidOld > 0 && { text: `${unpaidOld} unpaid order${unpaidOld === 1 ? "" : "s"} older than 24h`, href: "/dashboard/orders", cta: "Review" },
    waConnected === 0 && { text: "WhatsApp is not connected", href: "/dashboard/settings", cta: "Connect" },
  ].filter(Boolean) as { text: string; href: string; cta: string }[];

  return (
    <div>
      <PageHeader title="Overview" sub="How your AI agent and business are doing."
        actions={hasBookings ? <Link href="/dashboard/appointments" className={btnPrimary}>New booking</Link> : hasOrders ? <Link href="/dashboard/orders" className={btnPrimary}>View orders</Link> : null} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{tiles.map((k) => <Stat key={k.label} {...k} />)}</div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {(hasOrders || hasBookings) ? (
          <Card title="Revenue · last 30 days" className="lg:col-span-2">
            {revenue30 ? <RevenueArea data={revenueChart} /> : <EmptyChart text="No paid orders or completed appointments in the last 30 days." />}
          </Card>
        ) : (
          <Card title="Messages · this week" className="lg:col-span-2">
            {hasMessages ? <MessagesBars data={messagesChart} /> : <EmptyChart text="No WhatsApp messages this week yet." />}
          </Card>
        )}
        <Card title="Needs attention">
          {attention.length ? (
            <ul className="space-y-3 text-sm">
              {attention.map((a) => (
                <li key={a.text} className="flex items-start justify-between gap-2"><span>{a.text}</span><Link className="shrink-0 text-accent" href={a.href}>{a.cta}</Link></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">All clear — nothing needs your attention right now.</p>}
        </Card>

        {(hasOrders || hasBookings) && (
          <Card title="Messages · this week" className="lg:col-span-2">
            {hasMessages ? <MessagesBars data={messagesChart} height={220} /> : <EmptyChart height={220} text="No WhatsApp messages this week yet." />}
          </Card>
        )}
        <Card title="Recent activity" className={hasOrders || hasBookings ? "" : "lg:col-span-3"}>
          {activity.length ? (
            <ul className="space-y-3 text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  {a.href ? <Link href={a.href} className="min-w-0 truncate hover:underline">{a.text}</Link> : <span className="min-w-0 truncate">{a.text}</span>}
                  <span className="shrink-0 text-xs text-muted">{ago(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No activity yet.</p>}
        </Card>

        {hasBookings && (
          <Card title="Upcoming appointments" className="lg:col-span-3" action={<Link href="/dashboard/appointments" className="text-xs text-accent">View all</Link>}>
            {upcoming.length ? (
              <ul className="divide-y divide-border/60 text-sm">
                {upcoming.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0"><span className="font-medium">{a.customer.name ?? a.customer.phone}</span> <span className="text-muted">· {a.service.name}{a.staff ? ` with ${a.staff.name}` : ""}</span></div>
                    <div className="flex items-center gap-3"><span className="text-muted">{DateTime.fromJSDate(a.startsAt).setZone(TZ).toFormat("ccc d LLL, h:mm a")}</span><Badge>Booked</Badge></div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No upcoming appointments.</p>}
          </Card>
        )}
      </div>
    </div>
  );
}
