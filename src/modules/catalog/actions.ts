"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, UserError, type TenantContext } from "@/modules/tenancy/context";
import { planLimits } from "@/modules/billing/usage";
import { nairaToKobo } from "@/lib/locale";
import { count, maybe, must, run, type ItemKind } from "@/server/db";

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Please check the form and try again.");
  return r.data;
}

const itemSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["PRODUCT", "SERVICE", "MENU_ITEM"]),
  name: z.string().trim().min(2, "Give it a name").max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(60).optional(),
  priceNaira: z.number({ invalid_type_error: "Enter a price" }).min(0, "Price can't be negative").max(1_000_000_000),
  durationMins: z.number().int().min(5, "Duration must be at least 5 minutes").max(24 * 60).optional().nullable(),
  trackInventory: z.boolean().default(false),
  stock: z.number().int().min(0, "Stock can't be negative").max(10_000_000).optional().nullable(),
  active: z.boolean().default(true),
  images: z.array(z.string().url().max(500)).max(5, "Up to 5 photos per item").default([]),
});

/** Which item kinds the org's capabilities allow. Falls back to products + services when none are set. */
function allowedKinds(caps: string[]) {
  const k = new Set<string>();
  if (caps.includes("services") || caps.includes("appointments") || caps.includes("reservations")) k.add("SERVICE");
  if (caps.includes("products")) k.add("PRODUCT");
  if (caps.includes("menu")) k.add("MENU_ITEM");
  if (!k.size) { k.add("PRODUCT"); k.add("SERVICE"); }
  return k;
}

export async function saveCatalogItem(input: z.input<typeof itemSchema>) {
  return action("ADMIN", async (ctx) => {
    const d = parse(itemSchema, input);
    const isService = d.kind === "SERVICE";
    if (isService && !d.durationMins) throw new UserError("Set how long the service takes");
    const data = {
      kind: d.kind, name: d.name, description: d.description || null, category: d.category || null,
      priceCents: nairaToKobo(d.priceNaira),
      durationMins: isService ? d.durationMins ?? 60 : null,
      trackInventory: !isService && d.trackInventory,
      stock: !isService && d.trackInventory ? d.stock ?? 0 : null,
      active: d.active,
      images: d.images.filter((u) => u.includes("/public-assets/")),
    };

    if (d.id) {
      const existing = await maybe<{ id: string; kind: ItemKind }>(ctx.db.from("CatalogItem").select("id, kind").eq("id", d.id).maybeSingle());
      if (!existing) throw new UserError("Item not found");
      await run(ctx.db.from("CatalogItem").update({ ...data, kind: existing.kind }).eq("id", existing.id));
      await audit(ctx, "catalog.updated", existing.id);
    } else {
      if (!allowedKinds(ctx.capabilities).has(d.kind)) throw new UserError("Your business type doesn't use this kind of item.");
      const max = (await planLimits(ctx.organizationId)).products;
      if (max !== -1 && (await count(ctx.db.from("CatalogItem").select("*", { count: "exact", head: true }))) >= max) {
        throw new UserError(`Your plan allows up to ${max} products & services. Upgrade your plan or delete items you no longer sell.`);
      }
      const created = await must<{ id: string }>(ctx.db.from("CatalogItem").insert(data).select("id").single());
      await audit(ctx, "catalog.created", created.id);
    }
    revalidatePath("/dashboard/catalog");
    return { saved: true };
  });
}

export async function setCatalogItemActive(id: string, active: boolean) {
  return action("ADMIN", async (ctx) => {
    const r = await run<{ id: string }[]>(ctx.db.from("CatalogItem").update({ active: !!active }).eq("id", String(id)).select("id"));
    if (r.length !== 1) throw new UserError("Item not found");
    revalidatePath("/dashboard/catalog");
    return { active: !!active };
  });
}

/** Hard-deletes unused items; items referenced by orders or appointments are deactivated to keep history intact. */
export async function deleteCatalogItem(id: string) {
  return action("ADMIN", async (ctx) => {
    const item = await maybe<{ id: string; name: string; orderItems: { count: number }[]; appointments: { count: number }[] }>(
      ctx.db.from("CatalogItem").select("id, name, orderItems:OrderItem(count), appointments:Appointment(count)").eq("id", String(id)).maybeSingle(),
    );
    if (!item) throw new UserError("Item not found");
    let deactivated = false;
    if ((item.orderItems[0]?.count ?? 0) > 0 || (item.appointments[0]?.count ?? 0) > 0) {
      await run(ctx.db.from("CatalogItem").update({ active: false }).eq("id", item.id));
      deactivated = true;
    } else {
      await run(ctx.db.from("CatalogItem").delete().eq("id", item.id));
    }
    // Staff serviceIds may keep the stale id on purpose: removing it could turn "only this service" into "all services".
    await audit(ctx, deactivated ? "catalog.deactivated" : "catalog.deleted", item.id, { name: item.name });
    revalidatePath("/dashboard/catalog");
    return { deactivated };
  });
}

async function audit(ctx: TenantContext, act: string, entityId: string, meta?: Record<string, unknown>) {
  await run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: act, entity: "catalog_item", entityId, meta: meta ?? null })).catch(() => {});
}
