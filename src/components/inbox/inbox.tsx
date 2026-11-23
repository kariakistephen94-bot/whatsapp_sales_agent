"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, ArrowLeft, Bot, Check, CheckCheck, CheckCircle2, Clock, Info, Loader2, MessageSquare, RotateCcw, Search, Send, UserRound, X,
} from "lucide-react";
import { Avatar, Badge, btn, btnPrimary, inputCls } from "@/components/ui";
import { formatKobo } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { addConversationNote, setConversationStatus } from "@/modules/conversations/actions";
import { dayKey, dayLabel, fmtDateTime, fmtTime, listStamp, statusLabel } from "@/components/crm/format";
import { displayName, type ConvoListItem, type ThreadData, type ThreadMessage } from "./types";

type Filter = "all" | "open" | "escalated" | "resolved";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" }, { key: "open", label: "Open" }, { key: "escalated", label: "Escalated" }, { key: "resolved", label: "Resolved" },
];

interface Pending { tempId: string; conversationId: string; body: string; createdAt: number; status: "queued" | "failed"; error?: string }

/** Runs `fn` now and every `ms` while the tab is visible; pauses when hidden and catches up on return. */
function usePolling(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(() => ref.current(), ms); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => { if (document.hidden) stop(); else { ref.current(); start(); } };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
  }, [ms, enabled]);
}

async function postConversation(id: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/conversations/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? "Something went wrong. Please try again.");
  }
}

function preview(last: ConvoListItem["last"]) {
  if (!last) return "No messages yet";
  const prefix = last.sender === "ai" ? "AI: " : last.sender === "human" ? "You: " : "";
  const text = last.body?.trim() || (last.mediaType ? `[${last.mediaType}]` : "");
  return prefix + text;
}

export function Inbox({ initialItems, initialActiveId, timezone: tz, whatsapp, canManageSettings }: {
  initialItems: ConvoListItem[];
  initialActiveId: string | null;
  timezone: string;
  whatsapp: "connected" | "disconnected" | "none";
  canManageSettings: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [showInfo, setShowInfo] = useState(false);

  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const firstList = useRef(true);

  useEffect(() => { const t = setTimeout(() => setQDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  // ── list polling ──
  const listKey = `${filter}|${qDebounced}`;
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;
  const loadList = useCallback(async () => {
    const key = `${filter}|${qDebounced}`;
    try {
      const res = await fetch(`/api/conversations?filter=${filter}&q=${encodeURIComponent(qDebounced)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { items: ConvoListItem[] };
      if (listKeyRef.current === key) { setItems(j.items); setListError(false); }
    } catch { if (listKeyRef.current === key) setListError(true); }
    finally { if (listKeyRef.current === key) setListLoading(false); }
  }, [filter, qDebounced]);

  useEffect(() => {
    if (firstList.current) { firstList.current = false; return; } // server already rendered the first page
    setListLoading(true);
    void loadList();
  }, [loadList]);
  usePolling(() => void loadList(), 5000);

  // ── thread polling ──
  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (activeRef.current !== id) return;
      if (res.status === 404) { setThread(null); setThreadError("This conversation doesn't exist or was deleted."); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ThreadData;
      if (activeRef.current !== id) return;
      setThread(data);
      setThreadError(null);
      // Drop optimistic replies that the server now has (match on text, consume each server message once).
      setPending((ps) => {
        const used = new Set<string>();
        return ps.filter((p) => {
          if (p.conversationId !== id || p.status === "failed") return true;
          const hit = data.messages.find((m) => !used.has(m.id) && m.sender === "human" && m.body === p.body && Date.parse(m.createdAt) >= p.createdAt - 120_000);
          if (hit) { used.add(hit.id); return false; }
          return true;
        });
      });
    } catch {
      if (activeRef.current === id) setThreadError((e) => e ?? "Connection problem — retrying…");
    }
  }, []);

  useEffect(() => {
    setThread(null);
    setThreadError(null);
    setShowInfo(false);
    if (activeId) void loadThread(activeId);
  }, [activeId, loadThread]);
  usePolling(() => { if (activeRef.current) void loadThread(activeRef.current); }, 3000, Boolean(activeId));

  const select = (id: string | null) => {
    setActiveId(id);
    const url = id ? `${window.location.pathname}?c=${encodeURIComponent(id)}` : window.location.pathname;
    window.history.replaceState(window.history.state, "", url);
  };

  const patchList = (id: string, patch: Partial<ConvoListItem>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // Never render the previous conversation's data for a frame after switching.
  const current = thread && thread.conversation.id === activeId ? thread : null;
  const isEmptyInbox = items.length === 0 && filter === "all" && !qDebounced && !listLoading;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Conversations</h1>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className={cn("h-1.5 w-1.5 rounded-full", listError ? "bg-amber-500" : "bg-success")} />
          {listError ? "Reconnecting…" : "Live"}
        </span>
      </div>
      {whatsapp !== "connected" && !isEmptyInbox && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          <span>WhatsApp is {whatsapp === "none" ? "not connected" : "disconnected"} — new messages won&apos;t arrive and replies can&apos;t be sent.</span>
          {canManageSettings ? <Link href="/dashboard/settings" className="font-medium text-accent">Open Settings</Link> : <span className="text-muted">Ask an admin to reconnect.</span>}
        </div>
      )}

      <div className="relative grid h-[calc(100dvh-8rem)] min-h-[520px] overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-[300px_1fr_280px]">
        {/* list */}
        <div className={cn("min-h-0 flex-col border-border lg:flex lg:border-r", activeId ? "hidden" : "flex")}>
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className={cn(inputCls, "pl-8")} />
              {listLoading && <Loader2 size={14} className="absolute right-2.5 top-2.5 animate-spin text-muted" />}
            </div>
            <div className="flex gap-1 overflow-x-auto text-xs">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)} className={cn("shrink-0 rounded-full px-2.5 py-1", filter === f.key ? "bg-border font-medium" : "text-muted hover:text-fg")}>{f.label}</button>
              ))}
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {items.map((c) => {
              const unread = c.last?.sender === "customer" && c.status !== "resolved";
              const name = displayName(c.customer);
              return (
                <li key={c.id}>
                  <button onClick={() => select(c.id)} className={cn("flex w-full gap-3 border-b border-border/60 px-3 py-3 text-left hover:bg-bg/60", activeId === c.id && "bg-bg")}>
                    <Avatar name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className={cn("truncate", unread ? "font-semibold" : "font-medium")}>{name}</span>
                        <span className={cn("shrink-0 text-xs", unread ? "text-fg" : "text-muted")}>{listStamp(c.lastMessageAt, tz)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <span className={cn("truncate text-xs", unread ? "text-fg" : "text-muted")}>{preview(c.last)}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {c.status === "escalated" && <Badge tone="red">Escalated</Badge>}
                          {c.handler === "HUMAN" && c.status !== "escalated" && <Badge tone="blue">Human</Badge>}
                          {unread && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Awaiting reply" />}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
            {items.length === 0 && (
              isEmptyInbox ? (
                <li className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                  <MessageSquare size={20} className="text-muted" />
                  <p className="text-sm font-medium">No conversations yet</p>
                  {whatsapp === "connected"
                    ? <p className="text-xs text-muted">When customers message your WhatsApp number, chats appear here in real time.</p>
                    : canManageSettings
                      ? <p className="text-xs text-muted">Connect WhatsApp in <Link href="/dashboard/settings" className="text-accent">Settings</Link> to start receiving messages.</p>
                      : <p className="text-xs text-muted">Ask an admin to connect WhatsApp in Settings.</p>}
                </li>
              ) : !listLoading && <li className="p-6 text-center text-sm text-muted">No conversations match.</li>
            )}
          </ul>
        </div>

        {/* thread */}
        <div className={cn("min-h-0 flex-col lg:flex", activeId ? "flex" : "hidden")}>
          {!activeId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-bg text-center text-sm text-muted">
              <MessageSquare size={20} />
              {items.length ? "Select a conversation" : "Your chats will show up here"}
            </div>
          ) : (
            <Thread
              key={activeId}
              id={activeId}
              tz={tz}
              thread={current}
              error={threadError}
              pending={pending.filter((p) => p.conversationId === activeId)}
              onBack={() => select(null)}
              onInfo={() => setShowInfo(true)}
              reload={() => loadThread(activeId)}
              setThread={setThread}
              patchList={patchList}
              addPending={(p) => setPending((ps) => [...ps, p])}
              updatePending={(tempId, patch) => setPending((ps) => ps.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p)))}
              removePending={(tempId) => setPending((ps) => ps.filter((p) => p.tempId !== tempId))}
            />
          )}
        </div>

        {/* customer panel */}
        <aside className={cn("min-h-0 overflow-y-auto border-border bg-surface p-4 text-sm lg:static lg:block lg:border-l", showInfo ? "absolute inset-0 z-10 block" : "hidden")}>
          {showInfo && <button onClick={() => setShowInfo(false)} className="mb-2 flex items-center gap-1 text-xs text-muted lg:hidden"><X size={14} />Close</button>}
          {current && activeId ? <CustomerPanel key={activeId} thread={current} tz={tz} reload={() => loadThread(activeId)} /> : <div className="pt-10 text-center text-xs text-muted">{activeId ? "" : "Customer details appear here."}</div>}
        </aside>
      </div>
    </div>
  );
}

function Ticks({ status }: { status: string }) {
  if (status === "queued") return <Clock size={11} aria-label="Queued" />;
  if (status === "failed") return <AlertCircle size={11} className="text-red-300" aria-label="Failed" />;
  if (status === "read") return <CheckCheck size={12} className="text-sky-300" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck size={12} aria-label="Delivered" />;
  return <Check size={12} aria-label="Sent" />;
}

function Bubble({ m, tz }: { m: ThreadMessage & { error?: string }; tz: string }) {
  const [why, setWhy] = useState(false);
  if (m.sender === "system") return <div className="py-1 text-center text-xs text-muted">{m.body}</div>;
  const mine = m.sender !== "customer";
  const text = m.body?.trim() || (m.mediaType ? `[${m.mediaType}]` : "");
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[85%] rounded-lg px-3 py-2 text-sm sm:max-w-[75%]",
        m.sender === "customer" && "border border-border bg-surface",
        m.sender === "ai" && "bg-accent text-accent-fg",
        m.sender === "human" && "bg-fg text-bg",
      )}>
        {m.sender === "ai" && <div className="mb-0.5 flex items-center gap-1 text-[10px] opacity-80"><Bot size={10} />AI agent</div>}
        {m.sender === "human" && <div className="mb-0.5 flex items-center gap-1 text-[10px] opacity-70"><UserRound size={10} />Staff</div>}
        <p className="whitespace-pre-wrap break-words">{text}</p>
        {m.mediaUrl && <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="mt-1 block text-xs underline opacity-80">View attachment</a>}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
          {m.sender === "ai" && m.tools.length > 0 && (
            <button onClick={() => setWhy((w) => !w)} className="mr-auto underline-offset-2 hover:underline">{why ? "Hide" : "Why?"}</button>
          )}
          <span title={fmtDateTime(m.createdAt, tz)}>{fmtTime(m.createdAt, tz)}</span>
          {mine && <Ticks status={m.status} />}
        </div>
        {m.status === "failed" && m.error && <div className="mt-1 text-[11px] text-red-300">{m.error}</div>}
        {why && (
          <ul className="mt-2 space-y-1 rounded-md bg-black/15 p-2 text-[11px]">
            {m.tools.map((t, i) => <li key={i}><span className="font-mono font-medium">{t.name}</span><span className="block break-words opacity-80">{t.summary}</span></li>)}
          </ul>
        )}
      </div>
    </div>
  );
}

function Thread({ id, tz, thread, error, pending, onBack, onInfo, reload, setThread, patchList, addPending, updatePending, removePending }: {
  id: string; tz: string; thread: ThreadData | null; error: string | null; pending: Pending[];
  onBack: () => void; onInfo: () => void; reload: () => Promise<void>;
  setThread: React.Dispatch<React.SetStateAction<ThreadData | null>>;
  patchList: (id: string, patch: Partial<ConvoListItem>) => void;
  addPending: (p: Pending) => void; updatePending: (tempId: string, patch: Partial<Pending>) => void; removePending: (tempId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  const messages = useMemo(() => {
    const server = thread?.messages ?? [];
    const opt: (ThreadMessage & { error?: string })[] = pending.map((p) => ({
      id: p.tempId, direction: "out", sender: "human", body: p.body, mediaUrl: null, mediaType: null,
      status: p.status, createdAt: new Date(p.createdAt).toISOString(), tools: [], error: p.error,
    }));
    return [...server, ...opt];
  }, [thread, pending]);

  useEffect(() => {
    const el = scroller.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (!thread) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-3 lg:hidden"><button onClick={onBack} className="flex items-center gap-1 text-sm text-muted"><ArrowLeft size={16} />Back</button></div>
        <div className="flex flex-1 items-center justify-center bg-bg text-sm text-muted">
          {error ? <span className="flex items-center gap-2"><AlertCircle size={14} />{error}</span> : <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Loading conversation…</span>}
        </div>
      </div>
    );
  }

  const c = thread.conversation;
  const human = c.handler === "HUMAN";
  const name = displayName(thread.customer);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setActionError(null);
    try { await fn(); } catch (e) { setActionError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(null); }
  };

  const setHandler = (handler: "AI" | "HUMAN") => run(handler, async () => {
    await postConversation(id, { action: handler === "HUMAN" ? "takeover" : "resume_ai" });
    setThread((t) => (t && t.conversation.id === id ? { ...t, conversation: { ...t.conversation, handler } } : t));
    patchList(id, { handler });
    await reload();
  });

  const setStatus = (status: "open" | "resolved") => run(status, async () => {
    const r = await setConversationStatus(id, status);
    if (!r.ok) throw new Error(r.error);
    setThread((t) => (t && t.conversation.id === id ? { ...t, conversation: { ...t.conversation, status } } : t));
    patchList(id, { status });
  });

  const send = async (text: string, existingTempId?: string) => {
    const body = text.trim();
    if (!body || !human) return;
    const tempId = existingTempId ?? `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    if (existingTempId) updatePending(tempId, { status: "queued", error: undefined, createdAt: Date.now() });
    else addPending({ tempId, conversationId: id, body, createdAt: Date.now(), status: "queued" });
    nearBottom.current = true;
    setDraft("");
    try {
      await postConversation(id, { action: "send", text: body });
      void reload();
    } catch (e) {
      updatePending(tempId, { status: "failed", error: e instanceof Error ? e.message : "Not sent" });
    }
  };

  let lastDay = "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button onClick={onBack} className="-ml-1 rounded p-1 text-muted hover:text-fg lg:hidden" aria-label="Back to conversations"><ArrowLeft size={18} /></button>
          <Avatar name={name} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-muted">{thread.customer.phone}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden sm:inline-flex"><Badge tone={human ? "blue" : "green"}>{human ? "Human" : "AI active"}</Badge></span>
          {c.status === "escalated" && <span className="hidden sm:inline-flex"><Badge tone="red">Escalated</Badge></span>}
          {c.status === "resolved"
            ? <button disabled={!!busy} className={btn} onClick={() => setStatus("open")} title="Reopen"><RotateCcw size={14} /><span className="hidden sm:inline">Reopen</span></button>
            : <button disabled={!!busy} className={btn} onClick={() => setStatus("resolved")} title="Mark resolved"><CheckCircle2 size={14} /><span className="hidden sm:inline">Resolve</span></button>}
          {human
            ? <button disabled={!!busy} className={btn} onClick={() => setHandler("AI")}>{busy === "AI" ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}<span className="hidden sm:inline">Resume AI</span></button>
            : <button disabled={!!busy} className={cn(btnPrimary, "disabled:opacity-50")} onClick={() => setHandler("HUMAN")}>{busy === "HUMAN" ? <Loader2 size={14} className="animate-spin" /> : <UserRound size={14} />}<span className="hidden sm:inline">Take over</span></button>}
          <button onClick={onInfo} className="rounded p-1 text-muted hover:text-fg lg:hidden" aria-label="Customer details"><Info size={18} /></button>
        </div>
      </div>
      {actionError && <div className="flex items-center justify-between gap-2 border-b border-danger/20 bg-danger/5 px-4 py-2 text-xs text-danger">{actionError}<button onClick={() => setActionError(null)}><X size={12} /></button></div>}
      {error && <div className="border-b border-border bg-amber-500/5 px-4 py-1.5 text-center text-[11px] text-muted">{error}</div>}

      <div
        ref={scroller}
        onScroll={(e) => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-bg p-3 sm:p-4"
      >
        {thread.hasMore && <div className="pb-2 text-center text-[11px] text-muted">Showing the latest 200 messages</div>}
        {messages.length === 0 && <div className="pt-10 text-center text-xs text-muted">No messages in this conversation yet.</div>}
        {messages.map((m) => {
          const k = dayKey(m.createdAt, tz);
          const sep = k !== lastDay ? <div className="py-2 text-center text-[11px] text-muted">{dayLabel(m.createdAt, tz)}</div> : null;
          lastDay = k;
          const p = pending.find((x) => x.tempId === m.id);
          return (
            <div key={m.id}>
              {sep}
              <Bubble m={m} tz={tz} />
              {p?.status === "failed" && (
                <div className="mt-1 flex justify-end gap-3 text-[11px]">
                  <button className="text-accent" onClick={() => send(p.body, p.tempId)}>Retry</button>
                  <button className="text-muted" onClick={() => removePending(p.tempId)}>Discard</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3">
        {human ? (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
              rows={1}
              maxLength={4000}
              placeholder="Reply as staff…"
              className={cn(inputCls, "max-h-32 min-h-[38px] resize-none")}
            />
            <button type="submit" disabled={!draft.trim()} className={cn(btnPrimary, "h-[38px] disabled:opacity-50")} aria-label="Send"><Send size={14} /></button>
          </form>
        ) : (
          <p className="text-center text-xs text-muted">The AI agent is handling this chat. Take over to reply yourself — the AI pauses until you resume it.</p>
        )}
      </div>
    </div>
  );
}

function CustomerPanel({ thread, tz, reload }: { thread: ThreadData; tz: string; reload: () => Promise<void> }) {
  const cust = thread.customer;
  const name = displayName(cust);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!note.trim()) return;
    setSaving(true); setErr(null);
    const r = await addConversationNote(thread.conversation.id, note).catch(() => ({ ok: false as const, error: "Couldn't save the note" }));
    setSaving(false);
    if (!r.ok) { setErr(r.error); return; }
    setNote("");
    await reload();
  };

  return (
    <div>
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar name={name} size={48} />
        <div className="font-medium">{name}</div>
        <div className="text-xs text-muted">{cust.phone}</div>
        <div className="flex gap-1"><Badge>{statusLabel(cust.status)}</Badge>{cust.optedOut && <Badge tone="gray">Opted out</Badge>}</div>
      </div>
      <dl className="mt-5 space-y-3 text-xs">
        <div><dt className="text-muted">Lifetime value</dt><dd className="text-sm tabular-nums">{formatKobo(cust.lifetimeValueCents)}</dd></div>
        {cust.email && <div><dt className="text-muted">Email</dt><dd className="truncate text-sm">{cust.email}</dd></div>}
        <div>
          <dt className="text-muted">Preferences</dt>
          <dd className="text-sm">{cust.preferences.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4">{cust.preferences.slice(-6).map((p, i) => <li key={i}>{p}</li>)}</ul> : "—"}</dd>
        </div>
        <div><dt className="text-muted">Tags</dt><dd className="mt-1 flex flex-wrap gap-1">{cust.tags.length ? cust.tags.map((t) => <Badge key={t.id} tone="gray">{t.name}</Badge>) : <span className="text-sm">—</span>}</dd></div>
      </dl>
      <Link href={`/dashboard/customers/${cust.id}`} className="mt-4 block rounded-md border border-border py-1.5 text-center text-xs hover:bg-bg">View full profile</Link>

      <div className="mt-6">
        <div className="mb-1 text-xs font-medium">Internal notes</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} placeholder="Visible to your team only" className={inputCls} />
        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
        <button onClick={save} disabled={saving || !note.trim()} className={cn(btn, "mt-2 w-full justify-center")}>{saving && <Loader2 size={12} className="animate-spin" />}Add note</button>
        <ul className="mt-3 space-y-2">
          {thread.notes.map((n) => (
            <li key={n.id} className="rounded-md border border-border/60 bg-bg/50 p-2 text-xs">
              <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
              <div className="mt-1 text-muted">{n.authorName} · {fmtDateTime(n.createdAt, tz)}</div>
            </li>
          ))}
          {thread.notes.length === 0 && <li className="text-xs text-muted">No notes yet.</li>}
        </ul>
      </div>
    </div>
  );
}
