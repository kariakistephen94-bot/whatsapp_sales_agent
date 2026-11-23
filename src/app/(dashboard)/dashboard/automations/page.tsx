import { ShieldCheck } from "lucide-react";
import { getTenantContext } from "@/modules/tenancy/context";
import { count, run, type Automation } from "@/server/db";
import { careConfig } from "@/modules/relationships/model";
import { CustomerCareCard } from "@/components/workspace/customer-care-card";
import { automationTemplates } from "@/modules/automations/templates";
import { Card, PageHeader } from "@/components/ui";
import { AutomationCard } from "@/components/workspace/automation-card";

export const dynamic = "force-dynamic";

const PLACEHOLDERS: Record<string, string[]> = {
  appointment_reminder: ["{name}", "{business}", "{service}", "{date}", "{time}", "{staff}"],
  after_appointment: ["{name}", "{business}", "{service}", "{date}", "{time}", "{staff}"],
  post_purchase: ["{name}", "{business}", "{order}"],
  abandoned_enquiry: ["{name}", "{business}"],
  first_message: [],
};

export default async function AutomationsPage() {
  const ctx = await getTenantContext("ADMIN");
  const load = () => run<(Automation & { enabled: boolean; sentCount: number })[]>(ctx.db.from("Automation").select("*").order("id", { ascending: true }));
  let rows = await load();
  // Seed any templates this workspace doesn't have yet (older workspaces, newly added templates).
  const missing = automationTemplates.filter((t) => !rows.some((r) => r.key === t.key));
  if (missing.length) {
    await run(ctx.db.from("Automation").upsert(
      missing.map((t) => ({ key: t.key, name: t.name, trigger: t.trigger, config: t.config, enabled: t.enabledByDefault })),
      { onConflict: "organizationId,key", ignoreDuplicates: true },
    ));
    rows = await load();
  }

  const order = new Map(automationTemplates.map((t, i) => [t.key, i]));
  const visible = rows
    .filter((r) => {
      const req = (r.config as any)?.requires as string[] | undefined;
      return !req?.length || req.some((c) => ctx.capabilities.includes(c));
    })
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));

  const care = visible.find((a) => a.key === "customer_care");
  const countRel = (r: string) => count(ctx.db.from("Customer").select("id", { count: "exact", head: true }).eq("relationship", r).eq("optedOut", false));
  const [due, at_risk, lapsed] = care ? await Promise.all([countRel("due"), countRel("at_risk"), countRel("lapsed")]) : [0, 0, 0];

  return (
    <div>
      <PageHeader title="Automations" sub="Messages sent automatically on WhatsApp, based on what your customers do." />
      {visible.length === 0 ? (
        <Card><p className="py-6 text-center text-sm text-muted">No automations apply to your business type yet.</p></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {care && <CustomerCareCard id={care.id} enabled={care.enabled} sentCount={care.sentCount} config={careConfig(care.config)} counts={{ due, at_risk, lapsed }} />}
          {visible.filter((a) => a.key !== "customer_care").map((a) => {
            const cfg = (a.config ?? {}) as { template?: string; offsetMinutes?: number };
            const tpl = automationTemplates.find((t) => t.key === a.key);
            return (
              <AutomationCard key={a.id} id={a.id} name={a.name} trigger={a.trigger} automationKey={a.key}
                description={tpl?.description ?? ""} enabled={a.enabled} sentCount={a.sentCount}
                template={cfg.template ?? ""} offsetMinutes={typeof cfg.offsetMinutes === "number" ? cfg.offsetMinutes : null}
                placeholders={PLACEHOLDERS[a.trigger] ?? ["{name}", "{business}"]} />
            );
          })}
        </div>
      )}
      <Card title="Safeguards" className="mt-4">
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />Customers who reply STOP are opted out and never receive automated messages (they can reply START to opt back in).</li>
          <li className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />Abandoned-enquiry follow-ups go out at most once per customer every 7 days, and never if they already ordered or booked, or a team member is handling the chat.</li>
          <li className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />“Keep in touch” messages go out only inside your sending hours, are spread out rather than sent in bursts, stop after your limit per quiet spell, and are never sent to someone who replied recently, who is chatting with a team member, or who said STOP. The first one always tells them how to opt out.</li>
          <li className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />Each appointment reminder is sent exactly once — duplicates are blocked, and reminders are skipped if the appointment is cancelled or moved.</li>
        </ul>
        <p className="mt-3 text-xs text-muted">Changes to reminder timing apply to appointments booked after you save.</p>
      </Card>
    </div>
  );
}
