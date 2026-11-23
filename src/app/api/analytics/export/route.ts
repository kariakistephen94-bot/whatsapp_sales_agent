import { withTenant } from "@/modules/tenancy/context";
import { dailySeries } from "@/modules/analytics/queries";

const naira = (k: number) => (k / 100).toFixed(2);

/** Daily analytics as CSV for the selected range (7 | 30 | 90 days, Africa/Lagos days). */
export const GET = withTenant("STAFF", async (ctx, req) => {
  const r = Number(new URL(req.url).searchParams.get("range"));
  const days = [7, 30, 90].includes(r) ? r : 30;
  const rows = await dailySeries(ctx.organizationId, days);
  const header = ["date", "messages_in", "messages_out", "new_customers", "orders_created", "paid_order_revenue_ngn", "completed_appointment_revenue_ngn", "ai_attributed_revenue_ngn"];
  const lines = [header.join(",")].concat(rows.map((x) => [
    x.date, x.messagesIn, x.messagesOut, x.newCustomers, x.orders, naira(x.orderRevenueKobo), naira(x.appointmentRevenueKobo), naira(x.aiRevenueKobo),
  ].join(",")));
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="analytics-${days}d-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
