import { tenant, run } from "@/server/db";

const STOP = new Set("a an the is are am to of for in on at and or do does you your i me my we our it this that what how much can with be have has please hi hello".split(" "));
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9₦\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));

/**
 * Lightweight retrieval: verified knowledge entries ranked by term overlap with the conversation.
 * Small businesses have small knowledge bases, so this is accurate enough and needs no embeddings.
 * (Swap for pgvector later without changing callers.)
 */
export async function retrieveKnowledge(organizationId: string, query: string, limit = 6) {
  const sources = await run<{ id: string; title: string; type: string; content: string | null }[]>(
    tenant(organizationId).from("KnowledgeSource").select("id, title, type, content")
      .eq("verified", true).not("content", "is", null)
      .order("createdAt", { ascending: false }).limit(300),
  );
  const q = new Set(tokens(query));
  const scored = sources.map((s) => {
    const t = tokens(`${s.title} ${s.title} ${s.content}`);
    const hits = t.filter((x) => q.has(x)).length;
    return { s, score: hits / Math.sqrt(t.length + 1) + (s.type === "policy" ? 0.05 : 0) };
  });
  const top = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  // Always include a couple of policies so the agent can answer "what's your cancellation policy".
  const policies = scored.filter((x) => x.s.type === "policy" && !top.includes(x)).slice(0, 2);
  return [...top, ...policies].map(({ s }) => ({ id: s.id, title: s.title, content: (s.content ?? "").slice(0, 1500) }));
}
