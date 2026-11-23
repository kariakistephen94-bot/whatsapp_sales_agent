import { isUniqueViolation, maybe, rpc, tenant, type Order, type OrderStatus } from "@/server/db";
import { refreshCustomer } from "@/modules/customers/service";

export type CreateOrderResult =
  | { ok: true; orderId: string; number: number; totalCents: number; items: { name: string; quantity: number; unitCents: number }[] }
  | { ok: false; error: string };

/**
 * Creates an order from catalog items. Prices always come from the database (never from the caller or the AI),
 * stock is decremented atomically, and the order starts UNPAID — payment is a separate, explicit step.
 * The whole thing runs in one Postgres transaction (app_create_order).
 */
export async function createOrder(input: {
  organizationId: string; customerId: string;
  items: { itemId: string; quantity: number; variant?: Record<string, string> | null }[];
  delivery?: { method?: string; address?: string; notes?: string } | null;
  source: "whatsapp" | "storefront" | "manual"; createdByAi?: boolean; conversationId?: string | null; notes?: string | null;
  discountCents?: number;
}): Promise<CreateOrderResult> {
  if (!input.items.length) return { ok: false, error: "Order has no items" };
  if (input.items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 999)) return { ok: false, error: "Invalid quantity" };
  if (!input.organizationId) throw new Error("createOrder requires an organizationId");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await rpc<CreateOrderResult>("app_create_order", {
        p_org: input.organizationId,
        p_customer: input.customerId,
        p_items: input.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity, variant: i.variant ?? null })),
        p_delivery: input.delivery ?? null,
        p_source: input.source,
        p_created_by_ai: !!input.createdByAi,
        p_conversation: input.conversationId ?? null,
        p_notes: input.notes ?? null,
        p_discount: Math.trunc(input.discountCents ?? 0),
      });
    } catch (e) {
      if (isUniqueViolation(e)) continue; // order number race (shouldn't happen under the advisory lock): retry
      throw e;
    }
  }
  return { ok: false, error: "Could not create the order, please retry" };
}

/** Cancelling returns tracked stock; both happen in one transaction (app_set_order_status). */
export async function setOrderStatus(organizationId: string, orderId: string, status: OrderStatus) {
  return rpc<Order | null>("app_set_order_status", { p_org: organizationId, p_order: orderId, p_status: status });
}

/** Payment is only ever marked by staff (e.g. bank transfer received) or a verified gateway webhook. */
export async function markOrderPaid(organizationId: string, orderId: string, method: string) {
  const t = tenant(organizationId);
  const order = await maybe<Order>(t.from("Order").select("*").eq("id", orderId).maybeSingle());
  if (!order || order.paymentStatus === "PAID") return order;
  const updated = await maybe<Order>(
    t.from("Order").update({ paymentStatus: "PAID", paidAt: new Date().toISOString(), paymentMethod: method })
      .eq("id", order.id).neq("paymentStatus", "PAID").select().maybeSingle(),
  );
  await refreshCustomer(order.customerId);
  // null only if a concurrent call marked it paid first; return the current row then.
  return updated ?? (await maybe<Order>(t.from("Order").select("*").eq("id", order.id).maybeSingle()));
}

export async function markOrderUnpaid(organizationId: string, orderId: string) {
  const t = tenant(organizationId);
  const order = await maybe<Order>(t.from("Order").select("*").eq("id", orderId).maybeSingle());
  if (!order) return null;
  const updated = await maybe<Order>(
    t.from("Order").update({ paymentStatus: "UNPAID", paidAt: null }).eq("id", order.id).select().maybeSingle(),
  );
  await refreshCustomer(order.customerId);
  return updated;
}
