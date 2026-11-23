import { withTenant, HttpError } from "@/modules/tenancy/context";
import { maybe, run, type Customer } from "@/server/db";

export const dynamic = "force-dynamic";

/** Data-subject export: everything we hold about one customer, as a downloadable JSON file. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenant("STAFF", async (ctx) => {
    const db = ctx.db;
    const customer = await maybe<Customer & { tags: { tag: { name: string } }[] }>(
      db.from("Customer").select("*, tags:CustomerTag(tag:Tag(name))").eq("id", id).maybeSingle(),
    );
    if (!customer) throw new HttpError(404, "Not found");

    const [conversations, orders, appointments, followups] = await Promise.all([
      run<unknown[]>(
        db.from("Conversation")
          .select("id, status, handler, lastMessageAt, messages:Message(direction, sender, body, mediaType, mediaUrl, status, createdAt)")
          .eq("customerId", customer.id)
          .order("lastMessageAt", { ascending: false })
          .order("createdAt", { referencedTable: "messages", ascending: true }),
      ),
      run<unknown[]>(
        db.from("Order")
          .select(
            "number, status, paymentStatus, subtotalCents, discountCents, totalCents, currency, delivery, source, paymentMethod, paidAt, notes, createdAt, " +
            "items:OrderItem(name, quantity, unitCents, variant)",
          )
          .eq("customerId", customer.id)
          .order("createdAt", { ascending: false }),
      ),
      run<unknown[]>(
        db.from("Appointment")
          .select("startsAt, endsAt, status, source, notes, service:CatalogItem(name), staff:StaffMember(name)")
          .eq("customerId", customer.id)
          .order("startsAt", { ascending: false }),
      ),
      run<unknown[]>(db.from("Followup").select("dueAt, reason, message, status, sentAt").eq("customerId", customer.id)),
    ]);

    await run(db.from("AuditLog").insert({ actorId: ctx.userId, action: "customer.exported", entity: "customer", entityId: customer.id }));

    const { organizationId: _org, tags, assignedToId: _a, ...profile } = customer;
    const payload = {
      exportedAt: new Date().toISOString(),
      note: "Amounts are in kobo (1/100 Naira).",
      customer: { ...profile, tags: tags.map((t) => t.tag.name) },
      conversations, orders, appointments, followups,
    };
    const safe = (customer.name || customer.phone).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safe}-data.json"`,
        "Cache-Control": "no-store",
      },
    });
  })(req);
}
