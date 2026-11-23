import { DateTime } from "luxon";
import { CalendarOff } from "lucide-react";
import { getTenantContext } from "@/modules/tenancy/context";
import { from, must, run, type Appointment } from "@/server/db";
import { asHours, DEFAULT_HOURS, DAYS, type WeeklyHours } from "@/modules/appointments/hours";
import { PageHeader } from "@/components/ui";
import { EmptyState } from "@/components/commerce/shared";
import { AppointmentsView, type ApptRow, type StaffOption, type ServiceOption } from "@/components/commerce/appointments-view";

export const dynamic = "force-dynamic";

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await getTenantContext();
  if (!ctx.capabilities.includes("appointments") && !ctx.capabilities.includes("reservations")) {
    return (
      <div>
        <PageHeader title="Appointments" />
        <EmptyState icon={<CalendarOff size={22} />} title="Appointments aren't enabled for your business"
          sub="Your business type doesn't take bookings. If that's changed, update your business capabilities in Settings." />
      </div>
    );
  }

  const sp = await searchParams;
  const org = await must<{ timezone: string; businessHours: unknown }>(from("Organization").select("timezone, businessHours").eq("id", ctx.organizationId).single());
  const tz = org.timezone;
  const now = DateTime.now().setZone(tz);
  const requested = sp.week ? DateTime.fromISO(sp.week, { zone: tz }) : now;
  const weekStart = (requested.isValid ? requested : now).startOf("week"); // Monday
  const weekEnd = weekStart.plus({ weeks: 1 });

  const [appts, staff, services] = await Promise.all([
    run<(Appointment & {
      customer: { id: string; name: string | null; phone: string };
      service: { id: string; name: string; durationMins: number | null; priceCents: number };
      staff: { id: string; name: string } | null;
    })[]>(
      ctx.db.from("Appointment")
        .select("*, customer:Customer(id, name, phone), service:CatalogItem(id, name, durationMins, priceCents), staff:StaffMember(id, name)")
        .gte("startsAt", weekStart.toJSDate().toISOString()).lt("startsAt", weekEnd.toJSDate().toISOString())
        .order("startsAt", { ascending: true }),
    ),
    run<{ id: string; name: string; active: boolean; serviceIds: string[] | null; workingHours: unknown }[]>(
      ctx.db.from("StaffMember").select("id, name, active, serviceIds, workingHours").order("name", { ascending: true }),
    ),
    run<{ id: string; name: string; durationMins: number | null; priceCents: number }[]>(
      ctx.db.from("CatalogItem").select("id, name, durationMins, priceCents").eq("kind", "SERVICE").eq("active", true).order("name", { ascending: true }),
    ),
  ]);

  const rows: ApptRow[] = appts.map((a) => {
    const s = DateTime.fromJSDate(a.startsAt, { zone: tz }), e = DateTime.fromJSDate(a.endsAt, { zone: tz });
    const sameDay = s.hasSame(e, "day");
    return {
      id: a.id, status: a.status, source: a.source, createdByAi: a.createdByAi, notes: a.notes,
      customer: a.customer, service: a.service, staff: a.staff,
      startsAt: s.toISO()!, dayIndex: s.weekday - 1, date: s.toISODate()!,
      startMin: s.hour * 60 + s.minute, endMin: sameDay ? e.hour * 60 + e.minute : 24 * 60,
      dateLabel: s.toFormat("ccc d LLL"), timeLabel: `${s.toFormat("HH:mm")}–${e.toFormat("HH:mm")}`,
      mins: Math.round(e.diff(s, "minutes").minutes),
    };
  });

  // Visible hour range: the earliest opening to the latest closing across business and staff hours.
  const business = asHours(org.businessHours) ?? DEFAULT_HOURS;
  const sources: WeeklyHours[] = [business, ...staff.filter((s) => s.active).map((s) => asHours(s.workingHours) ?? business)];
  let lo = Infinity, hi = -Infinity;
  for (const h of sources) for (const d of DAYS) for (const w of h[d] ?? []) { lo = Math.min(lo, toMin(w.start)); hi = Math.max(hi, toMin(w.end)); }
  for (const r of rows) if (r.status !== "cancelled") { lo = Math.min(lo, r.startMin); hi = Math.max(hi, r.endMin); }
  let startHour = Number.isFinite(lo) ? Math.floor(lo / 60) : 8, endHour = Number.isFinite(hi) ? Math.ceil(hi / 60) : 20;
  if (endHour - startHour < 4) { startHour = Math.min(startHour, 8); endHour = Math.max(endHour, 20); }
  startHour = Math.max(0, startHour); endHour = Math.min(24, endHour);

  const staffOptions: StaffOption[] = staff
    .filter((s) => s.active || appts.some((a) => a.staffId === s.id))
    .map((s) => ({ id: s.id, name: s.name, active: s.active, serviceIds: s.serviceIds ?? [] }));
  const serviceOptions: ServiceOption[] = services;

  const last = weekStart.plus({ days: 6 });
  const weekLabel = weekStart.month === last.month
    ? `${weekStart.toFormat("d")} – ${last.toFormat("d LLLL yyyy")}`
    : `${weekStart.toFormat("d LLL")} – ${last.toFormat("d LLL yyyy")}`;

  return (
    <AppointmentsView
      rows={rows} staff={staffOptions} services={serviceOptions}
      week={{
        label: weekLabel, start: weekStart.toISODate()!, prev: weekStart.minus({ weeks: 1 }).toISODate()!, next: weekEnd.toISODate()!,
        isCurrent: now >= weekStart && now < weekEnd,
        days: Array.from({ length: 7 }, (_, i) => { const d = weekStart.plus({ days: i }); return { date: d.toISODate()!, short: d.toFormat("ccc"), num: d.toFormat("d"), long: d.toFormat("cccc d LLLL") }; }),
      }}
      today={now.toISODate()!} hours={{ start: startHour, end: endHour }}
    />
  );
}
