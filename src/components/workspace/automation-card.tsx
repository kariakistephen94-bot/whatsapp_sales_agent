"use client";
import { WriteWithAi } from "@/components/agent/write-with-ai";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { btn, btnPrimary, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { setAutomationEnabled, updateAutomation } from "@/modules/automations/actions";

const TRIGGER: Record<string, string> = {
  first_message: "Customer’s first message", appointment_reminder: "Before an appointment", after_appointment: "After an appointment",
  post_purchase: "Order confirmed", abandoned_enquiry: "Enquiry without a purchase",
};

function splitOffset(mins: number) {
  const abs = Math.abs(mins);
  return abs % 60 === 0 ? { value: abs / 60, unit: "hours" as const } : { value: abs, unit: "minutes" as const };
}
function describe(mins: number, trigger: string) {
  const { value, unit } = splitOffset(mins);
  const u = value === 1 ? unit.slice(0, -1) : unit;
  return trigger === "appointment_reminder" ? `${value} ${u} before` : trigger === "abandoned_enquiry" ? `after ${value} ${u} without a purchase` : `${value} ${u} after`;
}

export function AutomationCard(p: {
  id: string; name: string; trigger: string; automationKey: string; description: string; enabled: boolean; sentCount: number;
  template: string; offsetMinutes: number | null; placeholders: string[];
}) {
  const [on, setOn] = useState(p.enabled);
  const [editing, setEditing] = useState(false);
  const [tpl, setTpl] = useState(p.template);
  const init = p.offsetMinutes != null ? splitOffset(p.offsetMinutes) : null;
  const [val, setVal] = useState(init?.value ?? 0);
  const [unit, setUnit] = useState<"hours" | "minutes">(init?.unit ?? "hours");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const isWelcome = p.automationKey === "welcome";

  const toggle = () => start(async () => {
    const next = !on; setOn(next); setError("");
    const r = await setAutomationEnabled(p.id, next);
    if (!r.ok) { setOn(!next); setError(r.error); }
  });
  const save = () => start(async () => {
    setError("");
    const mins = p.offsetMinutes != null ? Math.round(val * (unit === "hours" ? 60 : 1)) * (p.trigger === "appointment_reminder" ? -1 : 1) : undefined;
    const r = await updateAutomation(p.id, { template: tpl, offsetMinutes: mins });
    if (!r.ok) return setError(r.error);
    setEditing(false);
  });

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{p.name}</div>
          <div className="mt-0.5 text-xs text-muted">Trigger · {TRIGGER[p.trigger] ?? p.trigger}{p.offsetMinutes != null && ` · ${describe(p.offsetMinutes, p.trigger)}`}</div>
        </div>
        <button onClick={toggle} disabled={pending} role="switch" aria-checked={on} aria-label={`Toggle ${p.name}`}
          className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-border")}>
          <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
      <p className="mt-3 text-sm text-muted">{p.description}</p>

      {editing ? (
        <div className="mt-3 space-y-3 text-sm">
          {p.offsetMinutes != null && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">{p.trigger === "abandoned_enquiry" ? "Wait" : "Send"}</span>
              <input type="number" min={1} className={cn(inputCls, "w-20 py-1")} value={val} onChange={(e) => setVal(Number(e.target.value))} />
              <select className={cn(inputCls, "w-auto py-1")} value={unit} onChange={(e) => setUnit(e.target.value as "hours" | "minutes")}><option value="hours">hours</option><option value="minutes">minutes</option></select>
              <span className="text-xs text-muted">{p.trigger === "appointment_reminder" ? "before the appointment" : p.trigger === "after_appointment" ? "after it ends" : "before following up"}</span>
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Message</span>
            <textarea rows={4} maxLength={1000} className={inputCls} value={tpl} onChange={(e) => setTpl(e.target.value)} /><div className="mt-2"><WriteWithAi kind="field" current={tpl} onApply={(t) => setTpl(t)} context={{ fieldType: "textarea", fieldKey: "automation", fieldLabel: p.name, purpose: `Write the WhatsApp message for the automation "${p.name}" (${p.description}). Friendly, short (1 to 3 sentences), no pressure, at most one emoji.`, maxChars: "400", placeholders: p.placeholders.join(",").replace(/[{}]/g, "") }} /></div>
          </label>
          {p.placeholders.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">Placeholders:
              {p.placeholders.map((x) => <button key={x} type="button" onClick={() => setTpl((t) => `${t}${t.endsWith(" ") || !t ? "" : " "}${x}`)} className="rounded bg-bg px-1.5 py-0.5 font-mono hover:text-fg">{x}</button>)}
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={save} disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" />}Save</button>
            <button className={btn} onClick={() => { setEditing(false); setTpl(p.template); setError(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {!isWelcome && p.template && <p className="mt-3 line-clamp-3 rounded-md bg-bg px-3 py-2 text-xs">{p.template}</p>}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted">
            <span>{p.sentCount.toLocaleString("en-NG")} message{p.sentCount === 1 ? "" : "s"} sent</span>
            {isWelcome ? <Link href="/dashboard/agent" className={btn}>Edit greeting</Link> : <button className={btn} onClick={() => setEditing(true)}>Customise</button>}
          </div>
        </>
      )}
    </div>
  );
}
