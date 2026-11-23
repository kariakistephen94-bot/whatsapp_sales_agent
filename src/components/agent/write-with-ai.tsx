"use client";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { btn, btnPrimary, inputCls } from "@/components/ui";
import { useBrand } from "@/components/brand/brand-context";
import { examplesFor, slotFor } from "@/modules/industries/prompt-examples";

type Question = { id: string; question: string; hint?: string };
type Result = { status: "questions"; questions: Question[] } | { status: "ready"; text: string; note?: string };
type Kind = "instructions" | "description" | "field";

/**
 * Prompt-style writer: the owner types what they want the way they would in ChatGPT ("give me 10 services a
 * skincare brand offers", "add 3 more", "make the prices cheaper") and the AI writes into the field.
 * Each new prompt works on what's already in the field. If it truly needs facts only the owner knows, it asks first.
 */
export function WriteWithAi({ current, onApply, kind = "instructions", context }: { current: string; onApply: (text: string) => void; kind?: Kind; context?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  const chat = kind === "field";
  const brand = useBrand();
  const example = examplesFor(brand, slotFor(kind, context));

  async function call(body: { answers?: { question: string; answer: string }[]; forceWrite?: boolean }) {
    setBusy(true); setError(""); setNote("");
    try {
      const res = await fetch("/api/agent/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief, kind, context: { ...(context ?? {}), current }, ...body }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't write right now. Please try again.");
      const r = json as Result;
      if (r.status === "questions") { setQuestions(r.questions); setAnswers({}); return; }
      setUndo(current);
      onApply(r.text);
      setQuestions([]); setBrief(""); setNote(r.note ?? ""); setDone(true);
      if (!chat) setOpen(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const answered = questions.map((q) => ({ question: q.question, answer: (answers[q.id] ?? "").trim() })).filter((a) => a.answer);
  const needsPrompt = kind === "field" || (kind === "instructions" && !current.trim());
  const canGo = !busy && (!needsPrompt || brief.trim().length > 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => setOpen((o) => !o)}><Sparkles size={14} className="text-accent" />Write with AI</button>
        {undo !== null && <button type="button" className="text-xs text-muted underline" onClick={() => { onApply(undo); setUndo(null); setNote(""); }}>Undo AI draft</button>}
      </div>
      {open && (
        <div className="space-y-3 rounded-lg border border-border bg-bg p-3 text-sm">
          {questions.length === 0 ? (
            <>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">
                  {done && chat ? "Want changes? Just say so, like in ChatGPT." : chat ? "Tell the AI what you want, the way you would in ChatGPT. You don't need to know the format." : kind === "description" ? "Optional: tell the AI anything it should include. Leave it empty and it will write from what it already knows, and ask you if it needs more." : "Describe what you want the assistant to do and any rules, or leave it empty to tidy your current instructions."}
                </span>
                <textarea rows={chat ? 2 : 4} maxLength={3000} className={inputCls} value={brief} onChange={(e) => setBrief(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canGo) { e.preventDefault(); void call({}); } }}
                  placeholder={done && chat ? "e.g. add 3 more · make the prices cheaper · remove the last one" : example} />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btnPrimary} disabled={!canGo} onClick={() => call({})}>{busy && <Loader2 size={14} className="animate-spin" />}{done && chat ? "Update" : "Generate"}</button>
                <button type="button" className={btn} onClick={() => setOpen(false)}>Close</button>
                {chat && <span className="text-[11px] text-muted">Ctrl or ⌘ + Enter to send</span>}
              </div>
              {note && <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{note}</p>}
              {done && chat && !note && <p className="text-xs text-muted">Done. It&apos;s in the box above, ready to edit.</p>}
            </>
          ) : (
            <>
              <p className="text-xs text-muted">A quick question so the AI doesn&apos;t have to guess. Answer what you can.</p>
              {questions.map((q) => (
                <label key={q.id} className="block">
                  <span className="mb-1 block font-medium">{q.question}</span>
                  <input className={inputCls} value={answers[q.id] ?? ""} maxLength={1000} placeholder={q.hint} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btnPrimary} disabled={busy || answered.length === 0} onClick={() => call({ answers: answered })}>{busy && <Loader2 size={14} className="animate-spin" />}Write it</button>
                <button type="button" className={btn} disabled={busy} onClick={() => call({ forceWrite: true })}>Skip and write anyway</button>
              </div>
            </>
          )}
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          {busy && <p className="text-xs text-muted">Writing… this can take up to a minute.</p>}
        </div>
      )}
    </div>
  );
}
