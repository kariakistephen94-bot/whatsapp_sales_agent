import { DateTime } from "luxon";
import { run, type Customer, type TenantDb } from "@/server/db";
import { RELATIONSHIP_LABEL } from "./model";

/** What the business and the AI know about a customer's buying rhythm, as text for the system prompt. */
export async function relationshipBlock(t: TenantDb, c: Customer, tz: string): Promise<string> {
  if (!c.visitCount && !c.lastPurchaseAt) return "Purchase history: none yet.";
  const fmt = (d: Date) => DateTime.fromJSDate(d, { zone: tz }).toFormat("d LLL yyyy");
  const lines: string[] = [];
  const days = c.lastPurchaseAt ? Math.floor((Date.now() - c.lastPurchaseAt.getTime()) / 864e5) : null;
  lines.push(`Relationship: ${RELATIONSHIP_LABEL[c.relationship] ?? c.relationship}; ${c.visitCount} past visit/order${c.visitCount === 1 ? "" : "s"}${days != null ? `, last ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}` : ""}${c.avgGapDays ? `, usually every ~${c.avgGapDays} days` : ""}${c.expectedNextAt ? `, expected back around ${fmt(c.expectedNextAt)}` : ""}.`);
  const [orders, appts] = await Promise.all([
    run<{ items: { name: string; quantity: number }[] }[]>(t.from("Order").select("items:OrderItem(name, quantity)").eq("customerId", c.id).neq("status", "CANCELLED").order("createdAt", { ascending: false }).limit(3)),
    run<{ service: { name: string } }[]>(t.from("Appointment").select("service:CatalogItem(name)").eq("customerId", c.id).in("status", ["booked", "completed"]).lte("startsAt", new Date().toISOString()).order("startsAt", { ascending: false }).limit(3)),
  ]);
  const names = [...new Set([...orders.flatMap((o) => o.items.map((i) => i.name)), ...appts.map((a) => a.service.name)])].slice(0, 5);
  if (names.length) lines.push(`Usually gets: ${names.join(", ")}.`);
  if (c.lastNudgedAt && Date.now() - c.lastNudgedAt.getTime() < 10 * 864e5) {
    lines.push(`We recently reached out to them first (${fmt(c.lastNudgedAt)}) to invite them back. If they're replying to that, welcome them back warmly and help them rebook or reorder — don't repeat the invitation.`);
  }
  return lines.join("\n");
}
