"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run, maybe, must } from "@/server/db";
import { action, UserError } from "@/modules/tenancy/context";
import { toolsForCapabilities } from "@/modules/industries/templates";
import { LANGUAGES } from "@/lib/locale";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const AgentInput = z.object({
  name: z.string().trim().min(1).max(60),
  language: z.string().refine((v) => LANGUAGES.includes(v) || v === "en", "Unsupported language"),
  personality: z.string().trim().min(1).max(120),
  tone: z.string().trim().min(1).max(60),
  formality: z.enum(["casual", "neutral", "formal"]),
  responseLength: z.enum(["short", "medium", "long"]),
  greeting: opt(500),
  instructions: opt(16000),
  salesStrategy: opt(120),
  escalationNotes: opt(2000),
  active: z.boolean(),
  model: opt(80),
  enabledTools: z.array(z.string()).max(30),
});
export type AgentInput = z.input<typeof AgentInput>;

export async function saveAgent(input: AgentInput) {
  return action("ADMIN", async (ctx) => {
    const d = AgentInput.parse(input);
    const allowed = toolsForCapabilities(ctx.capabilities);
    const tools = Array.from(new Set([...d.enabledTools.filter((t) => (allowed as string[]).includes(t)), "escalate_to_human"]));
    const existing = await maybe<{ escalationRules: unknown }>(ctx.db.from("AiAgent").select("escalationRules").maybeSingle());
    const rules = { ...((existing?.escalationRules as Record<string, unknown> | null) ?? {}), notes: d.escalationNotes };
    const data = {
      name: d.name, language: d.language, personality: d.personality, tone: d.tone, formality: d.formality,
      responseLength: d.responseLength, greeting: d.greeting, instructions: d.instructions, salesStrategy: d.salesStrategy,
      escalationRules: rules, active: d.active, model: d.model, enabledTools: tools,
    };
    await run(ctx.db.from("AiAgent").upsert(data, { onConflict: "organizationId" }));
    await run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: "agent.updated", entity: "agent" }));
    revalidatePath("/dashboard/agent");
    return true;
  });
}

const KnowledgeInput = z.object({
  type: z.enum(["faq", "policy", "pricelist", "url", "document"]),
  title: z.string().trim().min(1).max(160),
  content: z.string().trim().max(20000).optional().default(""),
  url: z.string().trim().max(500).optional().default(""),
  verified: z.boolean().default(true),
}).superRefine((v, c) => {
  if (v.type === "url") {
    if (!/^https?:\/\/\S+$/i.test(v.url)) c.addIssue({ code: "custom", path: ["url"], message: "Enter a valid link" });
  } else if (!v.content) c.addIssue({ code: "custom", path: ["content"], message: "Content is required" });
});
export type KnowledgeInput = z.input<typeof KnowledgeInput>;

export async function createKnowledge(input: KnowledgeInput) {
  return action("ADMIN", async (ctx) => {
    const r = KnowledgeInput.safeParse(input);
    if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Please check the form");
    const d = r.data;
    const row = await must<{ id: string }>(ctx.db.from("KnowledgeSource").insert(
      { type: d.type, title: d.title, content: d.content || null, url: d.type === "url" ? d.url : null, verified: d.verified },
    ).select("id").single());
    revalidatePath("/dashboard/agent");
    return row.id;
  });
}

export async function updateKnowledge(id: string, input: KnowledgeInput) {
  return action("ADMIN", async (ctx) => {
    const r = KnowledgeInput.safeParse(input);
    if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Please check the form");
    const d = r.data;
    const res = await run<{ id: string }[]>(ctx.db.from("KnowledgeSource")
      .update({ type: d.type, title: d.title, content: d.content || null, url: d.type === "url" ? d.url : null, verified: d.verified })
      .eq("id", z.string().min(1).parse(id)).select("id"));
    if (!res.length) throw new UserError("Knowledge entry not found");
    revalidatePath("/dashboard/agent");
    return true;
  });
}

export async function setKnowledgeVerified(id: string, verified: boolean) {
  return action("ADMIN", async (ctx) => {
    await run(ctx.db.from("KnowledgeSource").update({ verified: z.boolean().parse(verified) }).eq("id", z.string().min(1).parse(id)));
    revalidatePath("/dashboard/agent");
    return true;
  });
}

export async function deleteKnowledge(id: string) {
  return action("ADMIN", async (ctx) => {
    await run(ctx.db.from("KnowledgeSource").delete().eq("id", z.string().min(1).parse(id)));
    revalidatePath("/dashboard/agent");
    return true;
  });
}
