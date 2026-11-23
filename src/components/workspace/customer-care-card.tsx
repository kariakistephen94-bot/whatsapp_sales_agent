"use client";
import { WriteWithAi } from "@/components/agent/write-with-ai";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, HeartHandshake } from "lucide-react";
import { btn, btnPrimary, inputCls, Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { setAutomationEnabled, updateCustomerCare } from "@/modules/automations/actions";
import type { CareConfig } from "@/modules/relationships/model";

export function CustomerCareCard(p: { id: string; enabled: boolean; sentCount: number; config: CareConfig; counts: { due: number; at_risk: number; lapsed: number } }) {
  const [on, setOn] = useState(p.enabled);
  const [editing, setEditing] = useState(false);
  const [cfg, setCfg] = useState(p.config);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof CareConfig>(k: K, v: CareConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const num = (k: keyof CareConfig) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  const toggle = () => start(async () => {
    const next = !on; setOn(next); setError("");
    const r = await setAutomationEnabled(p.id, next);
    if (!r.ok) { setOn(!next); setError(r.error); }
  });
  const save = () => start(async () => {
    setError("");
    const r = await updateCustomerCare(p.id, cfg);
    if (!r.ok) return setError(r.error);
    setEditing(false);
  });
  const total = p.counts.due + p.counts.at_risk + p.counts.lapsed;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 md:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-accent/10 text-accent"><HeartHandshake size={16} /></span>
          <div>
            <div className="text-sm font-medium">Keep in touch with customers</div>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              The AI learns how often each customer buys or books. When someone is about due, drifting away, or has gone quiet, it sends a short, friendly message from your WhatsApp number to bring them back — written in your agent&apos;s voice using what they usually get.
            </p>
          </div>
        </div>
        <button onClick={toggle} disabled={pending} role="switch" aria-checked={on} aria-label="Toggle keep in touch"
          className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-border")}>
          <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <Link href="/dashboard/customers?seg=due"><Badge tone="amber">{`${p.counts.due} due to return`}</Badge></Link>
        <Link href="/dashboard/customers?seg=at_risk"><Badge tone="amber">{`${p.counts.at_risk} at risk`}</Badge></Link>
        <Link href="/dashboard/customers?seg=lapsed"><Badge tone="red">{`${p.counts.lapsed} lapsed`}</Badge></Link>
        <span className="py-0.5 text-muted">{total ? "Customers the AI will reach out to, within your limits." : "Nobody needs a nudge right now."} · {p.sentCount.toLocaleString("en-NG")} sent so far</span>
      </div>

      {editing ? (
        <div className="mt-4 space-y-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.aiPersonalize} onChange={(e) => set("aiPersonalize", e.target.checked)} />Let the AI write each message (uses 1 AI message each). Otherwise the template below is used.</label>
          <label className="block"><span className="mb-1 block text-xs text-muted">Fallback / template message — placeholders: {"{name} {business} {item} {days}"}</span>
            <textarea rows={3} maxLength={600} className={inputCls} value={cfg.template} onChange={(e) => set("template", e.target.value)} /></label>
          <div className="mt-2"><WriteWithAi kind="field" current={cfg.template} onApply={(t) => set("template", t)} context={{ fieldType: "textarea", fieldKey: "careTemplate", fieldLabel: "Keep in touch message", purpose: "A warm, short (1 to 3 sentences) WhatsApp message inviting a past customer who has not visited in a while to come back or reorder. No discounts or offers unless the owner states them. No pressure.", maxChars: "400", placeholders: "name,business,item,days" }} /></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="mb-1 block text-xs text-muted">Assume a visit every … days (new customers)</span><input type="number" min={7} max={180} className={inputCls} value={cfg.defaultCycleDays} onChange={num("defaultCycleDays")} /></label>
            <label className="block"><span className="mb-1 block text-xs text-muted">Max messages per quiet spell</span><input type="number" min={1} max={5} className={inputCls} value={cfg.maxNudges} onChange={num("maxNudges")} /></label>
            <label className="block"><span className="mb-1 block text-xs text-muted">Max messages per day</span><input type="number" min={1} max={200} className={inputCls} value={cfg.dailyCap} onChange={num("dailyCap")} /></label>
            <div className="block"><span className="mb-1 block text-xs text-muted">Send between (hour, 24h)</span>
              <div className="flex items-center gap-2"><input type="number" min={0} max={23} className={inputCls} value={cfg.sendFromHour} onChange={num("sendFromHour")} /><span>–</span><input type="number" min={1} max={24} className={inputCls} value={cfg.sendToHour} onChange={num("sendToHour")} /></div></div>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={save} disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" />}Save</button>
            <button className={btn} onClick={() => { setEditing(false); setCfg(p.config); setError(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Up to {cfg.maxNudges} messages per quiet spell · max {cfg.dailyCap}/day · {String(cfg.sendFromHour).padStart(2, "0")}:00–{String(cfg.sendToHour).padStart(2, "0")}:00 · {cfg.aiPersonalize ? "AI-written" : "template"}</span>
          <button className={btn} onClick={() => setEditing(true)}>Customise</button>
        </div>
      )}
      {error && !editing && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
