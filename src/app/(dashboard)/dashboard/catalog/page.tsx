import { getTenantContext, hasRole } from "@/modules/tenancy/context";
import { planLimits } from "@/modules/billing/usage";
import { run, type CatalogItem } from "@/server/db";
import { CatalogView, type CatalogRow, type CatalogTab } from "@/components/commerce/catalog-view";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const ctx = await getTenantContext();
  const caps = ctx.capabilities;

  const tabs: CatalogTab[] = [];
  const bookable = caps.includes("services") || caps.includes("appointments") || caps.includes("reservations");
  if (bookable) tabs.push({ kind: "SERVICE", label: caps.includes("services") || caps.includes("appointments") ? "Services" : "Reservation types" });
  if (caps.includes("products")) tabs.push({ kind: "PRODUCT", label: "Products" });
  if (caps.includes("menu")) tabs.push({ kind: "MENU_ITEM", label: "Menu" });
  if (!tabs.length) tabs.push({ kind: "SERVICE", label: "Services" }, { kind: "PRODUCT", label: "Products" });

  const [items, limits] = await Promise.all([
    run<(CatalogItem & { orderItems: { count: number }[]; appointments: { count: number }[] })[]>(
      ctx.db.from("CatalogItem").select("*, orderItems:OrderItem(count), appointments:Appointment(count)")
        .order("category", { ascending: true, nullsFirst: false }).order("name", { ascending: true }),
    ),
    planLimits(ctx.organizationId),
  ]);

  // Never hide existing items just because capabilities changed.
  const KIND_LABEL = { SERVICE: "Services", PRODUCT: "Products", MENU_ITEM: "Menu" } as const;
  for (const k of new Set(items.map((i) => i.kind))) if (!tabs.some((t) => t.kind === k)) tabs.push({ kind: k, label: KIND_LABEL[k], readOnly: true });

  const rows: CatalogRow[] = items.map((i) => ({
    id: i.id, kind: i.kind, name: i.name, description: i.description, category: i.category, priceCents: i.priceCents,
    durationMins: i.durationMins, trackInventory: i.trackInventory, stock: i.stock, active: i.active, images: i.images ?? [],
    used: (i.orderItems[0]?.count ?? 0) + (i.appointments[0]?.count ?? 0) > 0,
  }));

  return (
    <CatalogView rows={rows} tabs={tabs} canEdit={hasRole(ctx.role, "ADMIN")}
      inventoryDefault={caps.includes("inventory")} limit={limits.products} />
  );
}
