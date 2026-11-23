"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Search, UserPlus, X } from "lucide-react";
import { btn, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { searchCustomers } from "@/modules/orders/actions";

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Centered dialog on desktop, bottom sheet on mobile. */
export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn("relative flex max-h-[92vh] w-full flex-col rounded-t-xl border border-border bg-surface shadow-xl sm:rounded-xl", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-bg hover:text-fg" aria-label="Close"><X size={16} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** Right-side panel for record details. Full width on mobile. */
export function Drawer({ open, onClose, title, sub, children, footer }: {
  open: boolean; onClose: () => void; title: string; sub?: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  useEscape(open, onClose);
  return (
    <div className={cn("fixed inset-0 z-50", open ? "visible" : "invisible")} aria-hidden={!open}>
      <div onClick={onClose} className={cn("absolute inset-0 bg-black/40 transition-opacity", open ? "opacity-100" : "opacity-0")} />
      <aside className={cn("absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-surface shadow-xl transition-transform", open ? "translate-x-0" : "translate-x-full")} role="dialog" aria-label={title}>
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{title}</h2>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-bg hover:text-fg" aria-label="Close"><X size={16} /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{open && children}</div>
        {open && footer && <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && ref.current();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-border")}>
      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function ErrorNote({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="flex items-start gap-1.5 rounded-md bg-danger/10 px-3 py-2 text-xs text-danger"><AlertTriangle size={13} className="mt-px shrink-0" />{children}</p>;
}

export function InfoNote({ children, tone = "info" }: { children?: React.ReactNode; tone?: "info" | "success" | "warn" }) {
  if (!children) return null;
  return <p className={cn("rounded-md px-3 py-2 text-xs", tone === "success" ? "bg-success/10 text-success" : tone === "warn" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-sky-500/10 text-sky-700 dark:text-sky-400")}>{children}</p>;
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

export function EmptyState({ icon, title, sub, action }: { icon?: React.ReactNode; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {sub && <p className="mt-1 max-w-sm text-sm text-muted">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Runs a server action with pending + error state. */
export function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) => {
    setError(null);
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) onOk?.(r.data);
        else setError(r.error);
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  };
  return { pending, error, setError, run };
}

// ───────── Customer picker (search existing or create new) ─────────

export type CustomerChoice =
  | { mode: "existing"; id: string; name: string | null; phone: string }
  | { mode: "new"; name: string; phone: string };

export function CustomerPicker({ value, onChange }: { value: CustomerChoice | null; onChange: (v: CustomerChoice | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (value || creating || q.trim().length < 2) { setResults([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchCustomers(q.trim());
        if (!cancelled) setResults(r.ok ? r.data : []);
      } finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, value, creating]);

  if (value?.mode === "existing") {
    return (
      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
        <span><span className="font-medium">{value.name || "Unnamed customer"}</span> <span className="text-muted">· {value.phone}</span></span>
        <button type="button" onClick={() => { onChange(null); setQ(""); }} className="text-xs text-muted hover:text-fg">Change</button>
      </div>
    );
  }

  if (creating || value?.mode === "new") {
    const v = value?.mode === "new" ? value : { mode: "new" as const, name: "", phone: "" };
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <input autoFocus value={v.name} onChange={(e) => onChange({ ...v, name: e.target.value })} placeholder="Full name" className={inputCls} />
          <input value={v.phone} onChange={(e) => onChange({ ...v, phone: e.target.value })} placeholder="Phone e.g. 0803 123 4567" inputMode="tel" className={inputCls} />
        </div>
        <button type="button" onClick={() => { setCreating(false); onChange(null); }} className="text-xs text-muted hover:text-fg">Search existing customers instead</button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone" className={cn(inputCls, "pl-8")} />
      {(q.trim().length >= 2 || results.length > 0) && (
        <div className="mt-1 overflow-hidden rounded-md border border-border bg-surface text-sm">
          {loading && <div className="flex items-center gap-2 px-3 py-2 text-muted"><Spinner size={12} />Searching…</div>}
          {!loading && results.map((c) => (
            <button type="button" key={c.id} onClick={() => onChange({ mode: "existing", ...c })} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-bg">
              <span className="font-medium">{c.name || "Unnamed customer"}</span><span className="text-xs text-muted">{c.phone}</span>
            </button>
          ))}
          {!loading && results.length === 0 && <div className="px-3 py-2 text-muted">No matching customers.</div>}
        </div>
      )}
      <button type="button" onClick={() => { setCreating(true); onChange({ mode: "new", name: /\d/.test(q) ? "" : q, phone: /\d/.test(q) ? q : "" }); }} className={cn(btn, "mt-2 text-xs")}>
        <UserPlus size={13} />New customer
      </button>
    </div>
  );
}

export function customerPayload(c: CustomerChoice) {
  return c.mode === "existing" ? { id: c.id } : { name: c.name.trim(), phone: c.phone.trim() };
}

// ───────── Route-level states ─────────

export function PageSkeleton({ rows = 6, stats = 0 }: { rows?: number; stats?: number }) {
  return (
    <div className="animate-pulse">
      <div className="mb-6 h-6 w-48 rounded bg-border/60" />
      {stats > 0 && <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: stats }, (_, i) => <div key={i} className="h-20 rounded-lg bg-border/40" />)}</div>}
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="h-8 rounded bg-border/40" />)}
      </div>
    </div>
  );
}

export function RouteError({ title, reset }: { title: string; reset: () => void }) {
  return (
    <EmptyState icon={<AlertTriangle size={20} />} title={`Couldn't load ${title}`} sub="This is usually temporary. Check your connection and try again."
      action={<button onClick={reset} className={btn}>Try again</button>} />
  );
}
