"use client";
import { useState, useTransition } from "react";
import { btn, btnPrimary, inputCls } from "@/components/ui";
import { setWorkspaceStatus, setWorkspacePlan, extendWorkspace } from "@/modules/admin/actions";

export function WorkspaceActions({ orgId, status, plans, currentPlan }: { orgId: string; status: string; plans: { key: string; name: string }[]; currentPlan: string | null }) {
  const [plan, setPlan] = useState(currentPlan ?? plans[0]?.key ?? "");
  const [days, setDays] = useState(30);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => { setMsg(""); const r = await fn(); setMsg(r.ok ? done : (r as { error: string }).error); });
  const suspended = status === "SUSPENDED";
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending} className={suspended ? btnPrimary : btn} onClick={() => { if (suspended || confirm("Suspend this workspace? Its team loses access and the AI stops replying.")) go(() => setWorkspaceStatus(orgId, suspended ? "ACTIVE" : "SUSPENDED"), suspended ? "Reactivated" : "Suspended"); }}>
          {suspended ? "Reactivate workspace" : "Suspend workspace"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inputCls} w-auto`} value={plan} onChange={(e) => setPlan(e.target.value)}>{plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
        <span className="text-muted">for</span>
        <input type="number" min={1} max={3650} className={`${inputCls} w-24`} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        <span className="text-muted">days</span>
        <button disabled={pending} className={btn} onClick={() => go(() => setWorkspacePlan(orgId, plan, days), "Plan updated")}>Set plan (no payment)</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending} className={btn} onClick={() => go(() => extendWorkspace(orgId, days), `Extended by ${days} days`)}>Extend current period by {days} days</button>
      </div>
      {msg && <p className="text-xs text-muted" role="status">{msg}</p>}
    </div>
  );
}
