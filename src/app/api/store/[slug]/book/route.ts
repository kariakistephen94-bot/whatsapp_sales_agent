import { z } from "zod";
import { run, tenant } from "@/server/db";
import { bookAppointment } from "@/modules/appointments/service";
import { clientIp, publishedOrg, upsertStoreCustomer } from "@/modules/storefront/public";
import { normalizeNgPhone } from "@/lib/locale";
import { rateLimit } from "@/server/rate-limit";
import { logger } from "@/server/logger";

const Body = z.object({
  serviceId: z.string().min(1).max(40),
  startsAt: z.string().min(10).max(40),
  staffId: z.string().min(1).max(40).nullish(),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  notes: z.string().trim().max(500).optional().default(""),
});

/** Public booking: re-checks availability atomically inside bookAppointment. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await rateLimit(`store-book:${clientIp(req)}`, 5, 600))) return Response.json({ error: "Too many bookings from this device. Please try again later." }, { status: 429 });

  const org = await publishedOrg(slug);
  if (!org) return Response.json({ error: "Store not found" }, { status: 404 });
  if (!org.capabilities.includes("appointments") && !org.capabilities.includes("reservations")) return Response.json({ error: "This store doesn't take bookings online" }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check your details and try again." }, { status: 400 });
  const d = parsed.data;
  const phone = normalizeNgPhone(d.phone);
  if (!phone) return Response.json({ error: "Enter a valid phone number, e.g. 0803 123 4567" }, { status: 400 });

  try {
    const customer = await upsertStoreCustomer(org.id, phone, d.name);
    const r = await bookAppointment({
      organizationId: org.id, customerId: customer.id, serviceId: d.serviceId, startsAt: d.startsAt, staffId: d.staffId ?? null,
      source: "storefront", notes: d.notes || null,
    });
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 });
    await run(tenant(org.id).from("AuditLog").insert({ action: "storefront.booking", entity: "appointment", entityId: r.appointmentId }));
    return Response.json({ ok: true, startsAt: r.startsAt, staffName: r.staffName, serviceName: r.serviceName, whatsapp: org.whatsapp });
  } catch (e) {
    logger.error(e, "storefront booking failed");
    return Response.json({ error: "We couldn't book that time. Please try again." }, { status: 500 });
  }
}
