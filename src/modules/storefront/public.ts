import "server-only";
import { from, maybe, must, tenant, type Customer, type ItemKind, type Json, type OrgStatus, type Storefront, one } from "@/server/db";
import { asHours, describeHours } from "@/modules/appointments/hours";
import { normalizeNgPhone } from "@/lib/locale";

/**
 * Public storefront data access. Only ever exposes a store's public profile and ACTIVE catalog —
 * never customers, orders, stock counts or any other internal data.
 */

export interface PublicItem { id: string; name: string; description: string | null; priceCents: number; durationMins: number | null; image: string | null; category: string | null; soldOut: boolean }
export interface PublicStore {
  slug: string; name: string; description: string | null; brandColor: string; logoUrl: string | null; coverUrl: string | null;
  address: string | null; hours: string | null; social: { instagram?: string; tiktok?: string; facebook?: string; website?: string };
  whatsapp: string | null; published: boolean;
  canOrder: boolean; canBook: boolean; delivery: boolean;
  services: PublicItem[]; products: PublicItem[]; menu: PublicItem[];
}

/** wa.me wants international digits without "+". Prefer the connected WhatsApp number, else the business phone. */
export function whatsappDigits(connected: string | null | undefined, phone: string | null | undefined) {
  const c = connected?.replace(/\D/g, "");
  if (c && c.length >= 8) return c;
  const p = phone ? normalizeNgPhone(phone) : null;
  return p ? p.replace(/\D/g, "") : null;
}

export async function getPublicStore(slug: string): Promise<(PublicStore & { organizationId: string }) | null> {
  type Item = { id: string; kind: ItemKind; name: string; description: string | null; priceCents: number; durationMins: number | null; images: string[]; category: string | null; trackInventory: boolean; stock: number | null };
  const org = await maybe<{
    id: string; slug: string; name: string; description: string | null; address: string | null; city: string | null; phone: string | null;
    status: OrgStatus; capabilities: string[]; businessHours: Json | null; storefront: Storefront | null;
    whatsappConnections: { phoneNumber: string | null }[]; items: Item[];
  }>(
    from("Organization")
      .select(
        "id, slug, name, description, address, city, phone, status, capabilities, businessHours, storefront:Storefront(*), " +
        "whatsappConnections:WhatsappConnection(phoneNumber), " +
        "items:CatalogItem(id, kind, name, description, priceCents, durationMins, images, category, trackInventory, stock)",
      )
      .eq("slug", slug)
      .eq("whatsappConnections.status", "connected")
      .limit(1, { referencedTable: "whatsappConnections" })
      .eq("items.active", true)
      .order("category", { referencedTable: "items", ascending: true })
      .order("name", { referencedTable: "items", ascending: true })
      .limit(500, { referencedTable: "items" })
      .maybeSingle(),
  );
  if (org) org.storefront = one(org.storefront);
  if (!org || !org.storefront || org.status === "SUSPENDED" || org.status === "CANCELLED") return null;
  const sf = org.storefront;
  const caps = org.capabilities;
  const social = ((sf.settings as any)?.social ?? {}) as PublicStore["social"];
  const map = (i: Item): PublicItem => ({
    id: i.id, name: i.name, description: i.description, priceCents: i.priceCents, durationMins: i.durationMins,
    image: i.images?.[0] ?? null, category: i.category, soldOut: i.trackInventory && (i.stock ?? 0) <= 0,
  });
  const hours = asHours(org.businessHours);
  return {
    organizationId: org.id,
    slug: org.slug, name: sf.name || org.name, description: sf.description ?? org.description, brandColor: sf.brandColor,
    logoUrl: sf.logoUrl, coverUrl: sf.coverUrl,
    address: [org.address, org.city].filter(Boolean).join(", ") || null,
    hours: hours ? describeHours(hours) : null,
    social: Object.fromEntries(Object.entries(social).filter(([, v]) => typeof v === "string" && v.trim())) as PublicStore["social"],
    whatsapp: whatsappDigits(org.whatsappConnections[0]?.phoneNumber, org.phone),
    published: sf.published,
    canOrder: caps.includes("orders"),
    canBook: caps.includes("appointments") || caps.includes("reservations"),
    delivery: caps.includes("delivery"),
    services: org.items.filter((i) => i.kind === "SERVICE").map(map),
    products: org.items.filter((i) => i.kind === "PRODUCT").map(map),
    menu: org.items.filter((i) => i.kind === "MENU_ITEM").map(map),
  };
}

/** For public API routes: the org behind a PUBLISHED storefront, or null. */
export async function publishedOrg(slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const org = await maybe<{
    id: string; name: string; status: OrgStatus; capabilities: string[]; timezone: string; phone: string | null;
    storefront: { published: boolean } | null; whatsappConnections: { phoneNumber: string | null }[];
  }>(
    from("Organization")
      .select("id, name, status, capabilities, timezone, phone, storefront:Storefront(published), whatsappConnections:WhatsappConnection(phoneNumber)")
      .eq("slug", slug)
      .eq("whatsappConnections.status", "connected")
      .limit(1, { referencedTable: "whatsappConnections" })
      .maybeSingle(),
  );
  if (org) org.storefront = one(org.storefront);
  if (!org?.storefront?.published || org.status === "SUSPENDED" || org.status === "CANCELLED") return null;
  return { ...org, whatsapp: whatsappDigits(org.whatsappConnections[0]?.phoneNumber, org.phone) };
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Finds or creates the storefront customer by phone. Never overwrites an existing name. */
export async function upsertStoreCustomer(organizationId: string, phone: string, name: string): Promise<Customer> {
  const db = tenant(organizationId);
  const existing = await maybe<Customer>(db.from("Customer").select("*").eq("phone", phone).maybeSingle());
  if (existing) {
    return must<Customer>(
      db.from("Customer").update({ name: existing.name ?? name, lastInteractionAt: new Date().toISOString() }).eq("id", existing.id).select().single(),
    );
  }
  try {
    return await must<Customer>(db.from("Customer").insert({ phone, name, source: "storefront", lastInteractionAt: new Date().toISOString() }).select().single());
  } catch {
    // concurrent create for the same phone
    return must<Customer>(db.from("Customer").select("*").eq("phone", phone).single());
  }
}
