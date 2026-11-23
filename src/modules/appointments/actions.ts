"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, UserError, type TenantContext } from "@/modules/tenancy/context";
import { bookAppointment, cancelAppointment, rescheduleAppointment, setAppointmentStatus } from "@/modules/appointments/service";
import { refreshCustomer } from "@/modules/customers/service";
import { normalizeNgPhone } from "@/lib/locale";
import { maybe, run } from "@/server/db";

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Please check the form and try again.");
  return r.data;
}

const customerInput = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ name: z.string().trim().min(2, "Enter the customer's name").max(120), phone: z.string().trim().min(7, "Enter a valid phone number") }),
]);

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

const isoTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Pick a time slot");

const bookSchema = z.object({
  customer: customerInput,
  serviceId: z.string().min(1, "Choose a service"),
  staffId: z.string().min(1).nullable().optional(),
  startsAt: isoTime,
  notes: z.string().trim().max(1000).optional(),
});

async function staffBelongs(ctx: TenantContext, staffId: string | null | undefined) {
  if (!staffId) return;
  const s = await maybe<{ id: string }>(ctx.db.from("StaffMember").select("id").eq("id", staffId).maybeSingle());
  if (!s) throw new UserError("Staff member not found");
}

export async function createAppointment(input: z.input<typeof bookSchema>) {
  return action("STAFF", async (ctx) => {
    const d = parse(bookSchema, input);
    await staffBelongs(ctx, d.staffId);
    const customerId = await resolveCustomer(ctx, d.customer);
    // bookAppointment verifies the service belongs to this org and is bookable.
    const res = await bookAppointment({
      organizationId: ctx.organizationId, customerId, serviceId: d.serviceId, staffId: d.staffId ?? null,
      startsAt: d.startsAt, source: "dashboard", notes: d.notes || null,
    });
    if (!res.ok) throw new UserError(res.error);
    await audit(ctx, "appointment.booked", res.appointmentId);
    revalidatePath("/dashboard/appointments");
    return { appointmentId: res.appointmentId };
  });
}

export async function rescheduleAppointmentAction(input: { appointmentId: string; startsAt: string; staffId?: string | null }) {
  return action("STAFF", async (ctx) => {
    const d = parse(z.object({ appointmentId: z.string().min(1), startsAt: isoTime, staffId: z.string().min(1).nullable().optional() }), input);
    await staffBelongs(ctx, d.staffId);
    const res = await rescheduleAppointment(ctx.organizationId, d.appointmentId, d.startsAt, d.staffId);
    if (!res.ok) throw new UserError(res.error);
    await audit(ctx, "appointment.rescheduled", d.appointmentId, { newAppointmentId: res.appointmentId });
    revalidatePath("/dashboard/appointments");
    return { appointmentId: res.appointmentId };
  });
}

export async function updateAppointmentStatus(appointmentId: string, status: "completed" | "no_show" | "cancelled") {
  return action("STAFF", async (ctx) => {
    const s = parse(z.enum(["completed", "no_show", "cancelled"]), status);
    const appt = await maybe<{ id: string; status: string; customerId: string; startsAt: Date }>(
      ctx.db.from("Appointment").select("id, status, customerId, startsAt").eq("id", String(appointmentId)).maybeSingle(),
    );
    if (!appt) throw new UserError("Appointment not found");
    if (s === "cancelled") {
      if (!(await cancelAppointment(ctx.organizationId, appt.id))) throw new UserError("Only booked appointments can be cancelled");
    } else {
      if (appt.status === "cancelled") throw new UserError("This appointment was cancelled");
      if (appt.startsAt > new Date()) throw new UserError(s === "completed" ? "You can mark it completed once it has started" : "You can mark a no-show once the start time has passed");
      await setAppointmentStatus(ctx.organizationId, appt.id, s);
      // Completed visits count towards lifetime value; undoing one must too.
      if (s === "completed" || appt.status === "completed") await refreshCustomer(appt.customerId);
    }
    await audit(ctx, `appointment.${s}`, appt.id);
    revalidatePath("/dashboard/appointments");
    return { status: s };
  });
}

async function audit(ctx: TenantContext, act: string, entityId: string, meta?: Record<string, unknown>) {
  await run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: act, entity: "appointment", entityId, meta: meta ?? null })).catch(() => {});
}
