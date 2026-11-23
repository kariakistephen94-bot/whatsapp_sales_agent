import { from, tenant, run, maybe } from "@/server/db";
import { notifyQueue } from "@/server/queue";
import { logger } from "@/server/logger";

const APP_URL = () => process.env.APP_URL ?? "http://localhost:3000";
const pretty = (p: string) => p.replace(/^\+234(\d{3})(\d{3})(\d{4})$/, "0$1 $2 $3");

/**
 * WhatsApp alert to every team member who has a number and hand-off alerts on, when a chat
 * needs a person (AI escalation, or the AI's monthly limit was reached).
 * At most one alert per conversation per member every 15 minutes.
 */
export async function notifyHandoff(input: { organizationId: string; conversationId: string; reason: string; lastMessage?: string | null }) {
  const t = tenant(input.organizationId);
  const [members, convo, org] = await Promise.all([
    run<{ id: string; phone: string | null }[]>(t.from("Membership").select("id, phone").eq("notifyHandoffs", true).not("phone", "is", null)),
    maybe<{ id: string; customer: { name: string | null; phone: string } }>(t.from("Conversation").select("id, customer:Customer(name, phone)").eq("id", input.conversationId).maybeSingle()),
    maybe<{ name: string }>(from("Organization").select("name").eq("id", input.organizationId).maybeSingle()),
  ]);
  if (!convo || !members.length) return { alerted: 0 };

  const who = convo.customer.name ? `${convo.customer.name} (${pretty(convo.customer.phone)})` : pretty(convo.customer.phone);
  const quote = input.lastMessage ? `\nThey said: "${input.lastMessage.slice(0, 200)}"` : "";
  const text = `🔔 ${org?.name ?? "Your business"}: a customer needs a person.\n\n${who}\nWhy: ${input.reason}${quote}\n\nReply to them here: ${APP_URL()}/dashboard/conversations?c=${convo.id}`;

  const bucket = Math.floor(Date.now() / (15 * 60_000));
  let alerted = 0;
  for (const m of members) {
    if (!m.phone) continue;
    const queued = await notifyQueue()
      .add("handoff", { organizationId: input.organizationId, to: m.phone, text, kind: "handoff" }, { jobId: `ho-${convo.id}-${m.id}-${bucket}`, attempts: 3 })
      .catch((e) => { logger.warn({ err: e }, "could not queue hand-off alert"); return null; });
    if (queued) alerted++;
  }
  return { alerted };
}
