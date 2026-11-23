"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnPrimary } from "@/components/ui";
import { saveOffering } from "@/modules/settings/actions";

type State = { products: boolean; services: boolean; menu: boolean; inventory: boolean };

export function OfferingForm({ initial, canEdit }: { initial: State; canEdit: boolean }) {
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = (k: keyof State, v: boolean) => { setS((p) => ({ ...p, [k]: v })); setMsg(null); };

  const Row = ({ k, title, body, disabled }: { k: keyof State; title: string; body: string; disabled?: boolean }) => (
    <label className={`flex items-start gap-3 rounded-md border border-border p-3 ${disabled ? "opacity-50" : "cursor-pointer hover:bg-bg"}`}>
      <input type="checkbox" className="mt-1" checked={s[k]} disabled={!canEdit || disabled} onChange={(e) => set(k, e.target.checked)} />
      <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted">{body}</span></span>
    </label>
  );

  const save = () => start(async () => {
    const r = await saveOffering(s);
    if (r.ok) { setSaved(s); router.refresh(); setMsg({ ok: true, text: "Saved. Your menu, AI tools and automations have been updated." }); }
    else setMsg({ ok: false, text: r.error });
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Turn these on or off any time as your business grows. Nothing you've already added is deleted.</p>
      <Row k="products" title="Products" body="Physical goods customers can order. Orders, delivery and (optionally) stock." />
      <Row k="services" title="Services" body="Things you do for customers by appointment. Turns on bookings, availability and reminders." />
      <Row k="menu" title="Food & drink menu" body="Menu items customers can order." />
      <Row k="inventory" title="Track stock" body="The AI stops selling items that are out of stock." disabled={!s.products && !s.menu} />
      {s.services && !saved.services && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">To take bookings, add your services under Products & Services, set your business hours in Settings, and add staff in Team if you have more than one person.</p>}
      {!s.services && saved.services && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">The AI will stop offering bookings. Existing appointments and services stay in your records.</p>}
      {canEdit && (
        <div className="flex items-center gap-3">
          <button className={btnPrimary} onClick={save} disabled={pending || !dirty}>{pending && <Loader2 size={14} className="animate-spin" />}Save</button>
          {msg && <span className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`} role="status">{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
