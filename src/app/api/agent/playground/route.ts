import { z } from "zod";
import { run } from "@/server/db";
import { withTenant } from "@/modules/tenancy/context";
import { runAgent, aiConfigured } from "@/modules/ai/engine";
import { rateLimit } from "@/server/rate-limit";
import { logger } from "@/server/logger";

export const maxDuration = 60; // seconds: AI calls can be slow on Vercel

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) })).min(1).max(40),
});

/** Dashboard playground: one agent turn against the real prompt/knowledge/read tools; write tools are simulated (dryRun). */
export const POST = withTenant("STAFF", async (ctx, req) => {
  if (!aiConfigured()) return Response.json({ error: "AI is not configured. Add OPENAI_API_KEY to .env and restart the server." }, { status: 503 });
  if (!(await rateLimit(`playground:${ctx.userId}`, 20, 60))) return Response.json({ error: "Too many test messages. Please wait a minute." }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });
  const history = parsed.data.messages;
  if (history[history.length - 1].role !== "user") return Response.json({ error: "Last message must be from the customer" }, { status: 400 });

  // The engine expects an agent row; older workspaces may not have one.
  await run(ctx.db.from("AiAgent").upsert({}, { onConflict: "organizationId", ignoreDuplicates: true }));

  try {
    const r = await runAgent({ organizationId: ctx.organizationId, customerId: null, conversationId: null, history, dryRun: true });
    return { reply: r.reply, tools: r.tools, escalated: r.escalated, model: r.model, tokens: r.tokens };
  } catch (e) {
    logger.error(e, "playground run failed");
    const msg = e instanceof Error && /api key|401|incorrect/i.test(e.message) ? "OpenAI rejected the API key. Check OPENAI_API_KEY." : "The AI could not reply right now. Please try again.";
    return Response.json({ error: msg }, { status: 502 });
  }
});
