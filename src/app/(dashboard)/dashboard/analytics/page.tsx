import Link from "next/link";
import { Download } from "lucide-react";
import { getTenantContext } from "@/modules/tenancy/context";
import { analyticsSummary } from "@/modules/analytics/queries";
import { formatKobo } from "@/lib/locale";
import { Card, PageHeader, Stat, btn } from "@/components/ui";
import { EmptyChart, FunnelBars, MessagesBars, RevenueArea, ShareDonut } from "@/components/charts";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;
const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);
const num = (n: number) => n.toLocaleString("en-NG");
const money = (k: number) => (k ? formatKobo(k) : "—");

function duration(secs: number | null) {
  if (secs == null) return "—";
  if (secs < 60) return `${secs.toFixed(1)} s`;
  if (secs < 3600) return `${(secs / 60).toFixed(1)} min`;
  return `${(secs / 3600).toFixed(1)} h`;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const days = (RANGES as readonly number[]).includes(Number(sp.range)) ? Number(sp.range) : 30;
  const ctx = await getTenantContext();
  const caps = ctx.capabilities;
  const hasOrders = caps.includes("orders");
  const hasBookings = caps.includes("appointments") || caps.includes("reservations");
  const a = await analyticsSummary(ctx.organizationId, days);

  const revenueChart = a.series.map((r) => ({ day: r.label, revenue: (r.orderRevenueKobo + r.appointmentRevenueKobo) / 100 }));
  const messagesChart = a.series.map((r) => ({ day: r.label, received: r.messagesIn, sent: r.messagesOut }));
  const itemChart = a.revenueByItem.map((i) => ({ name: i.name, value: i.kobo / 100 }));
  const stage = hasOrders && hasBookings ? "Ordered or booked" : hasBookings ? "Booked" : "Ordered";
  const done = hasOrders && hasBookings ? "Paid or completed" : hasBookings ? "Completed visit" : "Paid";
  const funnelData = [
    { stage: "Conversations", n: a.funnel.conversations },
    { stage: "Customers who enquired", n: a.funnel.enquired },
    { stage, n: a.funnel.ordered },
    { stage: done, n: a.funnel.paid },
  ];

  return (
    <div>
      <PageHeader title="Analytics" sub="Conversations, customers and revenue — real numbers only."
        actions={<>
          <div className="flex rounded-md border border-border bg-surface p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={`/dashboard/analytics?range=${r}`} scroll={false}
                className={cn("rounded px-2.5 py-1 text-xs", days === r ? "bg-border/70 font-medium" : "text-muted hover:text-fg")}>{r} days</Link>
            ))}
          </div>
          <a className={btn} href={`/api/analytics/export?range=${days}`}><Download size={14} />Export CSV</a>
        </>} />

      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Conversations & AI</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Conversations" value={num(a.funnel.conversations)} delta={`${num(a.messagesIn)} messages in · ${num(a.messagesOut)} out`} />
        <Stat label="Avg AI response time" value={duration(a.avgResponseSecs)} delta="Customer message → AI reply" />
        <Stat label="AI resolution rate" value={pct(a.resolution.rate)} delta={a.resolution.total ? `${a.resolution.resolved} of ${a.resolution.total} with no human reply` : "No AI conversations yet"} />
        <Stat label="Human handoffs" value={num(a.handoffs)} delta={a.funnel.conversations ? `${Math.round((a.handoffs / a.funnel.conversations) * 100)}% of conversations` : undefined} />
      </div>

      <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-muted">Customers</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="New leads" value={num(a.newLeads)} delta="New customer profiles" />
        <Stat label="Returning customers" value={num(a.returningCustomers)} delta="Messaged again in this period" />
        <Stat label="Conversion rate" value={pct(a.conversionRate)} delta={a.funnel.enquired ? `${a.funnel.converted} of ${a.funnel.enquired} who messaged ${hasBookings ? "paid or booked" : "paid"}` : "No enquiries yet"} />
        <Stat label="Customer retention" value={pct(a.retention.rate)} delta={a.retention.buyers ? `${a.retention.repeat} of ${a.retention.buyers} buyers came back (all time)` : "No purchases yet"} />
        <Stat label="Follow-ups sent" value={num(a.followupsSent)} delta="Scheduled follow-up messages" />
        {hasBookings && <Stat label="Appointment attendance" value={pct(a.attendance.rate)} delta={a.attendance.completed + a.attendance.noShow ? `${a.attendance.noShow} no-show${a.attendance.noShow === 1 ? "" : "s"}` : "No completed or missed visits yet"} />}
      </div>

      <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-muted">Revenue</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {hasOrders && <Stat label="Orders" value={num(a.orders)} delta="Created, excluding cancelled" />}
        <Stat label="Revenue" value={money(a.totalRevenueKobo)} delta={hasBookings && hasOrders ? "Paid orders + completed appointments" : hasBookings ? "Completed appointments" : "Paid orders only"} />
        <Stat label="AI-attributed revenue" value={money(a.revenue.ai)} delta={a.totalRevenueKobo ? `${Math.round((a.revenue.ai / a.totalRevenueKobo) * 100)}% of revenue` : undefined} />
      </div>
      <p className="mt-2 text-xs text-muted">
        Revenue counts only orders marked <b>paid</b>{hasBookings ? " and appointments marked completed (valued at the service's listed price)" : ""}. AI-attributed revenue is the part created by your AI agent inside a WhatsApp conversation; sales that simply happen after a chat are not counted as AI revenue.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Revenue by day">{a.totalRevenueKobo ? <RevenueArea data={revenueChart} /> : <EmptyChart />}</Card>
        <Card title="Messages received vs sent">{a.messagesIn + a.messagesOut ? <MessagesBars data={messagesChart} /> : <EmptyChart text="No messages in this period." />}</Card>
        <Card title={hasBookings && !hasOrders ? "Revenue by service" : "Revenue by item"}>{itemChart.length ? <ShareDonut data={itemChart} /> : <EmptyChart height={160} />}</Card>
        <Card title="Conversion funnel">{a.funnel.conversations || a.funnel.enquired ? <FunnelBars data={funnelData} /> : <EmptyChart height={160} text="The funnel fills in once customers start messaging." />}</Card>
      </div>
    </div>
  );
}
