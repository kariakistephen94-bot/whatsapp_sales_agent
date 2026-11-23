"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Loader2, RotateCcw, Send, Wrench } from "lucide-react";
import { Badge, Card, btnPrimary, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

type Trace = { name: string; args: unknown; result: unknown };
type Turn = { role: "user" | "assistant"; content: string; tools?: Trace[]; escalated?: { reason: string } | null; error?: boolean };

function TraceView({ tools }: { tools: Trace[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 rounded-md border border-border/70 bg-surface text-[11px]">
      <button className="flex w-full items-center gap-1 px-2 py-1 text-muted" onClick={() => setOpen(!open)}>
        <Wrench size={11} />{tools.length} tool call{tools.length === 1 ? "" : "s"}: {tools.map((t) => t.name).join(", ")}
        <ChevronDown size={11} className={cn("ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/70 p-2">
          {tools.map((t, i) => (
            <div key={i}>
              <code className="font-medium">{t.name}</code>
              <pre className="mt-0.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-1.5 text-muted">args: {JSON.stringify(t.args, null, 1)}</pre>
              <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-1.5 text-muted">result: {JSON.stringify(t.result, null, 1)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Playground({ aiReady, agentName, dirty }: { aiReady: boolean; agentName: string; dirty: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  async function ask() {
    const text = draft.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next); setDraft(""); setBusy(true);
    try {
      const history = next.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
      const r = await fetch("/api/agent/playground", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setTurns([...next, { role: "assistant", content: j.error ?? "Something went wrong.", error: true }]);
      else setTurns([...next, { role: "assistant", content: j.reply || "(empty reply)", tools: j.tools, escalated: j.escalated }]);
    } catch {
      setTurns([...next, { role: "assistant", content: "Network error. Please try again.", error: true }]);
    } finally { setBusy(false); }
  }

  return (
    <Card title="Playground" className="h-fit lg:sticky lg:top-4"
      action={<div className="flex items-center gap-2">{turns.length > 0 && <button aria-label="Reset chat" className="text-muted hover:text-fg" onClick={() => setTurns([])}><RotateCcw size={14} /></button>}<Badge tone="amber">Test mode</Badge></div>}>
      {!aiReady ? (
        <div className="flex h-[300px] flex-col items-center justify-center gap-2 text-center text-sm">
          <Bot size={22} className="text-muted" />
          <p className="font-medium">AI isn’t configured yet</p>
          <p className="max-w-xs text-xs text-muted">Add <code>OPENAI_API_KEY</code> to <code>.env</code> and restart the server to test your agent here.</p>
        </div>
      ) : (
        <div className="flex h-[480px] flex-col">
          <div className="flex-1 space-y-2 overflow-y-auto text-sm">
            {turns.length === 0 && (
              <p className="px-4 py-10 text-center text-xs text-muted">Chat as if you were a customer. The agent uses your real catalog, availability and verified knowledge. Orders and bookings are simulated — nothing is created.</p>
            )}
            {turns.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className="max-w-[88%]">
                  <div className={cn("whitespace-pre-wrap rounded-lg px-3 py-2", m.role === "user" ? "bg-accent text-accent-fg" : m.error ? "border border-danger/40 bg-danger/5 text-danger" : "border border-border bg-bg")}>
                    {m.role === "assistant" && !m.error && <div className="mb-0.5 flex items-center gap-1 text-[10px] text-muted"><Bot size={10} />{agentName}</div>}
                    {m.content}
                  </div>
                  {m.tools && m.tools.length > 0 && <TraceView tools={m.tools} />}
                  {m.escalated && <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">Would hand off to your team: {m.escalated.reason}</div>}
                </div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-1.5 text-xs text-muted"><Loader2 size={12} className="animate-spin" />{agentName} is typing…</div>}
            <div ref={end} />
          </div>
          <div className="mt-3 flex gap-2">
            <input className={inputCls} value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask as a customer…" />
            <button className={btnPrimary} onClick={ask} disabled={busy} aria-label="Send"><Send size={14} /></button>
          </div>
          {dirty && <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">You have unsaved changes — save to test them here.</p>}
        </div>
      )}
    </Card>
  );
}
