"use client";
import { Plus, X } from "lucide-react";
import { DAYS, DAY_LABEL, type Day, type WeeklyHours, type Window, windowsProblem } from "@/modules/appointments/hours";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Weekly hours editor: any number of time windows per day (e.g. 09:00–12:00 and 14:00–18:00).
 * Controlled: pass value + onChange. Shape matches Organization.businessHours / StaffMember.workingHours.
 */
export function HoursEditor({ value, onChange }: { value: WeeklyHours; onChange: (v: WeeklyHours) => void }) {
  const setDay = (d: Day, ws: Window[]) => onChange({ ...value, [d]: ws });
  return (
    <div className="divide-y divide-border/60 rounded-md border border-border">
      {DAYS.map((d) => {
        const ws = value[d] ?? [];
        const err = windowsProblem(ws);
        const edit = (i: number, patch: Partial<Window>) => setDay(d, ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));
        const addWindow = () => {
          const last = ws[ws.length - 1];
          const start = last ? (last.end < "21:00" ? `${String(Number(last.end.slice(0, 2)) + 1).padStart(2, "0")}:${last.end.slice(3)}` : "21:00") : "09:00";
          const end = start < "20:00" ? `${String(Number(start.slice(0, 2)) + 3).padStart(2, "0")}:${start.slice(3)}` : "23:59";
          setDay(d, [...ws, { start, end }]);
        };
        return (
          <div key={d} className="flex flex-wrap items-start gap-3 px-3 py-2 text-sm">
            <label className="flex h-8 w-20 items-center gap-2">
              <input type="checkbox" checked={ws.length > 0} onChange={(e) => setDay(d, e.target.checked ? [{ start: "09:00", end: "18:00" }] : [])} />
              {DAY_LABEL[d]}
            </label>
            {ws.length ? (
              <div className="space-y-1.5">
                {ws.map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="time" aria-label={`${DAY_LABEL[d]} opens`} value={w.start} onChange={(e) => edit(i, { start: e.target.value })} className={cn(inputCls, "w-auto py-1")} />
                    <span className="text-muted">to</span>
                    <input type="time" aria-label={`${DAY_LABEL[d]} closes`} value={w.end} onChange={(e) => edit(i, { end: e.target.value })} className={cn(inputCls, "w-auto py-1")} />
                    {ws.length > 1 && <button type="button" aria-label="Remove this time window" onClick={() => setDay(d, ws.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded text-muted hover:text-danger"><X size={14} /></button>}
                    {i === ws.length - 1 && ws.length < 4 && <button type="button" onClick={addWindow} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-accent hover:bg-accent/10"><Plus size={12} />Add break-split</button>}
                  </div>
                ))}
                {err && <p className="text-xs text-danger">{err}</p>}
              </div>
            ) : <span className="flex h-8 items-center text-muted">Closed</span>}
          </div>
        );
      })}
    </div>
  );
}
