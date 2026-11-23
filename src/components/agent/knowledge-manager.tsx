"use client";
import { WriteWithAi } from "@/components/agent/write-with-ai";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge, Card, btn, btnPrimary, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { createKnowledge, deleteKnowledge, setKnowledgeVerified, updateKnowledge, type KnowledgeInput } from "@/modules/agent/actions";

export interface KnowledgeRow { id: string; type: string; title: string; content: string | null; url: string | null; verified: boolean; createdAt: string }

const TYPES = [
  { v: "faq", l: "FAQ" }, { v: "policy", l: "Policy" }, { v: "pricelist", l: "Price list" }, { v: "url", l: "Link" }, { v: "document", l: "Document text" },
] as const;
type KType = (typeof TYPES)[number]["v"];
const label = (t: string) => TYPES.find((x) => x.v === t)?.l ?? t;
const empty = { type: "faq" as KType, title: "", content: "", url: "", verified: true };

export function KnowledgeManager({ rows }: { rows: KnowledgeRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<KnowledgeInput & { type: KType }>(empty);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const open = (r?: KnowledgeRow) => {
    setError("");
    if (r) { setEditing(r.id); setForm({ type: r.type as KType, title: r.title, content: r.content ?? "", url: r.url ?? "", verified: r.verified }); }
    else { setEditing("new"); setForm(empty); }
  };
  const submit = () => start(async () => {
    const res = editing === "new" ? await createKnowledge(form) : await updateKnowledge(editing!, form);
    if (!res.ok) return setError(res.error);
    setEditing(null); router.refresh();
  });
  const remove = (id: string) => { if (confirm("Delete this knowledge entry? The agent will stop using it.")) start(async () => { await deleteKnowledge(id); router.refresh(); }); };
  const verify = (r: KnowledgeRow) => start(async () => { await setKnowledgeVerified(r.id, !r.verified); router.refresh(); });

  return (
    <div className="space-y-4">
      <Card title="Knowledge the agent can use" action={editing === null && <button className={btn} onClick={() => open()}><Plus size={14} />Add</button>}>
        <div className="mb-3 rounded-md bg-bg px-3 py-2 text-xs text-muted">
          Tip: add a <b className="text-fg">Policy</b> called “How to pay” with your bank name, account number and account name for transfers — the agent only shares payment details you add here.
        </div>

        {editing !== null && (
          <div className="mb-4 space-y-3 rounded-md border border-border p-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <label><span className="mb-1 block text-xs text-muted">Type</span>
                <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as KType })}>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></label>
              <label><span className="mb-1 block text-xs text-muted">Title</span>
                <input className={inputCls} value={form.title} maxLength={160} placeholder={form.type === "faq" ? "Do you deliver to Abuja?" : "Cancellation policy"} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            </div>
            {form.type === "url" && (
              <label className="block"><span className="mb-1 block text-xs text-muted">Link</span>
                <input className={inputCls} value={form.url} placeholder="https://" onChange={(e) => setForm({ ...form, url: e.target.value })} />
                <span className="mt-1 block text-[11px] text-muted">Links aren’t read automatically yet — paste the important text below so the agent can use it.</span></label>
            )}
            <label className="block"><span className="mb-1 block text-xs text-muted">{form.type === "faq" ? "Answer" : "Content"}</span>
              <textarea rows={6} maxLength={20000} className={inputCls} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></label>
            <div className="mt-2"><WriteWithAi kind="field" current={form.content ?? ""}
              onApply={(t) => { const m = t.match(/^Title:\s*(.+?)\s*\n+Content:\s*([\s\S]+)$/i); if (m) setForm((fm) => ({ ...fm, title: fm.title?.trim() ? fm.title : m[1], content: m[2] })); else setForm((fm) => ({ ...fm, content: t })); }}
              context={{ fieldKey: "knowledge", fieldLabel: "Knowledge entry", fieldType: "entry", maxChars: "3000", purpose: `A ${form.type} entry the AI assistant will quote to customers.`, related: `Type: ${form.type}; existing title: ${form.title?.trim() || "(none, write one)"}` }} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} />Verified — the agent may use this</label>
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={pending} onClick={submit}>{pending && <Loader2 size={14} className="animate-spin" />}{editing === "new" ? "Add entry" : "Save"}</button>
              <button className={btn} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No knowledge yet. Add FAQs, policies and price lists so the agent can answer accurately.</p>
        ) : (
          <ul className="divide-y divide-border/60 text-sm">
            {rows.map((r) => (
              <li key={r.id} className={cn("flex items-start justify-between gap-3 py-2.5", pending && "opacity-70")}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.title}</span><Badge tone="gray">{label(r.type)}</Badge>{!r.verified && <Badge tone="amber">Unverified</Badge>}</div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{r.content || r.url}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="rounded px-2 py-1 text-xs text-muted hover:bg-bg" onClick={() => verify(r)}>{r.verified ? "Unverify" : "Verify"}</button>
                  <button aria-label="Edit" className="rounded p-1.5 text-muted hover:bg-bg" onClick={() => open(r)}><Pencil size={14} /></button>
                  <button aria-label="Delete" className="rounded p-1.5 text-muted hover:bg-bg hover:text-danger" onClick={() => remove(r.id)}><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
