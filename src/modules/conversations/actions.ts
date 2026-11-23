"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { from, run, maybe, must } from "@/server/db";
import { action, UserError } from "@/modules/tenancy/context";

const id = z.string().min(1).max(64);

/** Internal staff note on a conversation (never sent to the customer). */
export async function addConversationNote(conversationId: string, body: string) {
  return action("STAFF", async (ctx) => {
    const input = z.object({ conversationId: id, body: z.string().trim().min(1, "Write a note first").max(2000) }).parse({ conversationId, body });
    const convo = await maybe<{ id: string }>(ctx.db.from("Conversation").select("id").eq("id", input.conversationId).maybeSingle());
    if (!convo) throw new UserError("Conversation not found");
    // ConversationNote has no organizationId; the conversation was verified against this org above.
    const note = await must<{ id: string }>(from("ConversationNote").insert({ conversationId: convo.id, authorId: ctx.userId, body: input.body }).select("id").single());
    revalidatePath("/dashboard/conversations");
    return { id: note.id };
  });
}

/** Mark a conversation resolved, or reopen it. */
export async function setConversationStatus(conversationId: string, status: "open" | "resolved") {
  return action("STAFF", async (ctx) => {
    const input = z.object({ conversationId: id, status: z.enum(["open", "resolved"]) }).parse({ conversationId, status });
    const res = await run<{ id: string }[]>(ctx.db.from("Conversation").update({ status: input.status }).eq("id", input.conversationId).select("id"));
    if (res.length === 0) throw new UserError("Conversation not found");
    await run(ctx.db.from("AuditLog").insert({
      actorId: ctx.userId, action: `conversation.${input.status === "resolved" ? "resolved" : "reopened"}`, entity: "conversation", entityId: input.conversationId,
    }));
    revalidatePath("/dashboard/conversations");
    return { status: input.status };
  });
}
