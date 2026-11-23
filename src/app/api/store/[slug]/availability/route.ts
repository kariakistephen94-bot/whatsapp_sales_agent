import { z } from "zod";
import { DateTime } from "luxon";
import { getAvailability } from "@/modules/appointments/service";
import { clientIp, publishedOrg } from "@/modules/storefront/public";
import { rateLimit } from "@/server/rate-limit";

const Query = z.object({
  serviceId: z.string().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId: z.string().min(1).max(40).optional(),
});

/** Public: real open slots for a service on a date (published storefronts only). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await rateLimit(`store-avail:${clientIp(req)}`, 60, 60))) return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  const org = await publishedOrg(slug);
  if (!org) return Response.json({ error: "Store not found" }, { status: 404 });
  if (!org.capabilities.includes("appointments") && !org.capabilities.includes("reservations")) return Response.json({ error: "This store doesn't take bookings online" }, { status: 400 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const q = Query.safeParse(sp);
  if (!q.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const day = DateTime.fromISO(q.data.date, { zone: org.timezone });
  const today = DateTime.now().setZone(org.timezone).startOf("day");
  if (!day.isValid || day < today || day > today.plus({ days: 60 })) return Response.json({ error: "Pick a date within the next 60 days" }, { status: 400 });

  const r = await getAvailability(org.id, q.data.serviceId, q.data.date, q.data.staffId);
  if (r.error) return Response.json({ error: r.error, slots: [] }, { status: 400 });
  return Response.json(
    { slots: r.slots.map((s) => ({ start: s.start, staffId: s.staffId, staffName: s.staffName })), durationMins: r.durationMins },
    { headers: { "cache-control": "no-store" } },
  );
}
