import { DateTime } from "luxon";
import { count, from, maybe, must, run, type Json, type Subscription } from "@/server/db";
import { getTenantContext, hasRole } from "@/modules/tenancy/context";
import { planLimits, usage } from "@/modules/billing/usage";
import { asHours, DEFAULT_HOURS } from "@/modules/appointments/hours";
import { getIndustry } from "@/modules/industries/templates";
import { auditLabel } from "@/modules/analytics/queries";
import { ConnectionPanel } from "@/components/whatsapp/connection-panel";
import { Badge, Card } from "@/components/ui";
import { BusinessProfileForm } from "@/components/workspace/business-profile-form";
import { BusinessHoursForm } from "@/components/workspace/business-hours-form";
import { DataPrivacy } from "@/components/workspace/data-privacy";
import { OfferingForm } from "@/components/workspace/offering-form";
import { PaymentsCard } from "@/components/workspace/payments-card";
import { paymentStatus } from "@/modules/payments/service";
import { appUrl } from "@/modules/billing/service";

export const dynamic = "force-dynamic";

type OrgRow = {
  name: string; description: string | null; email: string | null; phone: string | null; address: string | null; city: string | null;
  website: string | null; industryTemplateKey: string | null; timezone: string; businessHours: Json | null;
};

export default async function SettingsPage() {
  const ctx = await getTenantContext();
  const isAdmin = hasRole(ctx.role, "ADMIN");
  const id = ctx.organizationId;
  const [org, sub, limits, aiUsed, customers, items, members, invites, connections, logs] = await Promise.all([
    must<OrgRow>(from("Organization").select("name, description, email, phone, address, city, website, industryTemplateKey, timezone, businessHours").eq("id", id).single()),
    maybe<Subscription & { plan: { name: string; key: string } }>(ctx.db.from("Subscription").select("*, plan:Plan(name, key)").maybeSingle()),
    planLimits(id),
    usage(id, "ai_messages"),
    count(ctx.db.from("Customer").select("*", { count: "exact", head: true })),
    count(ctx.db.from("CatalogItem").select("*", { count: "exact", head: true })),
    count(ctx.db.from("Membership").select("*", { count: "exact", head: true })),
    count(ctx.db.from("Invitation").select("*", { count: "exact", head: true }).is("acceptedAt", null)),
    count(ctx.db.from("WhatsappConnection").select("*", { count: "exact", head: true })),
    run<{ id: string; action: string; actorId: string | null; createdAt: Date; meta: Json | null }[]>(
      ctx.db.from("AuditLog").select("id, action, actorId, createdAt, meta").like("action", "settings.%").order("createdAt", { ascending: false }).limit(8),
    ),
  ]);
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean) as string[])];
  const actors = actorIds.length
    ? await run<{ id: string; email: string; name: string | null }[]>(from("User").select("id, email, name").in("id", actorIds))
    : [];
  const who = (uid: string | null) => { const u = actors.find((a) => a.id === uid); return u ? u.name ?? u.email : "System"; };

  const pay = await paymentStatus(id);
  const trialDays = sub?.status === "trialing" && sub.trialEndsAt ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 864e5)) : null;
  const planBadge = sub ? (trialDays != null ? `${sub.plan.name} · ${trialDays} day${trialDays === 1 ? "" : "s"} left` : `${sub.plan.name} · ${sub.status}`) : "No plan";
  const meters: [string, number, number][] = [
    ["AI messages this month", aiUsed, limits.aiMessagesMonthly],
    ["Customers", customers, limits.customers],
    ["Catalog items", items, limits.products],
    ["Team members", members + invites, limits.teamMembers],
    ["WhatsApp connections", connections, limits.whatsappConnections],
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-lg font-semibold tracking-tight">Settings</h1>

      <section><h2 className="mb-3 text-sm font-medium">WhatsApp</h2><ConnectionPanel /></section>

      <section><h2 className="mb-3 text-sm font-medium">Payments</h2><Card><PaymentsCard {...pay} webhookUrl={`${appUrl()}/api/webhooks/paystack-business`} canEdit={hasRole(ctx.role, "OWNER")} /></Card></section>

      <Card title="Business profile">
        <BusinessProfileForm canEdit={isAdmin}
          initial={{ name: org.name, description: org.description ?? "", email: org.email ?? "", phone: org.phone ?? "", address: org.address ?? "", city: org.city ?? "", website: org.website ?? "" }}
          fixed={{ industry: getIndustry(org.industryTemplateKey).label, timezone: org.timezone === "Africa/Lagos" ? "Africa/Lagos (WAT)" : org.timezone, currency: "Nigerian Naira (₦)" }} />
        {logs.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-2 text-xs font-medium text-muted">Recent changes</h3>
            <ul className="space-y-1.5 text-xs">
              {logs.map((l) => {
                const fields = (l.meta as { fields?: string[] } | null)?.fields;
                return (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2">
                    <span>{auditLabel(l.action)}{fields?.length ? ` (${fields.join(", ")})` : ""} · <span className="text-muted">{who(l.actorId)}</span></span>
                    <span className="text-muted">{DateTime.fromJSDate(l.createdAt).setZone("Africa/Lagos").toFormat("d LLL yyyy, h:mm a")}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <Card title="What your business offers">
        <OfferingForm canEdit={isAdmin} initial={{ products: ctx.capabilities.includes("products"), services: ctx.capabilities.some((c) => ["services", "appointments", "reservations"].includes(c)), menu: ctx.capabilities.includes("menu"), inventory: ctx.capabilities.includes("inventory") }} />
      </Card>

      <Card title="Business hours">
        <BusinessHoursForm canEdit={isAdmin} initial={asHours(org.businessHours) ?? DEFAULT_HOURS} isDefault={!asHours(org.businessHours)} />
      </Card>

      <Card title="Plan & usage" action={<Badge tone={trialDays != null && trialDays <= 3 ? "amber" : "blue"}>{planBadge}</Badge>}>
        <ul className="space-y-3 text-sm">
          {meters.map(([l, n, max]) => {
            const unlimited = max === -1;
            const pct = unlimited || max <= 0 ? 0 : Math.min(100, (n / max) * 100);
            return (
              <li key={l}>
                <div className="mb-1 flex justify-between"><span>{l}</span><span className="tabular-nums text-muted">{n.toLocaleString("en-NG")} / {unlimited ? "Unlimited" : max.toLocaleString("en-NG")}</span></div>
                <div className="h-1.5 rounded-full bg-border/60"><div className={`h-1.5 rounded-full ${pct >= 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} /></div>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-muted">Need more? <a href="/dashboard/billing" className="underline">Upgrade or renew your plan</a>.</p>
      </Card>

      <Card title="Data & privacy">
        <DataPrivacy canExport={isAdmin} isOwner={ctx.role === "OWNER"} orgName={org.name} />
      </Card>
    </div>
  );
}
