import { DateTime } from "luxon";
import { Lock } from "lucide-react";
import { getTenantContext, hasRole } from "@/modules/tenancy/context";
import { from, must, run, type Invitation, type Json, type Role } from "@/server/db";
import { planLimits } from "@/modules/billing/usage";
import { asHours, DEFAULT_HOURS, describeHours } from "@/modules/appointments/hours";
import { Card, PageHeader } from "@/components/ui";
import { EmptyState } from "@/components/commerce/shared";
import { MembersSection, type InviteRow, type MemberRow } from "@/components/team/members-section";
import { StaffSection, type StaffRow } from "@/components/team/staff-section";

export const dynamic = "force-dynamic";

type MembershipRow = { id: string; userId: string; role: Role; createdAt: Date; phone: string | null; notifyHandoffs: boolean; user: { id: string; name: string | null; email: string; createdAt: Date } };
type StaffMemberRow = { id: string; name: string; role: string | null; workingHours: Json; serviceIds: string[] | null; active: boolean };

export default async function TeamPage() {
  const ctx = await getTenantContext();
  if (!hasRole(ctx.role, "ADMIN")) {
    // Staff: only their own row, so they can set the WhatsApp number their hand-off alerts go to.
    const me = await must<MembershipRow>(ctx.db.from("Membership").select("id, userId, role, createdAt, phone, notifyHandoffs, user:User!inner(id, name, email, createdAt)").eq("userId", ctx.userId).single());
    const self: MemberRow = { id: me.id, name: me.user.name, email: me.user.email, role: me.role, isSelf: true, joined: DateTime.fromJSDate(me.createdAt).toFormat("d LLL yyyy"), phone: me.phone, notifyHandoffs: me.notifyHandoffs };
    return (
      <div>
        <PageHeader title="Team" sub="Your WhatsApp number for hand-off alerts." />
        <MembersSection members={[self]} invites={[]} limit={-1} whatsappConnected canManage={false} />
        <div className="mt-6"><EmptyState icon={<Lock size={22} />} title="Only admins can manage the team" sub="Ask your workspace owner or an admin if you need access changed." /></div>
      </div>
    );
  }

  const org = await must<{ timezone: string; businessHours: Json | null; capabilities: string[] }>(
    from("Organization").select("timezone, businessHours, capabilities").eq("id", ctx.organizationId).single(),
  );
  const tz = org.timezone;
  const weekStart = DateTime.now().setZone(tz).startOf("week");
  const caps = org.capabilities ?? [];
  const bookable = caps.includes("appointments") || caps.includes("reservations");

  const [memberships, invites, staff, services, weekCounts, limits] = await Promise.all([
    run<MembershipRow[]>(ctx.db.from("Membership").select("id, userId, role, createdAt, phone, notifyHandoffs, user:User!inner(id, name, email, createdAt)")),
    run<Invitation[]>(ctx.db.from("Invitation").select("*").order("createdAt", { ascending: false })),
    run<StaffMemberRow[]>(ctx.db.from("StaffMember").select("*").order("active", { ascending: false }).order("name", { ascending: true })),
    run<{ id: string; name: string; active: boolean }[]>(ctx.db.from("CatalogItem").select("id, name, active").eq("kind", "SERVICE").order("name", { ascending: true })),
    // Bookings per staff member this week (small per-org set; counted here instead of a SQL group by).
    run<{ staffId: string | null }[]>(
      ctx.db.from("Appointment").select("staffId").in("status", ["booked", "completed"])
        .gte("startsAt", weekStart.toJSDate().toISOString()).lt("startsAt", weekStart.plus({ weeks: 1 }).toJSDate().toISOString()),
    ).then((rows) => {
      const m = new Map<string | null, number>();
      for (const r of rows) m.set(r.staffId, (m.get(r.staffId) ?? 0) + 1);
      return [...m].map(([staffId, _count]) => ({ staffId, _count }));
    }),
    planLimits(ctx.organizationId),
  ]);
  const whatsappConnected = (await run<{ id: string }[]>(ctx.db.from("WhatsappConnection").select("id").eq("status", "connected").limit(1))).length > 0;

  const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat("d LLL yyyy");
  const acceptedAt = new Map(invites.filter((i) => i.acceptedAt).map((i) => [i.email.toLowerCase(), i.acceptedAt!]));
  const RANK = { OWNER: 0, ADMIN: 1, STAFF: 2 } as const;
  const members: MemberRow[] = memberships
    .sort((a, b) => RANK[a.role] - RANK[b.role] || a.user.email.localeCompare(b.user.email))
    .map((m) => ({
      id: m.id, name: m.user.name, email: m.user.email, role: m.role, isSelf: m.userId === ctx.userId,
      joined: fmt(m.createdAt), phone: m.phone, notifyHandoffs: m.notifyHandoffs,
    }));
  const pending: InviteRow[] = invites.filter((i) => !i.acceptedAt).map((i) => ({ id: i.id, email: i.email, role: i.role, sent: fmt(i.createdAt), phone: i.phone }));

  const business = asHours(org.businessHours) ?? DEFAULT_HOURS;
  const counts = new Map(weekCounts.map((c) => [c.staffId, c._count]));
  const staffRows: StaffRow[] = staff.map((s) => {
    const hours = asHours(s.workingHours) ?? business;
    return { id: s.id, name: s.name, role: s.role, active: s.active, serviceIds: s.serviceIds ?? [], hours, hoursText: describeHours(hours), bookedThisWeek: counts.get(s.id) ?? 0 };
  });

  return (
    <div>
      <PageHeader title="Team" sub="Dashboard users and bookable staff." />
      <MembersSection members={members} invites={pending} limit={limits.teamMembers} whatsappConnected={whatsappConnected} canManage />
      {(bookable || staff.length > 0) && <StaffSection staff={staffRows} services={services} defaultHours={business} />}
      <Card title="Role permissions" className="mt-8">
        <ul className="space-y-1.5 text-sm text-muted">
          <li><b className="text-fg">Owner</b> · everything, including billing and deleting the workspace</li>
          <li><b className="text-fg">Admin</b> · manage team, catalog, AI agent, automations and settings</li>
          <li><b className="text-fg">Staff</b> · conversations, customers, orders and appointments</li>
        </ul>
      </Card>
    </div>
  );
}
