import { DateTime } from "luxon";
import type OpenAI from "openai";
import { tenant, run, maybe, must, type CatalogItem, type Customer, type Order, type OrderItem, type Appointment } from "@/server/db";
import { followupQueue } from "@/server/queue";
import { logger } from "@/server/logger";
import { formatNaira } from "@/lib/locale";
import type { AiTool } from "@/modules/industries/templates";
import { getAvailability, bookAppointment, rescheduleAppointment, cancelAppointment } from "@/modules/appointments/service";
import { createOrder } from "@/modules/orders/service";

export interface ToolContext {
  organizationId: string;
  customerId: string | null;   // null in the playground
  conversationId: string | null;
  timezone: string;
  dryRun: boolean;             // playground: read tools are real, write tools are simulated
  escalated?: { reason: string };
}

type Def = OpenAI.Chat.Completions.ChatCompletionTool;
const fn = (name: AiTool, description: string, properties: Record<string, unknown>, required: string[] = []): Def => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

export const TOOL_DEFS: Record<AiTool, Def> = {
  search_products: fn("search_products", "Search the business's products, services or menu by keywords. Use this before quoting ANY price, duration or availability of an item.", { query: { type: "string" }, kind: { type: "string", enum: ["product", "service", "any"] } }, ["query"]),
  get_product_details: fn("get_product_details", "Get full details (price, duration, stock, variants, description) for one item id from search results.", { itemId: { type: "string" } }, ["itemId"]),
  send_item_photos: fn("send_item_photos", "Send the customer the photo(s) of one product, service or menu item on WhatsApp. Use when they ask to see it, ask what it looks like, or ask for pictures. Needs an itemId from search_products. Only works if the item has photos; never claim to have sent a photo unless this returns ok: true.", { itemId: { type: "string" } }, ["itemId"]),
  send_payment_link: fn("send_payment_link", "Send the customer a secure Paystack payment link for their order, in this chat. Use it right after create_order succeeds, or when the customer asks how to pay or asks for the link. Never say payment was received: the system confirms payment by itself and tells the customer.", { orderNumber: { type: "integer", description: "the order number; omit for the customer's latest unpaid order" } }),
  check_inventory: fn("check_inventory", "Check current stock for an item id.", { itemId: { type: "string" } }, ["itemId"]),
  create_order: fn("create_order", "Create an order for the current customer. Only after the customer has clearly confirmed the items and quantities. Prices are taken from the catalog automatically.", {
    items: { type: "array", items: { type: "object", properties: { itemId: { type: "string" }, quantity: { type: "integer", minimum: 1 } }, required: ["itemId", "quantity"], additionalProperties: false } },
    deliveryMethod: { type: "string", description: "pickup or delivery" }, deliveryAddress: { type: "string" }, notes: { type: "string" },
  }, ["items"]),
  check_order_status: fn("check_order_status", "Look up the current customer's recent orders, or one order by number.", { orderNumber: { type: "integer" } }),
  get_customer_profile: fn("get_customer_profile", "Get the current customer's saved profile: name, preferences, past orders and appointments.", {}),
  update_customer_profile: fn("update_customer_profile", "Save the customer's name, email or a preference they told you (e.g. preferred stylist).", { name: { type: "string" }, email: { type: "string" }, preference: { type: "string", description: "short note to remember" } }),
  check_appointment_availability: fn("check_appointment_availability", "Get real available start times for a service on a date. ALWAYS call this before offering or confirming a time.", { serviceId: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD in the business's timezone" }, staffId: { type: "string" } }, ["serviceId", "date"]),
  book_appointment: fn("book_appointment", "Book an appointment for the current customer at a start time returned by check_appointment_availability, after they confirm.", { serviceId: { type: "string" }, startsAt: { type: "string", description: "ISO datetime exactly as returned by availability" }, staffId: { type: "string" }, notes: { type: "string" } }, ["serviceId", "startsAt"]),
  reschedule_appointment: fn("reschedule_appointment", "Move one of the customer's booked appointments to a new available time.", { appointmentId: { type: "string" }, startsAt: { type: "string" } }, ["appointmentId", "startsAt"]),
  cancel_appointment: fn("cancel_appointment", "Cancel one of the customer's booked appointments after they confirm.", { appointmentId: { type: "string" } }, ["appointmentId"]),
  create_customer_followup: fn("create_customer_followup", "Schedule a single follow-up message to this customer, e.g. when they ask you to remind them later.", { inHours: { type: "number", minimum: 1, maximum: 720 }, reason: { type: "string" }, message: { type: "string", description: "the message to send then" } }, ["inHours", "reason", "message"]),
  escalate_to_human: fn("escalate_to_human", "Hand the conversation to a human staff member: complaints, refunds, angry customers, requests for a person, or anything you cannot answer from verified information.", { reason: { type: "string" } }, ["reason"]),
};

const kobo = (n: number) => formatNaira(n / 100);
const SIMULATED = { note: "TEST MODE: nothing was saved. In a live chat this would be real." };

export async function executeTool(name: string, raw: string, ctx: ToolContext): Promise<unknown> {
  let args: any;
  try { args = raw ? JSON.parse(raw) : {}; } catch { return { ok: false, error: "Invalid arguments" }; }
  const org = ctx.organizationId;
  const t = tenant(org);
  const needCustomer = () => (ctx.customerId ? null : { ok: false, error: "No customer in this test chat" });

  try {
    switch (name as AiTool) {
      case "search_products": {
        const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 1);
        const kind = args.kind === "product" ? ["PRODUCT", "MENU_ITEM"] : args.kind === "service" ? ["SERVICE"] : undefined;
        let q = t.from("CatalogItem").select("*").eq("active", true);
        if (kind) q = q.in("kind", kind);
        const items = await run<CatalogItem[]>(q.limit(200));
        const scored = items.map((i) => ({ i, s: words.filter((w) => `${i.name} ${i.category ?? ""} ${i.description ?? ""}`.toLowerCase().includes(w)).length }))
          .filter((x) => x.s > 0 || !words.length).sort((a, b) => b.s - a.s).slice(0, 8);
        const list = (scored.length ? scored.map((x) => x.i) : items.slice(0, 8)).map((i) => ({
          itemId: i.id, name: i.name, kind: i.kind.toLowerCase(), price: kobo(i.priceCents), durationMins: i.durationMins ?? undefined,
          inStock: i.trackInventory ? (i.stock ?? 0) > 0 : undefined, category: i.category ?? undefined,
        }));
        return { ok: true, matches: list, exactMatch: scored.length > 0 };
      }
      case "get_product_details":
      case "check_inventory": {
        const i = await maybe<CatalogItem>(t.from("CatalogItem").select("*").eq("id", String(args.itemId ?? "")).maybeSingle());
        if (!i) return { ok: false, error: "Item not found" };
        return { ok: true, itemId: i.id, name: i.name, description: i.description, price: kobo(i.priceCents), durationMins: i.durationMins, active: i.active,
          stock: i.trackInventory ? i.stock : "not tracked", variants: i.variants };
      }
      case "send_item_photos": {
        const i = await maybe<CatalogItem>(t.from("CatalogItem").select("*").eq("id", String(args.itemId ?? "")).eq("active", true).maybeSingle());
        if (!i) return { ok: false, error: "Item not found" };
        const imgs = (i.images ?? []).filter(Boolean).slice(0, 3);
        if (!imgs.length) return { ok: false, error: "This item has no photo yet. Describe it in words instead." };
        if (ctx.dryRun || !ctx.conversationId) return { ok: true, name: i.name, photosSent: imgs.length, ...SIMULATED };
        // Don't resend a photo that went to this chat in the last 10 minutes (job retries, repeated asks).
        const recent = await run<{ mediaUrl: string | null }[]>(t.from("Message").select("mediaUrl").eq("conversationId", ctx.conversationId).eq("direction", "out").in("mediaUrl", imgs).gte("createdAt", new Date(Date.now() - 600_000).toISOString()).neq("status", "failed"));
        const fresh = imgs.filter((u) => !recent.some((r) => r.mediaUrl === u));
        if (!fresh.length) return { ok: true, name: i.name, photosSent: 0, note: "You already sent these photos a moment ago. Don't send them again." };
        const { sendOutbound } = await import("@/modules/whatsapp/outbound");
        let sent = 0;
        for (const [n, url] of fresh.entries()) {
          const r = await sendOutbound({ organizationId: org, conversationId: ctx.conversationId, sender: "ai", imageUrl: url, text: n === 0 ? `${i.name} · ${kobo(i.priceCents)}` : "" });
          if ("sent" in r) sent++; else break;
        }
        return sent ? { ok: true, name: i.name, photosSent: sent } : { ok: false, error: "Couldn't send the photo right now." };
      }
      case "send_payment_link": {
        if (needCustomer()) return needCustomer();
        const { paymentsEnabled, createPaymentLink } = await import("@/modules/payments/service");
        if (!(await paymentsEnabled(org))) return { ok: false, error: "Online payment isn't set up. Use the payment details in the business knowledge, or escalate." };
        let oq = t.from("Order").select("id, number, status, paymentStatus").eq("customerId", ctx.customerId!);
        oq = args.orderNumber ? oq.eq("number", Number(args.orderNumber)) : oq.eq("paymentStatus", "UNPAID").neq("status", "CANCELLED");
        const o = await maybe<{ id: string; number: number }>(oq.order("createdAt", { ascending: false }).limit(1).maybeSingle());
        if (!o) return { ok: false, error: "No unpaid order found for this customer." };
        if (ctx.dryRun || !ctx.conversationId) return { ok: true, orderNumber: o.number, ...SIMULATED };
        try {
          const link = await createPaymentLink(org, o.id);
          const { sendOutbound } = await import("@/modules/whatsapp/outbound");
          const r = await sendOutbound({ organizationId: org, conversationId: ctx.conversationId, sender: "ai", text: `Pay ${kobo(link.amountCents)} for order #${link.number} securely with Paystack (card, bank transfer or USSD):\n${link.url}` });
          return "sent" in r ? { ok: true, orderNumber: link.number, note: "The payment link was sent in the chat. Tell the customer it's sent; do not paste the link again." } : { ok: false, error: "Couldn't send the link right now." };
        } catch (e) { return { ok: false, error: (e as Error).message }; }
      }
      case "get_customer_profile": {
        if (needCustomer()) return needCustomer();
        const cust = await maybe<Customer>(t.from("Customer").select("*").eq("id", ctx.customerId!).maybeSingle());
        if (!cust) return { ok: false, error: "Customer not found" };
        const [orders, appointments] = await Promise.all([
          run<(Order & { items: OrderItem[] })[]>(t.from("Order").select("*, items:OrderItem(*)").eq("customerId", cust.id).order("createdAt", { ascending: false }).limit(5)),
          run<(Appointment & { service: CatalogItem; staff: { name: string } | null })[]>(
            t.from("Appointment").select("*, service:CatalogItem(*), staff:StaffMember(*)").eq("customerId", cust.id).order("startsAt", { ascending: false }).limit(5),
          ),
        ]);
        const c = { ...cust, orders, appointments };
        const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: ctx.timezone }).toFormat("ccc d LLL yyyy, h:mm a");
        return {
          ok: true, name: c.name, email: c.email, preferences: c.preferences, notes: c.notes, status: c.status,
          relationship: c.relationship, visits: c.visitCount, usuallyReturnsEveryDays: c.avgGapDays, lastPurchase: c.lastPurchaseAt ? fmt(c.lastPurchaseAt) : null, expectedBack: c.expectedNextAt ? fmt(c.expectedNextAt) : null,
          orders: c.orders.map((o) => ({ number: o.number, status: o.status, payment: o.paymentStatus, total: kobo(o.totalCents), items: o.items.map((i) => `${i.quantity}× ${i.name}`) })),
          appointments: c.appointments.map((a) => ({ appointmentId: a.id, service: a.service.name, staff: a.staff?.name, when: fmt(a.startsAt), status: a.status })),
        };
      }
      case "update_customer_profile": {
        if (needCustomer()) return needCustomer();
        if (ctx.dryRun) return { ok: true, ...SIMULATED };
        const c = await maybe<Customer>(t.from("Customer").select("*").eq("id", ctx.customerId!).maybeSingle());
        if (!c) return { ok: false, error: "Customer not found" };
        const prefs = Array.isArray((c.preferences as any)?.notes) ? (c.preferences as any).notes : [];
        const data = {
          ...(args.name ? { name: String(args.name).slice(0, 100) } : {}),
          ...(args.email && /\S+@\S+\.\S+/.test(args.email) ? { email: String(args.email).slice(0, 200) } : {}),
          ...(args.preference ? { preferences: { notes: [...prefs, String(args.preference).slice(0, 200)].slice(-20) } } : {}),
        };
        if (Object.keys(data).length) await run(t.from("Customer").update(data).eq("id", c.id));
        return { ok: true, saved: true };
      }
      case "check_appointment_availability": {
        const r = await getAvailability(org, args.serviceId, args.date, args.staffId || null);
        if (r.error) return { ok: false, error: r.error };
        const fmt = (iso: string) => DateTime.fromISO(iso, { zone: ctx.timezone }).toFormat("h:mm a");
        const day = DateTime.fromISO(args.date, { zone: ctx.timezone });
        return { ok: true, date: args.date, weekday: day.isValid ? day.toFormat("cccc d LLLL") : undefined, durationMins: r.durationMins, available: r.slots.slice(0, 16).map((s) => ({ startsAt: s.start, time: fmt(s.start), staffId: s.staffId, staff: s.staffName })), totalAvailable: r.slots.length };
      }
      case "book_appointment": {
        if (needCustomer()) return needCustomer();
        if (ctx.dryRun) return { ok: true, ...SIMULATED };
        const r = await bookAppointment({ organizationId: org, customerId: ctx.customerId!, serviceId: args.serviceId, startsAt: args.startsAt, staffId: args.staffId || null, source: "whatsapp", createdByAi: true, conversationId: ctx.conversationId, notes: args.notes });
        if (!r.ok) return r;
        return { ...r, when: DateTime.fromISO(r.startsAt, { zone: ctx.timezone }).toFormat("cccc d LLLL, h:mm a") };
      }
      case "reschedule_appointment": {
        if (needCustomer()) return needCustomer();
        const own = await maybe<{ id: string }>(t.from("Appointment").select("id").eq("id", String(args.appointmentId ?? "")).eq("customerId", ctx.customerId!).maybeSingle());
        if (!own) return { ok: false, error: "Appointment not found for this customer" };
        if (ctx.dryRun) return { ok: true, ...SIMULATED };
        const r = await rescheduleAppointment(org, own.id, args.startsAt);
        return r.ok ? { ...r, when: DateTime.fromISO(r.startsAt, { zone: ctx.timezone }).toFormat("cccc d LLLL, h:mm a") } : r;
      }
      case "cancel_appointment": {
        if (needCustomer()) return needCustomer();
        const own = await maybe<{ id: string }>(t.from("Appointment").select("id").eq("id", String(args.appointmentId ?? "")).eq("customerId", ctx.customerId!).maybeSingle());
        if (!own) return { ok: false, error: "Appointment not found for this customer" };
        if (ctx.dryRun) return { ok: true, ...SIMULATED };
        return (await cancelAppointment(org, own.id)) ? { ok: true, cancelled: true } : { ok: false, error: "Appointment is not active" };
      }
      case "create_order": {
        if (needCustomer()) return needCustomer();
        if (ctx.dryRun) return { ok: true, ...SIMULATED };
        const r = await createOrder({
          organizationId: org, customerId: ctx.customerId!, items: (args.items ?? []).map((i: any) => ({ itemId: i.itemId, quantity: Number(i.quantity) })),
          delivery: args.deliveryMethod || args.deliveryAddress ? { method: args.deliveryMethod, address: args.deliveryAddress } : null,
          source: "whatsapp", createdByAi: true, conversationId: ctx.conversationId, notes: args.notes,
        });
        return r.ok ? { ok: true, orderNumber: r.number, total: kobo(r.totalCents), items: r.items, paymentStatus: "UNPAID — payment has NOT been received" } : r;
      }
      case "check_order_status": {
        if (needCustomer()) return needCustomer();
        let oq = t.from("Order").select("*").eq("customerId", ctx.customerId!);
        if (args.orderNumber) oq = oq.eq("number", Number(args.orderNumber));
        const orders = await run<Order[]>(oq.order("createdAt", { ascending: false }).limit(5));
        return { ok: true, orders: orders.map((o) => ({ number: o.number, status: o.status, payment: o.paymentStatus, total: kobo(o.totalCents), placed: DateTime.fromJSDate(o.createdAt, { zone: ctx.timezone }).toFormat("d LLL yyyy") })) };
      }
      case "create_customer_followup": {
        if (needCustomer()) return needCustomer();
        if (ctx.dryRun) return { ok: true, ...SIMULATED };
        const dueAt = new Date(Date.now() + Number(args.inHours) * 3600_000);
        const f = await must<{ id: string }>(t.from("Followup").insert({ customerId: ctx.customerId!, dueAt: dueAt.toISOString(), reason: String(args.reason).slice(0, 300), message: String(args.message).slice(0, 1000), conversationId: ctx.conversationId }).select("id").single());
        await followupQueue().add("followup", { followupId: f.id }, { delay: dueAt.getTime() - Date.now(), jobId: `fu-${f.id}` }).catch((e) => logger.warn(e));
        return { ok: true, scheduledFor: DateTime.fromJSDate(dueAt, { zone: ctx.timezone }).toFormat("ccc d LLL, h:mm a") };
      }
      case "escalate_to_human": {
        ctx.escalated = { reason: String(args.reason ?? "").slice(0, 300) };
        return { ok: true, handedOff: true, instruction: "Tell the customer a team member will reply shortly. Do not promise a specific time." };
      }
    }
    return { ok: false, error: `Unknown tool ${name}` };
  } catch (e) {
    logger.error({ err: e, tool: name }, "tool failed");
    return { ok: false, error: "That action failed due to a system error. Do not claim it succeeded." };
  }
}
