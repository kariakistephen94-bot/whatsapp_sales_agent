import { DateTime } from "luxon";
import { from, maybe, must, rpc, run, tenant, type Appointment, type Automation, type CatalogItem, type StaffMember } from "@/server/db";
import { remindersQueue } from "@/server/queue";
import { logger } from "@/server/logger";
import { asHours, dayOf, DEFAULT_HOURS, type WeeklyHours } from "./hours";

const SLOT_STEP_MIN = 30;
const LEAD_TIME_MIN = 30;

// StaffMember columns not (yet) in the shared row type.
type Staff = StaffMember & { serviceIds: string[] | null; active: boolean };

export interface Slot { start: string; staffId: string | null; staffName: string | null }

async function context(organizationId: string, serviceId: string) {
  const t = tenant(organizationId);
  const [org, service, staff] = await Promise.all([
    must<{ timezone: string; businessHours: unknown }>(from("Organization").select("timezone, businessHours").eq("id", organizationId).single()),
    maybe<CatalogItem>(t.from("CatalogItem").select("*").eq("id", serviceId).eq("active", true).eq("kind", "SERVICE").maybeSingle()),
    run<Staff[]>(t.from("StaffMember").select("*").eq("active", true).order("name", { ascending: true })),
  ]);
  const bookable = staff.filter((s) => !s.serviceIds?.length || s.serviceIds.includes(serviceId));
  return { tz: org.timezone, business: asHours(org.businessHours) ?? DEFAULT_HOURS, service, staff, bookable };
}

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/**
 * Real availability for a service on a date (yyyy-mm-dd, org timezone).
 * Uses staff hours (or business hours when there's no staff) and excludes existing bookings.
 */
export async function getAvailability(organizationId: string, serviceId: string, date: string, staffId?: string | null, ignoreAppointmentId?: string): Promise<{ slots: Slot[]; error?: string; durationMins?: number }> {
  const c = await context(organizationId, serviceId);
  if (!c.service) return { slots: [], error: "Service not found or not bookable" };
  const dur = c.service.durationMins ?? 60;
  const day = DateTime.fromISO(date, { zone: c.tz });
  if (!day.isValid) return { slots: [], error: "Invalid date" };

  // Resources: specific staff, all staff able to do the service, or the business itself if no staff exist.
  let resources: { id: string | null; name: string | null; hours: WeeklyHours }[];
  if (c.staff.length === 0) resources = [{ id: null, name: null, hours: c.business }];
  else {
    const pool = staffId ? c.bookable.filter((s) => s.id === staffId) : c.bookable;
    if (!pool.length) return { slots: [], error: staffId ? "That staff member doesn't offer this service" : "No staff offer this service" };
    resources = pool.map((s) => ({ id: s.id, name: s.name, hours: asHours(s.workingHours) ?? c.business }));
  }

  const dayStart = day.startOf("day"), dayEnd = day.endOf("day");
  let bookedQ = tenant(organizationId).from("Appointment").select("staffId, startsAt, endsAt")
    .eq("status", "booked").lt("startsAt", dayEnd.toJSDate().toISOString()).gt("endsAt", dayStart.toJSDate().toISOString());
  if (ignoreAppointmentId) bookedQ = bookedQ.neq("id", ignoreAppointmentId);
  const booked = await run<{ staffId: string | null; startsAt: Date; endsAt: Date }[]>(bookedQ);
  const earliest = DateTime.now().plus({ minutes: LEAD_TIME_MIN });

  const byTime = new Map<string, Slot>();
  for (const r of resources) {
    for (const w of r.hours[dayOf(day)] ?? []) {
      const [sh, sm] = w.start.split(":").map(Number), [eh, em] = w.end.split(":").map(Number);
      const winEnd = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
      for (let t = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 }); t.plus({ minutes: dur }) <= winEnd; t = t.plus({ minutes: SLOT_STEP_MIN })) {
        if (t < earliest) continue;
        const s = t.toJSDate(), e = t.plus({ minutes: dur }).toJSDate();
        const clash = booked.some((b) => (r.id === null || b.staffId === r.id || b.staffId === null) && overlaps(s, e, b.startsAt, b.endsAt));
        const key = t.toISO()!;
        if (!clash && !byTime.has(key)) byTime.set(key, { start: key, staffId: r.id, staffName: r.name });
      }
    }
  }
  return { slots: [...byTime.values()].sort((a, b) => a.start.localeCompare(b.start)), durationMins: dur };
}

export type BookResult = { ok: true; appointmentId: string; startsAt: string; staffName: string | null; serviceName: string } | { ok: false; error: string };

/** Books atomically: a per-org advisory lock + overlap re-check prevents double booking under concurrency. */
export async function bookAppointment(input: {
  organizationId: string; customerId: string; serviceId: string; startsAt: string; staffId?: string | null;
  source: "dashboard" | "whatsapp" | "storefront"; createdByAi?: boolean; conversationId?: string | null; notes?: string | null;
  ignoreAppointmentId?: string;
}): Promise<BookResult> {
  const c = await context(input.organizationId, input.serviceId);
  if (!c.service) return { ok: false, error: "Service not found or not bookable" };
  const start = DateTime.fromISO(input.startsAt, { zone: c.tz });
  if (!start.isValid) return { ok: false, error: "Invalid time" };
  if (start < DateTime.now()) return { ok: false, error: "That time is in the past" };

  const end = start.plus({ minutes: c.service.durationMins ?? 60 });

  // Candidate resources that work at that time and can perform the service.
  const fits = (h: WeeklyHours) => (h[dayOf(start)] ?? []).some((w) => {
    const [sh, sm] = w.start.split(":").map(Number), [eh, em] = w.end.split(":").map(Number);
    return start >= start.set({ hour: sh, minute: sm, second: 0, millisecond: 0 }) && end <= start.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
  });
  // null = no staff exist, the business itself is the resource.
  let candidates: (string | null)[];
  if (c.staff.length === 0) candidates = fits(c.business) ? [null] : [];
  else {
    const pool = input.staffId ? c.bookable.filter((s) => s.id === input.staffId) : c.bookable;
    candidates = pool.filter((s) => fits(asHours(s.workingHours) ?? c.business)).map((s) => s.id);
  }
  if (!candidates.length) return { ok: false, error: "We're not open for that service at that time" };

  try {
    // Advisory lock + overlap re-check + insert in one transaction (app_book_appointment).
    const appt = await rpc<{ appointmentId: string; staffName: string | null } | null>("app_book_appointment", {
      p_org: input.organizationId, p_customer: input.customerId, p_service: input.serviceId,
      p_starts: start.toJSDate().toISOString(), p_ends: end.toJSDate().toISOString(),
      p_staff_ids: candidates[0] === null ? null : candidates,
      p_source: input.source, p_created_by_ai: !!input.createdByAi, p_conversation: input.conversationId ?? null,
      p_notes: input.notes ?? null, p_ignore: input.ignoreAppointmentId ?? null,
    });
    if (!appt) return { ok: false, error: "That time is no longer available" };
    // The booking is saved; a reminder-queue problem must not turn it into a reported failure.
    await scheduleReminders(appt.appointmentId).catch((e) => logger.warn({ err: e, appointmentId: appt.appointmentId }, "reminders not scheduled"));
    return { ok: true, appointmentId: appt.appointmentId, startsAt: start.toISO()!, staffName: appt.staffName ?? null, serviceName: c.service.name };
  } catch (e) {
    logger.error(e, "booking failed");
    return { ok: false, error: "Could not book that time. Please try another slot." };
  }
}

export async function rescheduleAppointment(organizationId: string, appointmentId: string, startsAt: string, staffId?: string | null): Promise<BookResult> {
  const t = tenant(organizationId);
  const appt = await maybe<Appointment>(t.from("Appointment").select("*").eq("id", appointmentId).eq("status", "booked").maybeSingle());
  if (!appt) return { ok: false, error: "Appointment not found or not active" };
  const res = await bookAppointment({
    organizationId, customerId: appt.customerId, serviceId: appt.serviceId, startsAt, staffId: staffId === undefined ? appt.staffId : staffId,
    source: appt.source as any, createdByAi: appt.createdByAi, conversationId: appt.conversationId, notes: appt.notes,
    ignoreAppointmentId: appt.id, // the old slot must not block its own move
  });
  if (res.ok) {
    await run(t.from("Appointment").update({ status: "cancelled", notes: `${appt.notes ?? ""}\nRescheduled to ${res.startsAt}`.trim() }).eq("id", appt.id));
    // ReminderLog has no organizationId; appt.id was verified above to belong to this org.
    await run(from("ReminderLog").delete().eq("appointmentId", appt.id).is("sentAt", null));
  }
  return res;
}

export async function cancelAppointment(organizationId: string, appointmentId: string) {
  const r = await run<{ id: string }[]>(tenant(organizationId).from("Appointment").update({ status: "cancelled" }).eq("id", appointmentId).eq("status", "booked").select("id"));
  return r.length === 1;
}

export async function setAppointmentStatus(organizationId: string, appointmentId: string, status: "completed" | "no_show" | "cancelled" | "booked") {
  const r = await run<{ id: string }[]>(tenant(organizationId).from("Appointment").update({ status }).eq("id", appointmentId).select("id"));
  return r.length === 1;
}

/**
 * Queues reminder jobs for enabled reminder automations. Job ids include the start time, so
 * a rescheduled appointment gets fresh jobs and stale ones no-op (the worker re-checks everything).
 */
export async function scheduleReminders(appointmentId: string) {
  const appt = await maybe<Appointment>(from("Appointment").select("*").eq("id", appointmentId).maybeSingle());
  if (!appt) return;
  const autos = await run<Automation[]>(
    tenant(appt.organizationId).from("Automation").select("*").eq("enabled", true).in("trigger", ["appointment_reminder", "after_appointment"]),
  );
  for (const a of autos) {
    const off = Number((a.config as any)?.offsetMinutes ?? 0);
    const base = a.trigger === "after_appointment" ? appt.endsAt : appt.startsAt;
    const at = base.getTime() + off * 60_000;
    const delay = at - Date.now();
    if (delay < 0) continue;
    await remindersQueue().add("reminder", { appointmentId: appt.id, automationKey: a.key, startsAtMs: appt.startsAt.getTime() }, {
      delay, jobId: `rem-${appt.id}-${a.key}-${appt.startsAt.getTime()}`,
    }).catch((e) => logger.warn({ err: e }, "could not queue reminder"));
  }
}
