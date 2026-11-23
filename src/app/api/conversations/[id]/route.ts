import { z } from "zod";
import { withTenant, HttpError } from "@/modules/tenancy/context";
import { outboundQueue } from "@/server/queue";
import { getThread } from "@/components/inbox/queries";
import { run, maybe, type HandlerMode } from "@/server/db";

export const dynamic = "force-dynamic";

/** Thread for polling: conversation, customer, messages (oldest first) and internal notes. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant("STAFF", async (ctx) => {
    const thread = await getThread(ctx.db, id);
    if (!thread) throw new HttpError(404, "Not found");
    return Response.json(thread, { headers: { "Cache-Control": "no-store" } });
  })(req);
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("takeover") }),
  z.object({ action: z.literal("resume_ai") }),
  z.object({ action: z.literal("send"), text: z.string().min(1).max(4000) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant("STAFF", async (ctx) => {
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid input");
    const convo = await maybe<{ id: string; handler: HandlerMode }>(ctx.db.from("Conversation").select("id, handler").eq("id", id).maybeSingle());
    if (!convo) throw new HttpError(404, "Not found");
    const b = parsed.data;

    if (b.action === "takeover") {
      await run(ctx.db.from("Conversation").update({ handler: "HUMAN", assignedToId: ctx.userId }).eq("id", id));
      return { ok: true };
    }
    if (b.action === "resume_ai") {
      await run(ctx.db.from("Conversation").update({ handler: "AI", assignedToId: null }).eq("id", id));
      return { ok: true };
    }
    // send: only while a human holds the conversation, so AI and staff never talk over each other.
    if (convo.handler !== "HUMAN") throw new HttpError(409, "Take over the conversation before replying");
    await outboundQueue().add("send", { organizationId: ctx.organizationId, conversationId: id, sender: "human", text: b.text });
    return { ok: true };
  })(req);
}
