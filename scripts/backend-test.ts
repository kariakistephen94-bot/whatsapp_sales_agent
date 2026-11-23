import "dotenv/config";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { from, tenant, run, maybe, must, count, rpc, type CatalogItem, type StaffMember, type Customer, type Order, type Conversation, type WhatsappConnection } from "@/server/db";
import { createOrganizationForUser } from "@/modules/tenancy/bootstrap";
import { getAvailability, bookAppointment, rescheduleAppointment, setAppointmentStatus } from "@/modules/appointments/service";
import { createOrder, markOrderPaid, setOrderStatus } from "@/modules/orders/service";
import { refreshCustomer } from "@/modules/customers/service";
import { handleInbound } from "@/modules/whatsapp/inbound";
import { executeTool } from "@/modules/ai/tools";
import { DbQueue } from "@/server/queue";
import { rateLimit } from "@/server/rate-limit";
import { runCareSweep, handleCareNudge } from "@/modules/relationships/care";
import { connectionManager } from "@/modules/whatsapp/manager";
import { serviceState } from "@/modules/billing/usage";
import { billingSweep } from "@/modules/billing/sweep";
import { notifyHandoff } from "@/modules/team/notify";
import { savePaymentKeys, paymentStatus, createPaymentLink, confirmOrderPayment, paymentSweep, secretForReference } from "@/modules/payments/service";
import { signatureMatches } from "@/modules/payments/paystack";
import { createHmac } from "node:crypto";

/**
 * Backend integration test against the configured database (no auth, no OpenAI needed).
 * Creates two throwaway workspaces, exercises the real services, then deletes everything it made.
 */
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info !== undefined ? `  → ${JSON.stringify(info)}` : ""}`); };

async function main() {
  const users = [randomUUID(), randomUUID()];
  for (const id of users) await run(from("User").insert({ id, email: `test-${id.slice(0, 8)}@example.test` }));
  const orgA = await createOrganizationForUser(users[0], "Test Salon A");
  const orgB = await createOrganizationForUser(users[1], "Test Shop B");
  try {
    check("workspace bootstrap creates agent, storefront, automations", (await count(from("AiAgent").select("*", { count: "exact", head: true }).eq("organizationId", orgA.id))) === 1 && (await count(from("Automation").select("*", { count: "exact", head: true }).eq("organizationId", orgA.id))) >= 5);

    await run(from("Organization").update({ capabilities: ["services", "appointments", "products", "orders", "inventory"], industryTemplateKey: "salon", businessHours: { mon: [{ start: "09:00", end: "18:00" }], tue: [{ start: "09:00", end: "18:00" }], wed: [{ start: "09:00", end: "18:00" }], thu: [{ start: "09:00", end: "18:00" }], fri: [{ start: "09:00", end: "18:00" }], sat: [{ start: "10:00", end: "16:00" }] } }).eq("id", orgA.id));
    const A = tenant(orgA.id), B = tenant(orgB.id);
    const ins = <T,>(db: typeof A, table: Parameters<typeof A.from>[0], v: Record<string, unknown>) => must<T>(db.from(table).insert(v).select().single());
    const braids = await ins<CatalogItem>(A, "CatalogItem", { kind: "SERVICE", name: "Knotless braids", priceCents: 45_000_00, durationMins: 120 });
    const oil = await ins<CatalogItem>(A, "CatalogItem", { kind: "PRODUCT", name: "Argan oil", priceCents: 9_500_00, trackInventory: true, stock: 3 });
    const amara = await ins<StaffMember>(A, "StaffMember", { name: "Amara", workingHours: { mon: [{ start: "09:00", end: "17:00" }], tue: [{ start: "09:00", end: "17:00" }], wed: [{ start: "09:00", end: "17:00" }], thu: [{ start: "09:00", end: "17:00" }], fri: [{ start: "09:00", end: "17:00" }] }, serviceIds: [] });
    const cust = await ins<Customer>(A, "Customer", { phone: "+2348030000001", name: "Ada Test" });

    // Tenant isolation
    check("tenant isolation: org B can't read org A's item by id", (await maybe(B.from("CatalogItem").select("*").eq("id", braids.id).maybeSingle())) === null);
    check("tenant isolation: org B can't update org A's item", (await run<unknown[]>(B.from("CatalogItem").update({ name: "hacked" }).eq("id", braids.id).select("id"))).length === 0);

    // Availability on next Wednesday
    const wed = DateTime.now().setZone("Africa/Lagos").plus({ weeks: 1 }).set({ weekday: 3 }).toISODate()!;
    const av = await getAvailability(orgA.id, braids.id, wed);
    check("availability returns slots within staff hours", av.slots.length > 0 && av.slots.every((s) => s.start.includes("T")), av);
    const first = av.slots.find((s) => s.start.includes("T10:00"))!;
    check("10:00 slot offered", !!first, av.slots.map((s) => s.start).slice(0, 4));

    // Double-booking protection under concurrency
    const [r1, r2] = await Promise.all([
      bookAppointment({ organizationId: orgA.id, customerId: cust.id, serviceId: braids.id, startsAt: first.start, source: "dashboard" }),
      bookAppointment({ organizationId: orgA.id, customerId: cust.id, serviceId: braids.id, startsAt: first.start, source: "dashboard" }),
    ]);
    check("concurrent bookings of the same slot: exactly one succeeds", [r1, r2].filter((r) => r.ok).length === 1, [r1, r2]);
    const booked = (r1.ok ? r1 : r2) as Extract<typeof r1, { ok: true }>;
    const after = await getAvailability(orgA.id, braids.id, wed);
    check("booked slot disappears from availability", !after.slots.some((s) => s.start === first.start));
    const closed = await bookAppointment({ organizationId: orgA.id, customerId: cust.id, serviceId: braids.id, startsAt: DateTime.fromISO(wed, { zone: "Africa/Lagos" }).set({ hour: 20 }).toISO()!, source: "dashboard" });
    check("booking outside working hours is refused", !closed.ok, closed);

    // Reschedule by 30 minutes (overlaps its own old slot)
    const moved = await rescheduleAppointment(orgA.id, booked.appointmentId, DateTime.fromISO(first.start).plus({ minutes: 30 }).toISO()!);
    check("reschedule into a slot overlapping its own old time works", moved.ok, moved);

    // Orders: price from DB, stock, unpaid by default
    const o1 = await createOrder({ organizationId: orgA.id, customerId: cust.id, items: [{ itemId: oil.id, quantity: 2 }], source: "manual" });
    check("order total comes from catalog price", o1.ok && o1.totalCents === 19_000_00, o1);
    const o2 = await createOrder({ organizationId: orgA.id, customerId: cust.id, items: [{ itemId: oil.id, quantity: 2 }], source: "manual" });
    check("order exceeding stock is refused", !o2.ok, o2);
    check("stock decremented to 1", (await maybe<CatalogItem>(A.from("CatalogItem").select("*").eq("id", oil.id).maybeSingle()))?.stock === 1);
    const orderRow = await maybe<Order>(A.from("Order").select("*").eq("id", (o1 as any).orderId).maybeSingle());
    check("new order is UNPAID", orderRow?.paymentStatus === "UNPAID");
    const crossTenant = await createOrder({ organizationId: orgB.id, customerId: cust.id, items: [{ itemId: oil.id, quantity: 1 }], source: "manual" });
    check("org B can't order org A's item", !crossTenant.ok, crossTenant);

    await markOrderPaid(orgA.id, (o1 as any).orderId, "bank_transfer");
    check("lifetime value counts paid order", (await maybe<Customer>(A.from("Customer").select("*").eq("id", cust.id).maybeSingle()))?.lifetimeValueCents === 19_000_00);
    await setOrderStatus(orgA.id, (o1 as any).orderId, "CANCELLED");
    check("cancelling returns stock", (await maybe<CatalogItem>(A.from("CatalogItem").select("*").eq("id", oil.id).maybeSingle()))?.stock === 3);

    if (moved.ok) {
      await setAppointmentStatus(orgA.id, moved.appointmentId, "completed");
      await refreshCustomer(cust.id);
      const c = await maybe<Customer>(A.from("Customer").select("*").eq("id", cust.id).maybeSingle());
      check("completed visit adds to LTV and makes customer returning", c?.lifetimeValueCents === 64_000_00 && c.status === "returning", c);
    }

    // AI tools (no OpenAI needed): read tools are real, playground writes are simulated
    const ctxDry = { organizationId: orgA.id, customerId: null, conversationId: null, timezone: "Africa/Lagos", dryRun: true };
    const search: any = await executeTool("search_products", JSON.stringify({ query: "braids" }), ctxDry);
    check("AI search_products finds the service with ₦ price", search.ok && search.matches[0]?.name === "Knotless braids" && /₦45,000/.test(search.matches[0].price), search);
    const noPhoto: any = await executeTool("send_item_photos", JSON.stringify({ itemId: oil.id }), ctxDry);
    check("AI send_item_photos: item without photo is refused honestly", noPhoto.ok === false && /no photo/i.test(noPhoto.error), noPhoto);
    await run(A.from("CatalogItem").update({ images: ["https://example.com/public-assets/a.jpg"] }).eq("id", oil.id));
    const withPhoto: any = await executeTool("send_item_photos", JSON.stringify({ itemId: oil.id }), ctxDry);
    check("AI send_item_photos: item with photo is simulated in test mode", withPhoto.ok === true && withPhoto.photosSent === 1, withPhoto);
    const foreignPhoto: any = await executeTool("send_item_photos", JSON.stringify({ itemId: oil.id }), { ...ctxDry, organizationId: orgB.id });
    check("AI send_item_photos: can't reach another business's item", foreignPhoto.ok === false, foreignPhoto);
    const dryBook: any = await executeTool("book_appointment", JSON.stringify({ serviceId: braids.id, startsAt: first.start }), { ...ctxDry, customerId: cust.id });
    check("playground booking is simulated, not saved", dryBook.ok && /TEST MODE/.test(dryBook.note) && (await count(A.from("Appointment").select("*", { count: "exact", head: true }))) === 2);
    const liveOrder: any = await executeTool("create_order", JSON.stringify({ items: [{ itemId: oil.id, quantity: 1 }] }), { ...ctxDry, customerId: cust.id, dryRun: false });
    check("AI create_order is real and says UNPAID", liveOrder.ok && /UNPAID/.test(liveOrder.paymentStatus), liveOrder);
    const foreign: any = await executeTool("get_product_details", JSON.stringify({ itemId: oil.id }), { ...ctxDry, organizationId: orgB.id });
    check("AI tools can't read another org's items", foreign.ok === false);

    // Inbound WhatsApp pipeline
    const conn = await ins<WhatsappConnection>(A, "WhatsappConnection", { provider: "baileys", status: "connected" });
    const ext = `TEST-${randomUUID()}`;
    await handleInbound(conn.id, { externalId: ext, from: "+2348030000002", fromName: "Bola", text: "How much be braids?", timestamp: new Date() });
    await handleInbound(conn.id, { externalId: ext, from: "+2348030000002", fromName: "Bola", text: "How much be braids?", timestamp: new Date() });
    const bola = await maybe<Customer>(A.from("Customer").select("*").eq("phone", "+2348030000002").maybeSingle());
    check("inbound creates customer from WhatsApp", bola?.name === "Bola");
    check("duplicate delivery stored once", (await count(A.from("Message").select("*", { count: "exact", head: true }).eq("externalId", ext))) === 1);
    const convo = await maybe<Conversation>(A.from("Conversation").select("*").eq("customerId", bola!.id).limit(1).maybeSingle());
    await run(A.from("Conversation").update({ status: "resolved" }).eq("id", convo!.id));
    await handleInbound(conn.id, { externalId: `TEST-${randomUUID()}`, from: "+2348030000002", text: "Hello again", timestamp: new Date() });
    check("message to a resolved chat reopens the same conversation", (await count(A.from("Conversation").select("*", { count: "exact", head: true }).eq("customerId", bola!.id))) === 1 && (await maybe<Conversation>(A.from("Conversation").select("*").eq("id", convo!.id).maybeSingle()))?.status === "open");

    // Team on WhatsApp: hand-off alerts go to members with a number; their own messages aren't treated as customers
    await run(from("Membership").update({ phone: "+2348090000009", notifyHandoffs: true }).eq("organizationId", orgA.id).eq("userId", users[0]));
    const alert = await notifyHandoff({ organizationId: orgA.id, conversationId: convo!.id, reason: "Customer wants a refund", lastMessage: "I want my money back" });
    const alertJob = await maybe<{ data: { to: string; text: string } }>(from("Job").select("data").eq("queue", "wa-notify").eq("data->>organizationId", orgA.id).limit(1).maybeSingle());
    check("hand-off alert queued to the team member's WhatsApp", alert.alerted === 1 && alertJob?.data.to === "+2348090000009" && /refund/.test(alertJob.data.text) && /conversations\?c=/.test(alertJob.data.text), { alert, alertJob });
    const again = await notifyHandoff({ organizationId: orgA.id, conversationId: convo!.id, reason: "again" });
    check("repeat hand-off alert within 15 minutes is not sent twice", again.alerted === 0, again);
    await handleInbound(conn.id, { externalId: `TEST-${randomUUID()}`, from: "+2348090000009", fromName: "Owner", text: "ok I'll call her", timestamp: new Date() });
    check("message from a team member's number creates no customer", (await maybe(A.from("Customer").select("id").eq("phone", "+2348090000009").maybeSingle())) === null);

    // Database job queue (replaces Redis/BullMQ)
    const q = new DbQueue<{ n: number }>(`test-${randomUUID()}`);
    const key = `k-${randomUUID()}`;
    const j1 = await q.add("t", { n: 1 }, { jobId: key });
    const j2 = await q.add("t", { n: 1 }, { jobId: key });
    check("queue: same jobId is only queued once", !!j1 && j2 === null);
    await q.add("later", { n: 2 }, { delay: 60_000 });
    const [c1, c2] = await Promise.all([q.claim(5), q.claim(5)]);
    check("queue: due job claimed exactly once, delayed job not yet", c1.length + c2.length === 1 && [...c1, ...c2][0].data.n === 1, { c1, c2 });
    const claimedJob = [...c1, ...c2][0];
    await q.fail(claimedJob, new Error("boom"));
    const retried = await maybe<{ status: string; runAt: Date; lastError: string | null }>(from("Job").select("*").eq("id", claimedJob.id).maybeSingle());
    check("queue: failed job is rescheduled with backoff", retried?.status === "pending" && retried.runAt > new Date() && retried.lastError === "boom");
    await run(from("Job").delete().eq("queue", q.name));

    // Rate limit stored in the database
    const rlKey = `test-${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(rlKey, 3, 60));
    check("rate limit: 4th request in window is blocked", results.join() === "true,true,true,false", results);
    await run(from("RateLimitBucket").delete().eq("key", rlKey));

    // Customer relationships: usual gap 30 days, last order 30 days ago => "due"
    const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
    const rel = await ins<Customer>(A, "Customer", { phone: "+2348030000777", name: "Rel Test", lastInteractionAt: daysAgo(30), consentAt: daysAgo(90) });
    for (const [n, d] of [[9001, 60], [9002, 30]] as const) await run(A.from("Order").insert({ customerId: rel.id, number: n, status: "COMPLETED", subtotalCents: 100, totalCents: 100, currency: "NGN", createdAt: daysAgo(d) }));
    const changed = await rpc<number>("app_refresh_relationships", { p_org: orgA.id, p_default_days: 30 });
    const relRow = await must<Customer>(A.from("Customer").select("*").eq("id", rel.id).single());
    check("relationships: customer 30d since last order, usual gap 30d => due", relRow.relationship === "due" && relRow.visitCount === 2 && relRow.avgGapDays === 30 && !!relRow.expectedNextAt, relRow);
    check("relationships: customer with no orders is a lead", (await must<Customer>(A.from("Customer").select("*").eq("id", cust.id).single())).relationship !== "due" && changed >= 1);
    check("relationships: refresh is idempotent", (await rpc<number>("app_refresh_relationships", { p_org: orgA.id, p_default_days: 30 })) === 0);
    await run(A.from("Customer").update({ lastNudgedAt: new Date().toISOString(), nudgeCount: 2 }).eq("id", rel.id));
    await run(A.from("Order").insert({ customerId: rel.id, number: 9003, status: "PENDING", subtotalCents: 100, totalCents: 100, currency: "NGN" }));
    await rpc("app_refresh_relationships", { p_org: orgA.id, p_default_days: 30 });
    const back = await must<Customer>(A.from("Customer").select("*").eq("id", rel.id).single());
    check("relationships: a new order makes them active and resets the nudge counter", back.relationship === "active" && back.nudgeCount === 0, back);
    const sweep = await runCareSweep();
    check("care sweep runs without error (nothing queued: automation off / no WhatsApp)", typeof sweep.queued === "number");


    // Customer care nudge, end to end, with a fake WhatsApp provider
    const sent: { to: string; text: string }[] = [];
    (connectionManager as any).providers.set(conn.id, { kind: "baileys", sendText: async (to: string, text: string) => { sent.push({ to, text }); return { externalId: `fake-${randomUUID()}` }; } });
    const care = await ins<Customer>(A, "Customer", { phone: "+2348030000555", name: "Ngozi Care", lastInteractionAt: daysAgo(20), consentAt: daysAgo(90) });
    for (const [n, d] of [[9101, 60], [9102, 30]] as const) await run(A.from("Order").insert({ customerId: care.id, number: n, status: "COMPLETED", subtotalCents: 100, totalCents: 100, currency: "NGN", createdAt: daysAgo(d) }));
    await rpc("app_refresh_relationships", { p_org: orgA.id, p_default_days: 30 });
    await run(A.from("Automation").update({ enabled: true, config: { template: "Hi {name}, we miss you at {business}!", aiPersonalize: false, defaultCycleDays: 30, maxNudges: 3, dailyCap: 20, sendFromHour: 0, sendToHour: 24 } }).eq("key", "customer_care"));
    const careJob = { kind: "customer_care" as const, organizationId: orgA.id, customerId: care.id, stage: "rebook" as const, queuedAt: Date.now() - 1000 };
    const n1 = await handleCareNudge(careJob) as any;
    check("care nudge: due customer gets a personalised message with the STOP notice", n1.sent === true && sent.length === 1 && sent[0].to === "+2348030000555" && sent[0].text.includes("Ngozi") && /STOP/.test(sent[0].text), { n1, sent });
    const afterNudge = await must<Customer>(A.from("Customer").select("*").eq("id", care.id).single());
    check("care nudge: bookkeeping (count, next date, followup log)", afterNudge.nudgeCount === 1 && !!afterNudge.nextNudgeAt && (await count(A.from("Followup").select("id", { count: "exact", head: true }).eq("customerId", care.id).eq("reason", "care:rebook"))) === 1, afterNudge);
    const n2 = await handleCareNudge(careJob) as any;
    check("care nudge: not repeated straight away", n2.skipped === "too_soon" && sent.length === 1, n2);
    await run(A.from("Customer").update({ nudgeCount: 0, nextNudgeAt: null, lastNudgedAt: null }).eq("id", care.id));
    await run(A.from("Customer").update({ optedOut: true }).eq("id", care.id));
    check("care nudge: opted-out customer is never messaged", ((await handleCareNudge(careJob)) as any).skipped === "opted_out" && sent.length === 1);
    await run(A.from("Customer").update({ optedOut: false, lastInteractionAt: new Date().toISOString() }).eq("id", care.id));
    check("care nudge: not sent to someone who is chatting right now", ((await handleCareNudge(careJob)) as any).skipped === "recently_chatting");
    await run(A.from("Customer").update({ lastInteractionAt: daysAgo(20) }).eq("id", care.id));
    const sweep2 = await runCareSweep();
    check("care sweep queues the due customer", sweep2.queued >= 1, sweep2);
    await run(from("Job").delete().eq("queue", "followups").eq("data->>organizationId", orgA.id));
    (connectionManager as any).providers.delete(conn.id);

    // Billing: exactly-once plan activation
    const starter = await must<{ id: string; priceCents: number }>(from("Plan").select("id, priceCents").eq("key", "starter").single());
    const ref1 = `test_${randomUUID()}`, ref2 = `test_${randomUUID()}`;
    await run(from("BillingTransaction").insert([{ organizationId: orgA.id, planId: starter.id, reference: ref1, amountCents: starter.priceCents }, { organizationId: orgA.id, planId: starter.id, reference: ref2, amountCents: starter.priceCents }]));
    const short = await rpc<{ ok: boolean; error?: string }>("app_activate_plan", { p_reference: ref1, p_paid_kobo: 100, p_payload: {} });
    check("billing: underpayment is refused", !short.ok && short.error === "amount_mismatch", short);
    const [p1, p2] = await Promise.all([rpc<{ ok: boolean; already?: boolean }>("app_activate_plan", { p_reference: ref2, p_paid_kobo: starter.priceCents, p_payload: {} }), rpc<{ ok: boolean; already?: boolean }>("app_activate_plan", { p_reference: ref2, p_paid_kobo: starter.priceCents, p_payload: {} })]);
    check("billing: concurrent activations apply once", p1.ok && p2.ok && [p1, p2].filter((x) => x.already).length === 1, { p1, p2 });
    const sub = await must<{ status: string; currentPeriodEnd: Date; trialEndsAt: Date | null }>(A.from("Subscription").select("*").single());
    const spanDays = (sub.currentPeriodEnd.getTime() - Date.now()) / 864e5;
    check("billing: plan active for ~30 days, trial cleared", sub.status === "active" && spanDays > 29 && spanDays < 31 && sub.trialEndsAt === null, sub);
    check("billing: serviceState reports active", (await serviceState(orgA.id)).status === "active");
    // Switching plans carries unused time over, converted by price.
    const pro = await must<{ id: string; priceCents: number }>(from("Plan").select("id, priceCents").eq("key", "professional").single());
    const in20 = new Date(Date.now() + 20 * 864e5).toISOString();
    await run(A.from("Subscription").update({ status: "active", planId: starter.id, currentPeriodEnd: in20 }));
    const ref3 = `test_${randomUUID()}`;
    await run(from("BillingTransaction").insert({ organizationId: orgA.id, planId: pro.id, reference: ref3, amountCents: pro.priceCents }));
    const sw1 = await rpc<{ ok: boolean; creditDays: number }>("app_activate_plan", { p_reference: ref3, p_paid_kobo: pro.priceCents, p_payload: {} });
    const sub3 = await must<{ planId: string; currentPeriodEnd: Date }>(A.from("Subscription").select("*").single());
    const expectDays = 30 + 20 * starter.priceCents / pro.priceCents;
    const gotDays = (sub3.currentPeriodEnd.getTime() - Date.now()) / 864e5;
    check("billing: upgrading carries over unused days by price", sw1.ok && sub3.planId === pro.id && Math.abs(gotDays - expectDays) < 0.1 && sw1.creditDays > 0, { sw1, gotDays, expectDays });
    const ref4 = `test_${randomUUID()}`;
    await run(from("BillingTransaction").insert({ organizationId: orgA.id, planId: pro.id, reference: ref4, amountCents: pro.priceCents }));
    await rpc("app_activate_plan", { p_reference: ref4, p_paid_kobo: pro.priceCents, p_payload: {} });
    const sub4 = await must<{ currentPeriodEnd: Date }>(A.from("Subscription").select("*").single());
    check("billing: renewing the same plan extends by 30 days", Math.abs((sub4.currentPeriodEnd.getTime() - sub3.currentPeriodEnd.getTime()) / 864e5 - 30) < 0.01);
    await run(A.from("Subscription").update({ status: "active", currentPeriodEnd: daysAgo(10) }));
    check("billing: 10 days past period end => inactive", !(await serviceState(orgA.id)).active);
    const sw = await billingSweep();
    check("billing: sweep marks it expired", sw.expired >= 1 && (await must<{ status: string }>(A.from("Subscription").select("status").single())).status === "expired");
    check("tenant isolation: org B sees none of org A's payments", (await run<unknown[]>(B.from("BillingTransaction").select("id"))).length === 0);

    // ── Businesses taking payments with their own Paystack account (Paystack API stubbed) ──
    const realFetch = globalThis.fetch;
    const verifyReply: { status: string; amount?: number; currency?: string } = { status: "success" };
    const initCalls: any[] = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input.url);
      if (!url.startsWith("https://api.paystack.co")) return realFetch(input, init);
      const auth = init?.headers?.Authorization ?? "";
      const json = (data: unknown, ok = true) => new Response(JSON.stringify({ status: ok, message: ok ? "ok" : "Invalid key", data }), { status: ok ? 200 : 401 });
      if (url.endsWith("/balance")) return json([], auth === "Bearer sk_test_GOODKEY123");
      if (url.endsWith("/transaction/initialize")) { const b = JSON.parse(init.body); initCalls.push(b); return json({ authorization_url: `https://checkout.paystack.com/${b.reference}`, reference: b.reference }); }
      if (url.includes("/transaction/verify/")) { const ref = decodeURIComponent(url.split("/verify/")[1]); return json({ status: verifyReply.status, reference: ref, amount: verifyReply.amount ?? 0, currency: verifyReply.currency ?? "NGN" }); }
      return json({}, false);
    }) as typeof fetch;
    try {
      check("payments: nothing connected at first", !(await paymentStatus(orgA.id)).connected);
      check("payments: a made-up key is refused", (await savePaymentKeys(orgA.id, "pk_test_abc123456", "sk_test_WRONGKEY99")) !== null);
      check("payments: mixed live/test keys are refused", /same mode/i.test((await savePaymentKeys(orgA.id, "pk_live_abc123456", "sk_test_GOODKEY123")) ?? ""));
      check("payments: not-a-key text is refused", (await savePaymentKeys(orgA.id, "hello", "world")) !== null);
      check("payments: valid keys connect", (await savePaymentKeys(orgA.id, "pk_test_abc123456", "sk_test_GOODKEY123")) === null);
      const ps = await paymentStatus(orgA.id);
      check("payments: status shows mode and public key but never the secret", ps.connected && ps.mode === "test" && !JSON.stringify(ps).includes("GOODKEY"), ps);
      const stored = await must<{ secretEncrypted: string }>(from("PaymentConfig").select("secretEncrypted").eq("organizationId", orgA.id).single());
      check("payments: secret key is stored encrypted", !stored.secretEncrypted.includes("GOODKEY"));
      check("payments: other business has no config (isolation)", !(await paymentStatus(orgB.id)).connected);

      const po = await createOrder({ organizationId: orgA.id, customerId: cust.id, items: [{ itemId: oil.id, quantity: 1 }], source: "whatsapp" });
      if (!po.ok) throw new Error("test order failed");
      const orderRow = await must<{ id: string; totalCents: number }>(A.from("Order").select("id, totalCents").eq("number", po.number).single());
      const link = await createPaymentLink(orgA.id, orderRow.id);
      check("payments: link is created for the order total in kobo", link.amountCents === orderRow.totalCents && initCalls[0]?.amount === orderRow.totalCents && link.url.startsWith("https://checkout.paystack.com/"), { link, init: initCalls[0] });
      const again = await createPaymentLink(orgA.id, orderRow.id);
      check("payments: asking again reuses the same link", again.url === link.url && initCalls.length === 1);
      check("payments: another business can't create a link for this order", await createPaymentLink(orgB.id, orderRow.id).then(() => false, () => true));
      const ref = link.url.split("/").pop()!;
      check("payments: reference belongs to the right business", (await secretForReference(ref))?.organizationId === orgA.id);

      verifyReply.status = "success"; verifyReply.amount = orderRow.totalCents - 100;
      check("payments: underpayment does not mark the order paid", (await confirmOrderPayment(ref)).status === "failed" && (await must<{ paymentStatus: string }>(A.from("Order").select("paymentStatus").eq("id", orderRow.id).single())).paymentStatus === "UNPAID");
      const link2 = await createPaymentLink(orgA.id, orderRow.id); // previous reference is failed, so a fresh one is made
      const ref2 = link2.url.split("/").pop()!;
      check("payments: a failed attempt gets a fresh link", ref2 !== ref);
      verifyReply.status = "abandoned";
      check("payments: unpaid stays pending/failed", (await confirmOrderPayment(ref2)).status !== "paid");
      verifyReply.status = "success"; verifyReply.amount = orderRow.totalCents;
      const [c1, c2] = await Promise.all([confirmOrderPayment(ref2), confirmOrderPayment(ref2)]);
      const paidRow = await must<{ paymentStatus: string; paymentMethod: string | null }>(A.from("Order").select("paymentStatus, paymentMethod").eq("id", orderRow.id).single());
      check("payments: a confirmed payment marks the order paid via paystack", c1.status === "paid" && c2.status === "paid" && paidRow.paymentStatus === "PAID" && paidRow.paymentMethod === "paystack", { c1, c2, paidRow });
      const receipts = await run<unknown[]>(from("Job").select("id").eq("queue", "wa-outbound").like("key", "paid-%").eq("data->>organizationId", orgA.id));
      check("payments: exactly one 'payment received' message is queued", receipts.length === 1, receipts.length);
      check("payments: a paid order can't get another link", await createPaymentLink(orgA.id, orderRow.id).then(() => false, () => true));

      const body = JSON.stringify({ event: "charge.success", data: { reference: ref2 } });
      const sig = createHmac("sha512", "sk_test_GOODKEY123").update(body).digest("hex");
      check("payments: webhook signature is checked with the business's own key", signatureMatches(body, sig, "sk_test_GOODKEY123") && !signatureMatches(body, sig, "sk_test_OTHERKEY") && !signatureMatches(body, null, "sk_test_GOODKEY123"));
      check("payments: unknown reference is reported unknown", (await confirmOrderPayment("nope_nope_nope")).status === "unknown");

      const ctxPay = { organizationId: orgA.id, customerId: cust.id, conversationId: null, timezone: "Africa/Lagos", dryRun: true };
      const unpaid = await createOrder({ organizationId: orgA.id, customerId: cust.id, items: [{ itemId: oil.id, quantity: 1 }], source: "whatsapp" });
      const toolRes: any = await executeTool("send_payment_link", JSON.stringify({}), ctxPay);
      check("AI send_payment_link: finds the unpaid order (test mode, nothing sent)", toolRes.ok === true && unpaid.ok && toolRes.orderNumber === unpaid.number, toolRes);
      const noPay: any = await executeTool("send_payment_link", JSON.stringify({}), { ...ctxPay, organizationId: orgB.id });
      check("AI send_payment_link: refuses when the business hasn't connected Paystack", noPay.ok === false, noPay);
      check("payments: sweep runs without error", (await paymentSweep()).checked >= 0);
    } finally { globalThis.fetch = realFetch; }
  } finally {
    // cleanup everything created
    for (const org of [orgA, orgB]) {
      const appts = await run<{ id: string }[]>(from("Appointment").select("id").eq("organizationId", org.id));
      if (appts.length) await run(from("Job").delete().in("data->>appointmentId", appts.map((a) => a.id)));
      await run(from("Order").delete().eq("organizationId", org.id));
      await run(from("Appointment").delete().eq("organizationId", org.id));
      await run(from("Conversation").delete().eq("organizationId", org.id));
      await run(from("Organization").delete().eq("id", org.id));
    }
    await run(from("User").delete().in("id", users));
    await run(from("Job").delete().in("data->>organizationId", [orgA.id, orgB.id]));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
