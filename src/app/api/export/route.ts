import { from, maybe, run, type Organization } from "@/server/db";
import { withTenant } from "@/modules/tenancy/context";
import { rateLimit } from "@/server/rate-limit";

/**
 * Full workspace export (OWNER/ADMIN) as a JSON download. Secrets are excluded:
 * WhatsApp session credentials and pairing codes are never selected.
 */
export const GET = withTenant("ADMIN", async (ctx) => {
  if (!(await rateLimit(`export:${ctx.organizationId}`, 5, 3600))) return Response.json({ error: "Export limit reached. Try again in an hour." }, { status: 429 });
  const db = ctx.db, id = ctx.organizationId;

  // PostgREST caps a response at the project's max rows (1000 by default), so list tables are paged.
  type Page = PromiseLike<{ data: unknown; error: { message: string; code?: string; details?: string } | null }>;
  const all = async (page: (fromRow: number, toRow: number) => Page) => {
    const out: unknown[] = [];
    for (let i = 0; ; i += 1000) {
      const rows = await run<unknown[]>(page(i, i + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  };
  const list = (table: Parameters<typeof db.from>[0], cols = "*") => all((a, b) => db.from(table).select(cols).order("id", { ascending: true }).range(a, b));

  const [organization, agent, storefront, subscription, members, customers, tags, segments, items, staff, orders, appointments, conversations, knowledge, automations, followups, connections, usage] = await Promise.all([
    maybe<Organization>(from("Organization").select("*").eq("id", id).maybeSingle()),
    maybe(db.from("AiAgent").select("*").maybeSingle()),
    maybe(db.from("Storefront").select("*").maybeSingle()),
    maybe(db.from("Subscription").select("*, plan:Plan(key, name)").maybeSingle()),
    list("Membership", "role, user:User(email, name)"),
    list("Customer", "*, tags:CustomerTag(tag:Tag(name))"),
    list("Tag"),
    list("Segment"),
    list("CatalogItem"),
    list("StaffMember"),
    list("Order", "*, items:OrderItem(*)"),
    list("Appointment"),
    all((a, b) => db.from("Conversation")
      .select("*, messages:Message(direction, sender, body, mediaUrl, mediaType, status, createdAt), notes:ConversationNote(*)")
      .order("id", { ascending: true })
      .order("createdAt", { referencedTable: "messages", ascending: true })
      .range(a, b)),
    list("KnowledgeSource", "id, type, title, content, url, verified, createdAt"),
    list("Automation"),
    list("Followup"),
    list("WhatsappConnection", "id, provider, label, status, phoneNumber, lastSeenAt"),
    list("UsageCounter"),
  ]);

  await run(db.from("AuditLog").insert({ actorId: ctx.userId, action: "data.exported" }));

  const body = JSON.stringify({
    exportedAt: new Date().toISOString(), note: "Money amounts are in kobo (1 NGN = 100 kobo). Times are UTC.",
    organization, agent, storefront, subscription, members, customers, tags, segments, catalog: items, staff, orders, appointments,
    conversations, knowledge, automations, followups, whatsappConnections: connections, usage,
  }, null, 2);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${organization?.slug ?? "workspace"}-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
});
