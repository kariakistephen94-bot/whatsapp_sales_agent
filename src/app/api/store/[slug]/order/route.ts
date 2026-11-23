import { z } from "zod";
import { count, run, tenant } from "@/server/db";
import { createOrder } from "@/modules/orders/service";
import { clientIp, publishedOrg, upsertStoreCustomer } from "@/modules/storefront/public";
import { normalizeNgPhone } from "@/lib/locale";
import { rateLimit } from "@/server/rate-limit";
import { logger } from "@/server/logger";

const Body = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  items: z.array(z.object({ itemId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(99) })).min(1).max(50),
  deliveryMethod: z.enum(["pickup", "delivery"]),
  address: z.string().trim().max(400).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
});

/** Public checkout: creates an UNPAID order (prices from the database). Payment is arranged on WhatsApp. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip = clientIp(req);
  if (!(await rateLimit(`store-order:${ip}`, 5, 600))) return Response.json({ error: "Too many orders from this device. Please try again later." }, { status: 429 });

  const org = await publishedOrg(slug);
  if (!org) return Response.json({ error: "Store not found" }, { status: 404 });
  if (!org.capabilities.includes("orders")) return Response.json({ error: "This store doesn't take orders online" }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check your details and try again." }, { status: 400 });
  const d = parsed.data;
  const phone = normalizeNgPhone(d.phone);
  if (!phone) return Response.json({ error: "Enter a valid phone number, e.g. 0803 123 4567" }, { status: 400 });
  if (d.deliveryMethod === "delivery") {
    if (!org.capabilities.includes("delivery")) return Response.json({ error: "Delivery isn't available — please choose pickup" }, { status: 400 });
    if (d.address.length < 5) return Response.json({ error: "Enter a delivery address" }, { status: 400 });
  }

  // Merge duplicate lines and make sure every item is a sellable product/menu item of THIS store.
  const qty = new Map<string, number>();
  for (const i of d.items) qty.set(i.itemId, Math.min(99, (qty.get(i.itemId) ?? 0) + i.quantity));
  const sellable = await count(
    tenant(org.id).from("CatalogItem").select("id", { count: "exact", head: true })
      .in("id", [...qty.keys()]).eq("active", true).in("kind", ["PRODUCT", "MENU_ITEM"]),
  );
  if (sellable !== qty.size) return Response.json({ error: "Some items in your cart are no longer available. Please refresh the page." }, { status: 409 });

  try {
    const customer = await upsertStoreCustomer(org.id, phone, d.name);
    const r = await createOrder({
      organizationId: org.id, customerId: customer.id,
      items: [...qty.entries()].map(([itemId, quantity]) => ({ itemId, quantity })),
      delivery: { method: d.deliveryMethod, address: d.deliveryMethod === "delivery" ? d.address : undefined, notes: d.notes || undefined },
      source: "storefront", notes: d.notes || null,
    });
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 });
    await run(tenant(org.id).from("AuditLog").insert({ action: "storefront.order", entity: "order", entityId: r.orderId, meta: { number: r.number } }));
    return Response.json({ ok: true, number: r.number, totalCents: r.totalCents, items: r.items, whatsapp: org.whatsapp });
  } catch (e) {
    logger.error(e, "storefront order failed");
    return Response.json({ error: "We couldn't place your order. Please try again." }, { status: 500 });
  }
}
