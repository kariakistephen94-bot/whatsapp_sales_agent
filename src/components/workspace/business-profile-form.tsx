"use client";
import { WriteWithAi } from "@/components/agent/write-with-ai";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { btnPrimary, inputCls } from "@/components/ui";
import { NG_CITIES } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { updateProfile, type ProfileInput } from "@/modules/settings/actions";

type Form = Required<{ [K in keyof ProfileInput]: string }>;

export function BusinessProfileForm({ initial, fixed, canEdit }: { initial: Form; fixed: { industry: string; timezone: string; currency: string }; canEdit: boolean }) {
  const [f, setF] = useState<Form>(initial);
  const [saved, setSaved] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const set = (k: keyof Form, v: string) => { setF((p) => ({ ...p, [k]: v })); setMsg(null); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await updateProfile(f);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      const next = { ...f, phone: r.data.phone ?? "" };
      setF(next); setSaved(next); setMsg({ ok: true, text: "Saved" });
    });
  };

  const input = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label><span className="mb-1 block text-xs text-muted">{label}</span><input className={inputCls} value={f[k]} disabled={!canEdit} onChange={(e) => set(k, e.target.value)} {...props} /></label>
  );

  return (
    <form onSubmit={submit}>
      <fieldset disabled={!canEdit || pending} className="grid gap-3 text-sm sm:grid-cols-2">
        {input("name", "Business name", { required: true, minLength: 2, maxLength: 80 })}
        <label><span className="mb-1 block text-xs text-muted">Industry</span><input className={cn(inputCls, "text-muted")} value={fixed.industry} disabled readOnly /></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs text-muted">Description</span>
          <textarea rows={3} maxLength={1000} className={inputCls} value={f.description} disabled={!canEdit} onChange={(e) => set("description", e.target.value)} placeholder="Tell customers (and your AI agent) what you do." /></label>
          {canEdit && <div className="sm:col-span-2 -mt-1"><WriteWithAi kind="description" current={f.description} onApply={(t) => set("description", t)} context={{ name: f.name, city: f.city, address: f.address, website: f.website }} /></div>}
        {input("email", "Email", { type: "email", maxLength: 200 })}
        {input("phone", "Phone", { type: "tel", maxLength: 30, placeholder: "0803 123 4567" })}
        {input("address", "Address", { maxLength: 300 })}
        <label><span className="mb-1 block text-xs text-muted">City</span>
          <input className={inputCls} list="ng-cities" value={f.city} disabled={!canEdit} maxLength={80} onChange={(e) => set("city", e.target.value)} />
          <datalist id="ng-cities">{NG_CITIES.map((c) => <option key={c} value={c} />)}</datalist></label>
        {input("website", "Website", { type: "url", maxLength: 300, placeholder: "https://" })}
        <label><span className="mb-1 block text-xs text-muted">Time zone</span><input className={cn(inputCls, "text-muted")} value={fixed.timezone} disabled readOnly /></label>
        <label><span className="mb-1 block text-xs text-muted">Currency</span><input className={cn(inputCls, "text-muted")} value={fixed.currency} disabled readOnly /></label>
      </fieldset>
      {canEdit ? (
        <div className="mt-4 flex items-center gap-3">
          <button className={btnPrimary} disabled={pending || !dirty} style={{ opacity: pending || !dirty ? 0.6 : 1 }}>{pending && <Loader2 size={14} className="animate-spin" />}Save profile</button>
          {msg && <span className={cn("text-xs", msg.ok ? "text-success" : "text-danger")}>{msg.text}</span>}
        </div>
      ) : <p className="mt-3 text-xs text-muted">Only owners and admins can edit the business profile.</p>}
    </form>
  );
}
