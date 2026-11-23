"use client";
import { useState, useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { switchWorkspace } from "@/modules/tenancy/workspace";

export interface WorkspaceOption { id: string; name: string; role: string }

/** Name of the current workspace; becomes a dropdown when the user belongs to more than one. */
export function WorkspaceSwitcher({ current, workspaces }: { current: string; workspaces: WorkspaceOption[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const me = workspaces.find((w) => w.id === current);
  if (workspaces.length < 2) return <div className="truncate px-2 py-3 text-sm font-semibold tracking-tight">{me?.name}</div>;

  const pick = (id: string) => {
    if (id === current) return setOpen(false);
    setError("");
    start(async () => { const r = await switchWorkspace(id); if (r && !r.ok) setError(r.error); });
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} disabled={pending}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2.5 text-left text-sm font-semibold tracking-tight hover:bg-bg disabled:opacity-60">
        <span className="truncate">{me?.name}</span><ChevronsUpDown size={14} className="shrink-0 text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ul role="listbox" className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg">
            {workspaces.map((w) => (
              <li key={w.id}>
                <button role="option" aria-selected={w.id === current} onClick={() => pick(w.id)} className={cn("flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg", w.id === current && "text-accent")}>
                  <span className="min-w-0"><span className="block truncate">{w.name}</span><span className="block text-[11px] capitalize text-muted">{w.role.toLowerCase()}</span></span>
                  {w.id === current && <Check size={14} className="shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="px-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
