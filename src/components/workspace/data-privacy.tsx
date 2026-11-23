"use client";
import { useState, useTransition } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { btn, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { deleteWorkspace } from "@/modules/settings/actions";

export function DataPrivacy({ canExport, isOwner, orgName }: { canExport: boolean; isOwner: boolean; orgName: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const match = typed.trim() === orgName.trim();

  const remove = () => start(async () => {
    setError("");
    const r = await deleteWorkspace(typed);
    if (r && !r.ok) setError(r.error); // on success the action redirects to /login
  });

  return (
    <div className="text-sm">
      <div className="flex flex-wrap gap-2">
        {canExport && <a className={btn} href="/api/export"><Download size={14} />Export all data</a>}
        {isOwner && <button className={cn(btn, "text-danger")} onClick={() => setOpen(!open)}><Trash2 size={14} />Delete workspace</button>}
      </div>
      {canExport && <p className="mt-3 text-xs text-muted">The export is a JSON file with your customers, conversations, orders, appointments, catalog and settings. WhatsApp session keys are never included.</p>}
      <p className="mt-1 text-xs text-muted">Customers who reply STOP are excluded from automated messages automatically.</p>

      {isOwner && open && (
        <div className="mt-4 space-y-3 rounded-md border border-danger/40 bg-danger/5 p-4">
          <p className="font-medium text-danger">Delete this workspace permanently</p>
          <p className="text-xs text-muted">This deletes all customers, conversations, orders, appointments, catalog items, automations and team access for <b className="text-fg">{orgName}</b>, and disconnects WhatsApp. It cannot be undone — export your data first if you need it.</p>
          <label className="block"><span className="mb-1 block text-xs text-muted">Type <b className="text-fg">{orgName}</b> to confirm</span>
            <input className={inputCls} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button disabled={!match || pending} onClick={remove} className="inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {pending && <Loader2 size={14} className="animate-spin" />}Delete forever
            </button>
            <button className={btn} onClick={() => { setOpen(false); setTyped(""); setError(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
