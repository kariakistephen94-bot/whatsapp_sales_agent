"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { maybe, run, type OrderStatus } from "@/server/db";
import { action, UserError, type TenantContext } from "@/modules/tenancy/context";
import { createOrder, markOrderPaid, markOrderUnpaid, setOrderStatus } from "@/modules/orders/service";
import { followupQueue } from "@/server/queue";
import { logger } from "@/server/logger";
import { normalizeNgPhone } from "@/lib/locale";

const PAYMENT_METHODS = ["bank_transfer", "cash", "pos", "card"] as const;
const STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "COMPLETED", "CANCELLED"] as const;

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Please check the form and try again.");
  return r.data;
}

const customerInput = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ name: z.string().trim().min(2, "Enter the customer's name").max(120), phone: z.string().trim().min(7, "Enter a valid phone number") }),
]);

/** Existing customer (verified to belong to this org) or upsert a new one by phone. */
async function resolveCustomer(ctx: TenantContext, input: z.infer<typeof customerInput>) {
  if ("id" in input) {
    const c = await maybe<{ id: string }>(ctx.db.from("Customer").select("id").eq("id", input.id).maybeSingle());
    if (!c) throw new UserError("Customer not found");
    return c.id;
  }
  const phone = normalizeNgPhone(input.phone);
  if (!phone) throw new UserError("That phone number doesn't look valid. Use e.g. 0803 123 4567 or +234 803 123 4567.");
  // Create if missing; never overwrite an existing customer (update: {} before).
  await run(ctx.db.from("Customer").upsert({ phone, name: input.name, source: "manual" }, { onConflict: "organizationId,phone", ignoreDuplicates: true }));
  const c = await maybe<{ id: string; name: string | null }>(ctx.db.from("Customer").select("id, name").eq("phone", phone).maybeSingle());
  if (!c) throw new UserError("Customer not found");
  if (!c.name) await run(ctx.db.from("Customer").update({ name: input.name }).eq("id", c.id));
  return c.id;
}

/** Quote a value for a PostgREST or=() filter and escape LIKE wildcards, so user input can't change the filter. */
const likeValue = (v: string) => `"%${v.replace(/[\\%_]/g, "\\$&").replace(/["\\]/g, "\\$&")}%"`;

export async function searchCustomers(q: string) {
  return action("STAFF", async (ctx) => {
    const term = String(q ?? "").trim().slice(0, 60);
    if (term.length < 2) return [];
    const digits = term.replace(/\D/g, "");
    const or = [`name.ilike.${likeValue(term)}`];
    if (digits.length >= 3) or.push(`phone.like.${likeValue(digits.replace(/^0/, ""))}`);
    return run<{ id: string; name: string | null; phone: string }[]>(
      ctx.db.from("Customer").select("id, name, phone").or(or.join(","))
        .order("lastInteractionAt", { ascending: false, nullsFirst: false }).limit(8),
    );
  });
}

const newOrderSchema = z.object({
  customer: customerInput,
  items: z.array(z.object({ itemId: z.string().min(1), quantity: z.number().int().min(1, "Quantity must be at least 1").max(999) })).min(1, "Add at least one item"),
  delivery: z.object({ method: z.string().trim().max(40).optional(), address: z.string().trim().max(400).optional() }).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function createManualOrder(input: z.input<typeof newOrderSchema>) {
  return action("STAFF", async (ctx) => {
    const d = parse(newOrderSchema, input);
    const customerId = await resolveCustomer(ctx, d.customer);
    // Merge duplicate lines so stock checks see the real quantity.
    const merged = new Map<string, number>();
    for (const i of d.items) merged.set(i.itemId, (merged.get(i.itemId) ?? 0) + i.quantity);
    const delivery = d.delivery?.method || d.delivery?.address ? { method: d.delivery.method || undefined, address: d.delivery.address || undefined } : null;
    const res = await createOrder({
      organizationId: ctx.organizationId, customerId, source: "manual",
      items: [...merged].map(([itemId, quantity]) => ({ itemId, quantity })),
      delivery, notes: d.notes || null,
    });
    if (!res.ok) throw new UserError(res.error);
    await audit(ctx, "order.created", res.orderId, { number: res.number, source: "manual" });
    revalidatePath("/dashboard/orders");
    return { orderId: res.orderId, number: res.number };
  });
}

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  return action("STAFF", async (ctx) => {
    const s = parse(z.enum(STATUSES), status);
    const order = await maybe<{ id: string; status: OrderStatus }>(ctx.db.from("Order").select("id, status").eq("id", String(orderId)).maybeSingle());
    if (!order) throw new UserError("Order not found");
    if (order.status === s) return { status: s };
    // Cancelling returns stock; reopening would need it taken again, so a new order is the safe path.
    if (order.status === "CANCELLED") throw new UserError("Cancelled orders can't be reopened. Create a new order instead.");
    await setOrderStatus(ctx.organizationId, order.id, s);
    if (s === "CONFIRMED") {
      try {
        await followupQueue().add("order_confirmation", { kind: "order_confirmation", organizationId: ctx.organizationId, orderId: order.id }, { jobId: `oc-${order.id}` });
      } catch (e) {
        logger.warn({ err: e }, "could not queue order confirmation");
      }
    }
    await audit(ctx, "order.status_changed", order.id, { from: order.status, to: s });
    revalidatePath("/dashboard/orders");
    return { status: s };
  });
}

export async function markPaid(orderId: string, method: (typeof PAYMENT_METHODS)[number]) {
  return action("STAFF", async (ctx) => {
    const m = parse(z.enum(PAYMENT_METHODS, { errorMap: () => ({ message: "Choose how the customer paid" }) }), method);
    const order = await maybe<{ id: string; status: OrderStatus }>(ctx.db.from("Order").select("id, status").eq("id", String(orderId)).maybeSingle());
    if (!order) throw new UserError("Order not found");
    if (order.status === "CANCELLED") throw new UserError("This order is cancelled.");
    await markOrderPaid(ctx.organizationId, order.id, m);
    await audit(ctx, "order.marked_paid", order.id, { method: m });
    revalidatePath("/dashboard/orders");
    return { paid: true };
  });
}

export async function markUnpaid(orderId: string) {
  return action("STAFF", async (ctx) => {
    const order = await maybe<{ id: string }>(ctx.db.from("Order").select("id").eq("id", String(orderId)).maybeSingle());
    if (!order) throw new UserError("Order not found");
    await markOrderUnpaid(ctx.organizationId, order.id);
    await audit(ctx, "order.marked_unpaid", order.id);
    revalidatePath("/dashboard/orders");
    return { paid: false };
  });
}

async function audit(ctx: TenantContext, act: string, entityId: string, meta?: Record<string, unknown>) {
  await run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: act, entity: "order", entityId, meta: meta ?? null })).catch(() => {});
}
