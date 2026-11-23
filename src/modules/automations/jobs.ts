import { DateTime } from "luxon";
import { from, tenant, run, maybe, count, rpc, isUniqueViolation, type Appointment, type Automation, type Customer, type CatalogItem, type Organization, type Followup, type Order, type Conversation } from "@/server/db";
import { logger } from "@/server/logger";
import { formatNaira } from "@/lib/locale";
import type { FollowupJob, ReminderJob } from "@/server/queue";
import { sendOutbound } from "@/modules/whatsapp/outbound";
import { getOrCreateConversation } from "@/modules/conversations/service";
import { renderTemplate } from "./render";
import { serviceState } from "@/modules/billing/usage";
import { handleCareNudge } from "@/modules/relationships/care";

const AUTOMATED_GAP_MS = 24 * 3600_000; // frequency cap for non-transactional automated messages

export { renderTemplate };

type AutomationRow = Automation & { enabled: boolean; sentCount: number };

const getAutomation = (organizationId: string, key: string) =>
  maybe<AutomationRow>(tenant(organizationId).from("Automation").select("*").eq("key", key).maybeSingle());

/** Atomic `sentCount + 1` (app_automation_sent), scoped to the organization. */
const bumpSent = (organizationId: string, automationId: string) =>
  rpc("app_automation_sent", { p_org: organizationId, p_automation_id: automationId });

async function sendSystem(organizationId: string, customerId: string, text: string) {
  // Automated messages stop when the trial / subscription has run out.
  if (!(await serviceState(organizationId)).active) return { skipped: "subscription_inactive" };
  const convo = await getOrCreateConversation(organizationId, customerId);
  if (!convo) return { skipped: "no_whatsapp_connection" };
  return sendOutbound({ organizationId, conversationId: convo.id, sender: "system", text });
}

/** Appointment reminders and post-visit messages. Exactly-once via ReminderLog(appointmentId, kind). */
export async function handleReminder(job: ReminderJob) {
  const appt = await maybe<Appointment & { customer: Customer; service: CatalogItem; staff: { name: string } | null; organization: Organization }>(
    from("Appointment").select("*, customer:Customer(*), service:CatalogItem(*), staff:StaffMember(*), organization:Organization(*)").eq("id", job.appointmentId).maybeSingle(),
  );
  if (!appt || appt.startsAt.getTime() !== job.startsAtMs) return { skipped: "rescheduled_or_deleted" };
  const isAfter = job.automationKey === "after_visit";
  if (isAfter ? !["booked", "completed"].includes(appt.status) : appt.status !== "booked") return { skipped: `status_${appt.status}` };
  if (appt.customer.optedOut) return { skipped: "opted_out" };
  const auto = await getAutomation(appt.organizationId, job.automationKey);
  if (!auto?.enabled) return { skipped: "automation_disabled" };

  // Insert first: the unique (appointmentId, kind) key makes the send exactly-once.
  try {
    await run(from("ReminderLog").insert({ appointmentId: appt.id, kind: job.automationKey, status: "sending" }));
  } catch (e) {
    if (isUniqueViolation(e)) return { skipped: "already_sent" };
    throw e;
  }
  const at = DateTime.fromJSDate(appt.startsAt, { zone: appt.organization.timezone });
  const text = renderTemplate(String((auto.config as any).template ?? ""), {
    name: appt.customer.name?.split(" ")[0] ?? "there", business: appt.organization.name, service: appt.service.name,
    time: at.toFormat("h:mm a"), date: at.toFormat("cccc d LLLL"), staff: appt.staff?.name,
  });
  try {
    const r = await sendSystem(appt.organizationId, appt.customerId, text);
    const sent = "sent" in (r as any);
    if (!sent) {
      // Nothing went out (no WhatsApp, expired plan, opted out): free the slot so a later attempt can still send it.
      await run(from("ReminderLog").delete().eq("appointmentId", appt.id).eq("kind", job.automationKey)).catch(() => {});
      return r;
    }
    // Delivered. Bookkeeping failures must not retry (that would send the reminder twice).
    try {
      await run(from("ReminderLog").update({ status: "sent", sentAt: new Date().toISOString() }).eq("appointmentId", appt.id).eq("kind", job.automationKey));
      await bumpSent(appt.organizationId, auto.id);
    } catch (e) { logger.error({ err: (e as Error).message, appointmentId: appt.id }, "reminder sent but bookkeeping failed"); }
    return r;
  } catch (e) {
    // Sending itself failed: allow a retry to try again
    await run(from("ReminderLog").delete().eq("appointmentId", appt.id).eq("kind", job.automationKey)).catch(() => {});
    throw e;
  }
}

export async function handleFollowup(job: FollowupJob) {
  if ("followupId" in job) {
    const f = await maybe<Followup & { customer: Customer }>(from("Followup").select("*, customer:Customer(*)").eq("id", job.followupId).maybeSingle());
    if (!f || f.status !== "pending") return { skipped: "not_pending" };
    const ft = tenant(f.organizationId);
    if (f.customer.optedOut) { await run(ft.from("Followup").update({ status: "skipped" }).eq("id", f.id)); return { skipped: "opted_out" }; }
    const r = await sendSystem(f.organizationId, f.customerId, f.message ?? f.reason);
    if ("sent" in (r as any)) await run(ft.from("Followup").update({ status: "sent", sentAt: new Date().toISOString() }).eq("id", f.id));
    else if ((r as any).skipped === "opted_out" || (r as any).skipped === "subscription_inactive") await run(ft.from("Followup").update({ status: "skipped" }).eq("id", f.id));
    return r;
  }

  if (job.kind === "customer_care") return handleCareNudge(job);

  if (job.kind === "abandoned_enquiry") {
    const t = tenant(job.organizationId);
    const [c, org, auto] = await Promise.all([
      maybe<Customer>(t.from("Customer").select("*").eq("id", job.customerId).maybeSingle()),
      maybe<Organization>(from("Organization").select("*").eq("id", job.organizationId).maybeSingle()),
      getAutomation(job.organizationId, "abandoned_enquiry"),
    ]);
    if (!c || !org || !auto?.enabled || c.optedOut) return { skipped: "disabled_or_opted_out" };
    const since = new Date(job.since);
    const [orders, appts, recentAuto, convo] = await Promise.all([
      count(t.from("Order").select("*", { count: "exact", head: true }).eq("customerId", c.id).gte("createdAt", since.toISOString())),
      count(t.from("Appointment").select("*", { count: "exact", head: true }).eq("customerId", c.id).gte("startsAt", since.toISOString())),
      count(t.from("Message").select("id, conversation:Conversation!inner(customerId)", { count: "exact", head: true })
        .eq("conversation.customerId", c.id).eq("sender", "system").gte("createdAt", new Date(Date.now() - 7 * 864e5).toISOString())),
      maybe<Conversation>(t.from("Conversation").select("*").eq("customerId", c.id).order("lastMessageAt", { ascending: false }).limit(1).maybeSingle()),
    ]);
    if (orders || appts) return { skipped: "converted" };
    if (recentAuto) return { skipped: "frequency_cap" };
    if (convo?.handler === "HUMAN") return { skipped: "human_handling" };
    const r = await sendSystem(org.id, c.id, renderTemplate(String((auto.config as any).template), { name: c.name?.split(" ")[0] ?? "there", business: org.name }));
    if ("sent" in (r as any)) await bumpSent(org.id, auto.id).catch(() => {});
    return r;
  }

  if (job.kind === "order_confirmation") {
    const order = await maybe<Order & { customer: Customer; organization: Organization }>(
      tenant(job.organizationId).from("Order").select("*, customer:Customer(*), organization:Organization(*)").eq("id", job.orderId).maybeSingle(),
    );
    const auto = await getAutomation(job.organizationId, "order_confirmation");
    if (!order || !auto?.enabled || order.customer.optedOut) return { skipped: "disabled_or_opted_out" };
    if (order.status === "CANCELLED") return { skipped: "order_cancelled" };
    const r = await sendSystem(order.organizationId, order.customerId, renderTemplate(String((auto.config as any).template), {
      name: order.customer.name?.split(" ")[0] ?? "there", business: order.organization.name, order: `#${order.number} (${formatNaira(order.totalCents / 100)})`,
    }));
    if ("sent" in (r as any)) await bumpSent(order.organizationId, auto.id).catch(() => {});
    return r;
  }
  logger.warn({ job }, "unknown followup job");
}

export { AUTOMATED_GAP_MS };
