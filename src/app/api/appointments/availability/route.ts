import { z } from "zod";
import { withTenant } from "@/modules/tenancy/context";
import { getAvailability } from "@/modules/appointments/service";
import { maybe } from "@/server/db";

export const dynamic = "force-dynamic";

const q = z.object({
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  staffId: z.string().min(1).optional(),
});

/** GET /api/appointments/availability?serviceId=…&date=YYYY-MM-DD[&staffId=…] → { slots, durationMins?, error? } */
export const GET = withTenant("STAFF", async (ctx, req) => {
  const sp = new URL(req.url).searchParams;
  const p = q.safeParse({ serviceId: sp.get("serviceId") ?? "", date: sp.get("date") ?? "", staffId: sp.get("staffId") || undefined });
  if (!p.success) return Response.json({ slots: [], error: "Choose a service and a date" }, { status: 400 });
  // When rescheduling, the appointment's own current slot must not block nearby times (only if it's ours).
  const ignore = sp.get("ignore");
  const own = ignore ? await maybe<{ id: string }>(ctx.db.from("Appointment").select("id").eq("id", ignore).maybeSingle()) : null;
  // Organization comes from the session; getAvailability scopes service, staff and bookings to it.
  return getAvailability(ctx.organizationId, p.data.serviceId, p.data.date, p.data.staffId ?? null, own?.id);
});
