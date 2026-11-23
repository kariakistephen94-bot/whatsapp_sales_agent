import { DateTime } from "luxon";
import { getTenantContext } from "@/modules/tenancy/context";
import { serviceState } from "@/modules/billing/usage";
import { listPaidPlans, recentTransactions } from "@/modules/billing/service";
import { paystackConfigured } from "@/modules/billing/paystack";
import { formatKobo } from "@/lib/locale";
import { Badge, Card, PageHeader } from "@/components/ui";
import { UpgradeButton } from "@/components/billing/upgrade-button";

export const dynamic = "force-dynamic";

const LIMIT_LABELS: [string, string][] = [
  ["aiMessagesMonthly", "AI replies / month"], ["customers", "Customers"], ["products", "Catalog items"],
  ["teamMembers", "Team members"], ["whatsappConnections", "WhatsApp numbers"], ["automations", "Automations"],
];
const fmtLimit = (n: number) => (n === -1 ? "Unlimited" : n.toLocaleString("en-NG"));

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const sp = await searchParams;
  const ctx = await getTenantContext("ADMIN");
  const isOwner = ctx.role === "OWNER";
  const [state, plans, txs] = await Promise.all([serviceState(ctx.organizationId), listPaidPlans(), recentTransactions(ctx.organizationId)]);
  const configured = paystackConfigured();
  const tone = state.status === "expired" ? "red" : state.status === "grace" || (state.daysLeft != null && state.daysLeft <= 3) ? "amber" : "green";
  const statusText = { trialing: "Free trial", active: "Active", grace: "Payment overdue", expired: "Expired", none: "No plan" }[state.status];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Billing" sub="Your plan, and payments for it. Plans last 30 days and are paid with Paystack (card, bank transfer or USSD)." />

      {sp.payment === "success" && <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm">Payment received — your plan is active. Thank you!</div>}
      {sp.payment === "pending" && <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">We're still confirming your payment. Refresh in a minute; if the plan doesn't change, contact support with your Paystack receipt.</div>}
      {sp.payment === "failed" && <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm">The payment didn't go through, and you haven't been charged for it. You can try again below.</div>}
      {state.status === "expired" && <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm">Your {state.planName ?? "plan"} has ended. The AI agent and automated messages are paused until you pick a plan.</div>}
      {state.status === "grace" && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">Your plan period has ended. Renew within a few days to keep the AI and automations running.</div>}

      <Card title="Current plan" action={<Badge tone={tone}>{statusText}</Badge>}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-lg font-semibold">{state.planName ?? "—"}</div>
          <div className="text-sm text-muted">
            {state.endsAt ? `${state.status === "trialing" ? "Trial ends" : state.status === "expired" ? "Ended" : "Renews / ends"} ${DateTime.fromJSDate(state.endsAt).setZone("Africa/Lagos").toFormat("d LLL yyyy")}${state.daysLeft != null && state.daysLeft > 0 ? ` · ${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left` : ""}` : ""}
          </div>
        </div>
      </Card>

      {!configured && <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">Online payments aren't switched on for this installation yet (the Paystack key is missing). Contact support to change your plan.</div>}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const current = state.planKey === p.key && (state.status === "active" || state.status === "grace");
          const limits = p.limits as Record<string, number>;
          // Unused paid time carries over when switching, converted by price (matches app_activate_plan).
          const cur = plans.find((x) => x.key === state.planKey);
          const carry = !current && state.status === "active" && cur && state.endsAt && state.endsAt > new Date()
            ? Math.round(((state.endsAt.getTime() - Date.now()) / 864e5) * cur.priceCents / p.priceCents) : 0;
          return (
            <section key={p.id} className={`flex flex-col rounded-lg border bg-surface p-4 ${current ? "border-accent" : "border-border"}`}>
              <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{p.name}</h3>{current && <Badge tone="green">Current</Badge>}</div>
              <div className="mt-2"><span className="text-2xl font-semibold tabular-nums">{formatKobo(p.priceCents)}</span><span className="text-sm text-muted"> / month</span></div>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                {LIMIT_LABELS.map(([k, l]) => <li key={k} className="flex justify-between gap-2"><span className="text-muted">{l}</span><span className="tabular-nums">{fmtLimit(limits[k] ?? 0)}</span></li>)}
              </ul>
              <div className="mt-4">
                {carry >= 1 && <p className="mb-2 text-xs text-muted">Your unused time on {cur!.name} carries over: about {carry} extra day{carry === 1 ? "" : "s"} on {p.name}, on top of 30.</p>}
                {isOwner && configured
                  ? <UpgradeButton planKey={p.key} primary={!current} label={current ? "Renew for 30 days" : state.planKey === "trial" || state.status !== "active" ? `Choose ${p.name}` : `Switch to ${p.name}`} />
                  : <p className="text-xs text-muted">{isOwner ? "" : "Only the workspace owner can change the plan."}</p>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="text-xs text-muted">Need more than {plans[plans.length - 1]?.name ?? "the biggest plan"} offers? Ask us about Enterprise.</p>

      <Card title="Payment history">
        {txs.length === 0 ? <p className="text-sm text-muted">No payments yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {txs.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{t.plan.name} · <span className="tabular-nums">{formatKobo(t.amountCents)}</span></span>
                <span className="flex items-center gap-3 text-xs text-muted">{DateTime.fromJSDate(t.paidAt ?? t.createdAt).setZone("Africa/Lagos").toFormat("d LLL yyyy, h:mm a")}<Badge tone={t.status === "success" ? "green" : t.status === "failed" ? "red" : "gray"}>{t.status}</Badge></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
