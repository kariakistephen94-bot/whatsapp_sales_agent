import { withTenant } from "@/modules/tenancy/context";
import { listConversations } from "@/components/inbox/queries";

export const dynamic = "force-dynamic";

/** Inbox list for polling: ?filter=all|open|escalated|resolved&q=name-or-phone */
export async function GET(req: Request) {
  return withTenant("STAFF", async (ctx) => {
    const url = new URL(req.url);
    const items = await listConversations(ctx.db, { filter: url.searchParams.get("filter") ?? "all", q: (url.searchParams.get("q") ?? "").slice(0, 100) });
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  })(req);
}
