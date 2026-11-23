import "server-only";
import { from, run, maybe, type Json, type TenantDb, type HandlerMode, type Message, type ConversationNote } from "@/server/db";
import type { ConvoFilter, ConvoListItem, ThreadData, ToolTraceView } from "./types";

export const LIST_LIMIT = 100;
const THREAD_LIMIT = 200;

/** Quote a value for a PostgREST `or=(...)` filter. */
const pgQuote = (v: string) => `"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
/** Prisma-style `contains`: LIKE wildcards in the input are matched literally. */
const containsPattern = (v: string) => pgQuote(`%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

/**
 * Builds a name/phone search filter as a PostgREST `or` expression over Customer columns, for use with
 * `.or(expr)` on Customer (or `.or(expr, { referencedTable: "customer" })` on an embedded customer).
 * "0803…" also matches stored "+234803…".
 */
export function customerSearchWhere(q: string): string | undefined {
  const s = q.trim();
  if (!s) return undefined;
  const digits = s.replace(/\D/g, "");
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  const or = [`name.ilike.${containsPattern(s)}`, `email.ilike.${containsPattern(s)}`];
  if (local.length >= 3) or.push(`phone.like.${containsPattern(local)}`);
  return or.join(",");
}

type ListRow = {
  id: string; status: string; handler: HandlerMode; lastMessageAt: Date;
  customer: { id: string; name: string | null; phone: string };
  messages: { body: string | null; sender: string; mediaType: string | null; createdAt: Date }[];
};

export async function listConversations(db: TenantDb, opts: { filter?: string; q?: string }): Promise<ConvoListItem[]> {
  const filter = (["open", "escalated", "resolved"].includes(opts.filter ?? "") ? opts.filter : "all") as ConvoFilter;
  const search = customerSearchWhere(opts.q ?? "");
  let query = db.from("Conversation")
    .select(`id, status, handler, lastMessageAt, customer:Customer${search ? "!inner" : ""}(id, name, phone), messages:Message(body, sender, mediaType, createdAt)`);
  if (filter !== "all") query = query.eq("status", filter);
  if (search) query = query.or(search, { referencedTable: "customer" });
  const rows = await run<ListRow[]>(
    query.order("lastMessageAt", { ascending: false }).limit(LIST_LIMIT)
      .order("createdAt", { ascending: false, referencedTable: "messages" }).limit(1, { referencedTable: "messages" }),
  );
  return rows.map((r) => ({
    id: r.id, status: r.status, handler: r.handler, lastMessageAt: r.lastMessageAt.toISOString(), customer: r.customer,
    last: r.messages[0] ? { ...r.messages[0], createdAt: r.messages[0].createdAt.toISOString() } : null,
  }));
}

function summarize(result: unknown): string {
  if (result == null) return "no result";
  if (typeof result === "string") return result.slice(0, 160);
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.ok === false) return `failed: ${String(r.error ?? r.reason ?? "unknown error").slice(0, 140)}`;
  }
  const s = JSON.stringify(result);
  return s.length > 160 ? s.slice(0, 157) + "…" : s;
}

function toolsFromMeta(meta: Json | null): ToolTraceView[] {
  const tools = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>).tools : null;
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return { name: String(o.name ?? "tool"), summary: summarize(o.result) };
  });
}

/** Full thread for one conversation, or null when it isn't in this organization. */
export async function getThread(db: TenantDb, id: string): Promise<ThreadData | null> {
  const convo = await maybe<{
    id: string; status: string; handler: HandlerMode; assignedToId: string | null; lastMessageAt: Date;
    customer: {
      id: string; name: string | null; phone: string; email: string | null; status: string; lifetimeValueCents: number; optedOut: boolean; preferences: Json | null;
      tags: { tag: { id: string; name: string } }[];
    };
  }>(db.from("Conversation").select(
    "id, status, handler, assignedToId, lastMessageAt, customer:Customer(id, name, phone, email, status, lifetimeValueCents, optedOut, preferences, tags:CustomerTag(tag:Tag(id, name)))",
  ).eq("id", id).maybeSingle());
  if (!convo) return null;

  // ConversationNote has no organizationId; it is safe to read because the conversation was scoped above.
  const [msgs, notes] = await Promise.all([
    run<Message[]>(db.from("Message").select("*").eq("conversationId", id).order("createdAt", { ascending: false }).limit(THREAD_LIMIT + 1)),
    run<ConversationNote[]>(from("ConversationNote").select("*").eq("conversationId", id).order("createdAt", { ascending: false }).limit(50)),
  ]);
  const authorIds = [...new Set(notes.map((n) => n.authorId))];
  const authors = authorIds.length ? await run<{ id: string; name: string | null; email: string }[]>(from("User").select("id, name, email").in("id", authorIds)) : [];
  const authorName = (id: string) => { const a = authors.find((x) => x.id === id); return a ? a.name || a.email : "Team member"; };

  const prefs = (convo.customer.preferences as { notes?: unknown } | null)?.notes;
  const hasMore = msgs.length > THREAD_LIMIT;
  return {
    conversation: { id: convo.id, status: convo.status, handler: convo.handler, assignedToId: convo.assignedToId, lastMessageAt: convo.lastMessageAt.toISOString() },
    customer: {
      id: convo.customer.id, name: convo.customer.name, phone: convo.customer.phone, email: convo.customer.email, status: convo.customer.status,
      lifetimeValueCents: convo.customer.lifetimeValueCents, optedOut: convo.customer.optedOut,
      preferences: Array.isArray(prefs) ? prefs.map(String) : [],
      tags: convo.customer.tags.map((t) => t.tag),
    },
    messages: msgs.slice(0, THREAD_LIMIT).reverse().map((m) => ({
      id: m.id, direction: m.direction, sender: m.sender, body: m.body, mediaUrl: m.mediaUrl, mediaType: m.mediaType,
      status: m.status, createdAt: m.createdAt.toISOString(), tools: m.sender === "ai" ? toolsFromMeta(m.meta) : [],
    })),
    notes: notes.map((n) => ({ id: n.id, body: n.body, authorName: authorName(n.authorId), createdAt: n.createdAt.toISOString() })),
    hasMore,
  };
}
