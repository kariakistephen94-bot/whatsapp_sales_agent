"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge, btn, btnPrimary, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  addCustomerPreference, addCustomerTag, deleteCustomer, removeCustomerPreference, removeCustomerTag, setCustomerOptOut, updateCustomer,
} from "@/modules/customers/actions";

type Result = { ok: true } | { ok: false; error: string };
const fail = () => ({ ok: false as const, error: "Something went wrong. Please try again." });

/** Runs a server action in a transition, surfaces its error, refreshes server data on success. */
function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<Result>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn().catch(fail);
      if (!r.ok) { setError(r.error); return; }
      onOk?.();
      router.refresh();
    });
  };
  return { pending, error, run, setError };
}

const Err = ({ msg }: { msg: string | null }) => (msg ? <p className="mt-2 text-xs text-danger">{msg}</p> : null);

export function DetailsEditor({ customerId, name, email, notes }: { customerId: string; name: string | null; email: string | null; notes: string | null }) {
  const [editing, setEditing] = useState(false);
  const { pending, error, run } = useAction();

  if (!editing) {
    return (
      <div className="space-y-3 text-sm">
        <div><div className="text-xs text-muted">Name</div>{name || <span className="text-muted">—</span>}</div>
        <div><div className="text-xs text-muted">Email</div>{email || <span className="text-muted">—</span>}</div>
        <div><div className="text-xs text-muted">Notes</div><p className="whitespace-pre-wrap">{notes || <span className="text-muted">No notes yet.</span>}</p></div>
        <button className={btn} onClick={() => setEditing(true)}><Pencil size={13} />Edit details</button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      action={(fd) => run(
        () => updateCustomer(customerId, { name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? ""), notes: String(fd.get("notes") ?? "") }),
        () => setEditing(false),
      )}
    >
      <label className="block text-xs text-muted">Name<input name="name" defaultValue={name ?? ""} maxLength={120} className={cn(inputCls, "mt-1")} /></label>
      <label className="block text-xs text-muted">Email<input name="email" type="email" defaultValue={email ?? ""} maxLength={200} className={cn(inputCls, "mt-1")} /></label>
      <label className="block text-xs text-muted">Notes<textarea name="notes" defaultValue={notes ?? ""} rows={4} maxLength={2000} className={cn(inputCls, "mt-1")} /></label>
      <Err msg={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={cn(btnPrimary, "disabled:opacity-50")}>{pending && <Loader2 size={13} className="animate-spin" />}Save</button>
        <button type="button" className={btn} onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function TagEditor({ customerId, tags, suggestions }: { customerId: string; tags: { id: string; name: string }[]; suggestions: string[] }) {
  const [value, setValue] = useState("");
  const { pending, error, run } = useAction();
  const add = (name: string) => { if (name.trim()) run(() => addCustomerTag(customerId, name), () => setValue("")); };
  const listId = `tags-${customerId}`;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-border/60 py-0.5 pl-2 pr-1 text-[11px] font-medium text-muted">
            {t.name}
            <button disabled={pending} onClick={() => run(() => removeCustomerTag(customerId, t.id))} className="rounded-full p-0.5 hover:bg-border hover:text-fg" aria-label={`Remove tag ${t.name}`}><X size={10} /></button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs text-muted">No tags yet.</span>}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(value); }}>
        <input value={value} onChange={(e) => setValue(e.target.value)} list={listId} maxLength={40} placeholder="Add a tag" className={cn(inputCls, "py-1.5")} />
        <datalist id={listId}>{suggestions.filter((s) => !tags.some((t) => t.name === s)).map((s) => <option key={s} value={s} />)}</datalist>
        <button type="submit" disabled={pending || !value.trim()} className={btn}>{pending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}</button>
      </form>
      <Err msg={error} />
    </div>
  );
}

export function PreferencesEditor({ customerId, preferences }: { customerId: string; preferences: string[] }) {
  const [value, setValue] = useState("");
  const { pending, error, run } = useAction();
  return (
    <div>
      {preferences.length ? (
        <ul className="space-y-1.5 text-sm">
          {preferences.map((p, i) => (
            <li key={`${i}-${p}`} className="group flex items-start justify-between gap-2">
              <span className="break-words">{p}</span>
              <button disabled={pending} onClick={() => run(() => removeCustomerPreference(customerId, i, p))} className="shrink-0 text-muted opacity-60 hover:text-danger group-hover:opacity-100" aria-label="Remove preference"><X size={13} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">No preferences recorded. The AI saves them as it learns.</p>}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) run(() => addCustomerPreference(customerId, value), () => setValue("")); }}>
        <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} placeholder="e.g. Prefers evening appointments" className={cn(inputCls, "py-1.5")} />
        <button type="submit" disabled={pending || !value.trim()} className={btn}>{pending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}</button>
      </form>
      <Err msg={error} />
    </div>
  );
}

export function PrivacyControls({ customerId, optedOut, canDelete, customerName }: { customerId: string; optedOut: boolean; canDelete: boolean; customerName: string }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const doDelete = () => startDelete(async () => {
    setDeleteError(null);
    const r = await deleteCustomer(customerId).catch(fail);
    if (!r.ok) { setDeleteError(r.error); return; }
    router.replace("/dashboard/customers");
    router.refresh();
  });

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div>Marketing & automated messages</div>
          <div className="text-xs text-muted">{optedOut ? "Opted out — no broadcasts, follow-ups or reminders." : "Can receive follow-ups, reminders and broadcasts."}</div>
        </div>
        <button
          role="switch"
          aria-checked={!optedOut}
          aria-label="Allow marketing and automated messages"
          disabled={pending}
          onClick={() => run(() => setCustomerOptOut(customerId, !optedOut))}
          className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50", optedOut ? "bg-border" : "bg-success")}
        >
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", optedOut ? "left-0.5" : "left-[18px]")} />
        </button>
      </div>
      <div className="flex items-center gap-2"><Badge tone={optedOut ? "gray" : "green"}>{optedOut ? "Opted out" : "Opted in"}</Badge></div>
      <Err msg={error} />

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <a href={`/api/customers/${customerId}/export`} className={btn}><Download size={13} />Export data</a>
        {canDelete && !confirming && <button className={cn(btn, "text-danger")} onClick={() => setConfirming(true)}><Trash2 size={13} />Delete customer</button>}
      </div>
      {canDelete && confirming && (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs">This permanently deletes <strong>{customerName}</strong>, their conversations, orders and appointments. It can&apos;t be undone. Type <strong>DELETE</strong> to confirm.</p>
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={cn(inputCls, "mt-2 py-1.5")} placeholder="DELETE" />
          {deleteError && <p className="mt-2 text-xs text-danger">{deleteError}</p>}
          <div className="mt-2 flex gap-2">
            <button disabled={confirmText !== "DELETE" || deleting} onClick={doDelete} className="inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50">
              {deleting && <Loader2 size={13} className="animate-spin" />}Delete permanently
            </button>
            <button className={btn} onClick={() => { setConfirming(false); setConfirmText(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
