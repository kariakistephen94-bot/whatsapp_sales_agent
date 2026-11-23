"use client";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { HoursEditor } from "@/components/hours-editor";
import { btnPrimary } from "@/components/ui";
import { describeHours, hoursProblem, type WeeklyHours } from "@/modules/appointments/hours";
import { cn } from "@/lib/utils";
import { updateBusinessHours } from "@/modules/settings/actions";

export function BusinessHoursForm({ initial, isDefault, canEdit }: { initial: WeeklyHours; isDefault: boolean; canEdit: boolean }) {
  const [h, setH] = useState<WeeklyHours>(initial);
  const [saved, setSaved] = useState(isDefault ? null : JSON.stringify(initial));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const invalid = !!hoursProblem(h);
  const dirty = JSON.stringify(h) !== saved;

  const save = () => start(async () => {
    const r = await updateBusinessHours(h);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setSaved(JSON.stringify(h)); setMsg({ ok: true, text: "Saved" });
  });

  if (!canEdit) return <p className="text-sm">{describeHours(initial)}</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Used for bookings, your storefront and what the AI agent tells customers.{isDefault && saved === null ? " These are default hours — save to confirm them." : ""}</p>
      <HoursEditor value={h} onChange={(v) => { setH(v); setMsg(null); }} />
      <div className="flex items-center gap-3">
        <button className={btnPrimary} onClick={save} disabled={pending || invalid || !dirty} style={{ opacity: pending || invalid || !dirty ? 0.6 : 1 }}>{pending && <Loader2 size={14} className="animate-spin" />}Save hours</button>
        {msg && <span className={cn("text-xs", msg.ok ? "text-success" : "text-danger")}>{msg.text}</span>}
      </div>
    </div>
  );
}
