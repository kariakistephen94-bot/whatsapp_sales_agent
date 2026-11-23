import { getTenantContext } from "@/modules/tenancy/context";
import { from, run, must } from "@/server/db";
import { listConversations } from "@/components/inbox/queries";
import { Inbox } from "@/components/inbox/inbox";

export const dynamic = "force-dynamic";

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const ctx = await getTenantContext();
  const [org, connections, items] = await Promise.all([
    must<{ timezone: string }>(from("Organization").select("timezone").eq("id", ctx.organizationId).single()),
    run<{ status: string }[]>(ctx.db.from("WhatsappConnection").select("status")),
    listConversations(ctx.db, { filter: "all" }),
  ]);
  return (
    <Inbox
      initialItems={items}
      initialActiveId={typeof c === "string" && c ? c : null}
      timezone={org.timezone || "Africa/Lagos"}
      whatsapp={connections.some((x) => x.status === "connected") ? "connected" : connections.length ? "disconnected" : "none"}
      canManageSettings={ctx.role !== "STAFF"}
    />
  );
}
