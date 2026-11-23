import { z } from "zod";
import { withTenant } from "@/modules/tenancy/context";
import { aiConfigured } from "@/modules/ai/engine";
import { writeInstructions, writeDescription, writeField } from "@/modules/agent/writer";
import { rateLimit } from "@/server/rate-limit";
import { logger } from "@/server/logger";

export const maxDuration = 60; // seconds: AI calls can be slow on Vercel

const Body = z.object({
  brief: z.string().trim().max(3000).default(""),
  answers: z.array(z.object({ question: z.string().max(300), answer: z.string().trim().min(1).max(1000) })).max(5).default([]),
  forceWrite: z.boolean().default(false),
  kind: z.enum(["instructions", "description", "field"]).default("instructions"),
  context: z.record(z.string().max(20000)).default({}),
});

/** "Write with AI": drafts the agent's instructions in the house pattern; may first ask the owner a few questions. */
export const POST = withTenant("ADMIN", async (ctx, req) => {
  if (!aiConfigured()) return Response.json({ error: "AI is not configured. Add OPENAI_API_KEY to .env and restart the server." }, { status: 503 });
  if (!(await rateLimit(`agent-write:${ctx.organizationId}`, 40, 3600))) return Response.json({ error: "You've used Write with AI a lot this hour. Try again later." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check your answers and try again." }, { status: 400 });
  try {
    const { kind, context, ...rest } = parsed.data;
    if (kind === "field") return await writeField({ organizationId: ctx.organizationId, ...rest, context });
    return kind === "description"
      ? await writeDescription({ organizationId: ctx.organizationId, ...rest, context })
      : await writeInstructions({ organizationId: ctx.organizationId, ...rest });
  } catch (e) {
    logger.error({ err: (e as Error).message }, "write-with-ai failed");
    return Response.json({ error: (e as Error).message || "Couldn't write right now. Please try again." }, { status: 502 });
  }
});
