import { DateTime } from "luxon";
import { getTenantContext } from "@/modules/tenancy/context";
import { from, must, rpc, run, type ItemKind, type Order, type OrderStatus } from "@/server/db";
import { OrdersView, type OrderRow, type SellableItem } from "@/components/commerce/orders-view";

export const dynamic = "force-dynamic";

const STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "COMPLETED", "CANCELLED"];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getTenantContext();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status?.toUpperCase()) ?? null;

  let ordersQ = ctx.db.from("Order")
    .select("*, customer:Customer(id, name, phone), items:OrderItem(id, name, quantity, unitCents)");
  if (status) ordersQ = ordersQ.eq("status", status);

  const [org, orders, stats, items] = await Promise.all([
    must<{ timezone: string }>(from("Organization").select("timezone").eq("id", ctx.organizationId).single()),
    run<(Order & { customer: { id: string; name: string | null; phone: string }; items: { id: string; name: string; quantity: number; unitCents: number }[] })[]>(
      ordersQ.order("createdAt", { ascending: false }).limit(200),
    ),
    // Counts and sums in Postgres (app_order_stats), scoped to this org.
    rpc<{ total: number; paidCents: number; paidCount: number; outstandingCents: number; outstandingCount: number; byStatus: Partial<Record<OrderStatus, number>> }>(
      "app_order_stats", { p_org: ctx.organizationId },
    ),
    run<{ id: string; name: string; kind: ItemKind; priceCents: number; trackInventory: boolean; stock: number | null }[]>(
      ctx.db.from("CatalogItem").select("id, name, kind, priceCents, trackInventory, stock").eq("active", true)
        .order("kind", { ascending: true }).order("name", { ascending: true }),
    ),
  ]);
  const total = Number(stats.total);

  const tz = org.timezone;
  const rows: OrderRow[] = orders.map((o) => {
    const delivery = (o.delivery ?? null) as { method?: string; address?: string; notes?: string } | null;
    return {
      id: o.id, number: o.number, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
      paidAt: o.paidAt ? DateTime.fromJSDate(o.paidAt, { zone: tz }).toFormat("d LLL yyyy, HH:mm") : null,
      date: DateTime.fromJSDate(o.createdAt, { zone: tz }).toFormat("d LLL, HH:mm"),
      customer: { id: o.customer.id, name: o.customer.name, phone: o.customer.phone },
      items: o.items, subtotalCents: o.subtotalCents, discountCents: o.discountCents, totalCents: o.totalCents,
      source: o.source === "storefront" ? "Storefront" : o.source === "manual" ? "Manual" : o.createdByAi ? "AI · WhatsApp" : "WhatsApp",
      delivery: delivery && (delivery.method || delivery.address || delivery.notes) ? delivery : null,
      notes: o.notes,
    };
  });

  const counts = Object.fromEntries(Object.entries(stats.byStatus ?? {}).map(([k, n]) => [k, Number(n)])) as Partial<Record<OrderStatus, number>>;
  const sellable: SellableItem[] = items.map((i) => ({ id: i.id, name: i.name, kind: i.kind, priceCents: i.priceCents, stock: i.trackInventory ? i.stock ?? 0 : null }));

  return (
    <OrdersView
      rows={rows} filter={status} counts={counts} total={total} items={sellable}
      stats={{
        paidCents: Number(stats.paidCents), paidCount: Number(stats.paidCount),
        outstandingCents: Number(stats.outstandingCents), outstandingCount: Number(stats.outstandingCount),
      }}
    />
  );
}
