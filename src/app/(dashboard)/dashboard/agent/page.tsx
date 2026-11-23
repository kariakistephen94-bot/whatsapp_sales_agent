import { from, run, must, type AiAgent, type KnowledgeSource } from "@/server/db";
import { getTenantContext } from "@/modules/tenancy/context";
import { aiConfigured } from "@/modules/ai/engine";
import { TOOL_DEFS } from "@/modules/ai/tools";
import { toolsForCapabilities } from "@/modules/industries/templates";
import { AgentEditor } from "@/components/agent/agent-editor";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const ctx = await getTenantContext("ADMIN");
  const [agentRow, knowledge, org] = await Promise.all([
    run(ctx.db.from("AiAgent").upsert({}, { onConflict: "organizationId", ignoreDuplicates: true }))
      .then(() => must<AiAgent>(ctx.db.from("AiAgent").select("*").single())),
    run<Pick<KnowledgeSource, "id" | "type" | "title" | "content" | "url" | "verified" | "createdAt">[]>(
      ctx.db.from("KnowledgeSource").select("id, type, title, content, url, verified, createdAt").order("createdAt", { ascending: false }),
    ),
    must<{ name: string }>(from("Organization").select("name").eq("id", ctx.organizationId).single()),
  ]);
  const agent = { ...agentRow, enabledTools: agentRow.enabledTools ?? [] };
  const allowed = toolsForCapabilities(ctx.capabilities);
  const tools = allowed.map((t) => ({ key: t, description: TOOL_DEFS[t]?.type === "function" ? TOOL_DEFS[t].function.description ?? "" : "" }));
  const rules = (agent.escalationRules ?? {}) as Record<string, unknown>;

  return (
    <AgentEditor
      orgName={org.name}
      aiReady={aiConfigured()}
      tools={tools}
      knowledge={knowledge.map((k) => ({ ...k, createdAt: k.createdAt.toISOString() }))}
      initial={{
        name: agent.name, language: agent.language === "en" ? "English" : agent.language, personality: agent.personality, tone: agent.tone,
        formality: (["casual", "neutral", "formal"].includes(agent.formality) ? agent.formality : "neutral") as "casual" | "neutral" | "formal",
        responseLength: (["short", "medium", "long"].includes(agent.responseLength) ? agent.responseLength : "medium") as "short" | "medium" | "long",
        greeting: agent.greeting ?? "", instructions: agent.instructions ?? "", salesStrategy: agent.salesStrategy ?? "",
        escalationNotes: typeof rules.notes === "string" ? rules.notes : "", active: agent.active, model: agent.model ?? "",
        // Empty = engine default (all allowed tools on).
        enabledTools: agent.enabledTools.length ? agent.enabledTools.filter((t) => (allowed as string[]).includes(t)) : allowed,
      }}
    />
  );
}
