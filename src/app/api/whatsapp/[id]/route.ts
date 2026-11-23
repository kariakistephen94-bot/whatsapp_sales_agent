import { z } from "zod";
import { withTenant, HttpError } from "@/modules/tenancy/context";
import { controlQueue } from "@/server/queue";
import { maybe } from "@/server/db";

const body = z.object({ action: z.enum(["reconnect", "disconnect", "logout"]) });

/** Lifecycle actions. The id is verified against the caller's org via the scoped client (no cross-tenant access). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant("ADMIN", async (ctx) => {
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Invalid action");
    const conn = await maybe<{ id: string }>(ctx.db.from("WhatsappConnection").select("id").eq("id", id).maybeSingle());
    if (!conn) throw new HttpError(404, "Not found");

    const action = parsed.data.action === "reconnect" ? "start" : parsed.data.action === "disconnect" ? "stop" : "logout";
    await controlQueue().add(action, { connectionId: conn.id, action });
    return { ok: true };
  })(req);
}
