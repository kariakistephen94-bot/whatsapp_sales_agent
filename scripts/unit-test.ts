import { createHmac } from "node:crypto";
import { nudgeDecision, careConfig, CARE_DEFAULTS } from "@/modules/relationships/model";
import { serviceStateOf } from "@/modules/billing/usage";
import { validSignature } from "@/modules/billing/paystack";
import { renderTemplate } from "@/modules/automations/render";

/** Pure-logic tests: no database, no network. */
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && info !== undefined ? `  → ${JSON.stringify(info)}` : ""}`); };
const now = new Date("2026-06-10T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 864e5);
const cfg = careConfig({});
const base = { relationship: "due", optedOut: false, nudgeCount: 0, nextNudgeAt: null, lastInteractionAt: ago(20), lastNudgedAt: null, consentAt: ago(60) };

// nudgeDecision
import { hoursProblem } from "@/modules/appointments/hours";
check("hours: split day (morning + afternoon) is valid", hoursProblem({ mon: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }] }) === null);
check("hours: overlapping windows are rejected", /overlap/i.test(hoursProblem({ tue: [{ start: "09:00", end: "13:00" }, { start: "12:00", end: "18:00" }] }) ?? ""));
check("hours: end before start is rejected", !!hoursProblem({ wed: [{ start: "18:00", end: "09:00" }] }));
check("hours: closed days are fine", hoursProblem({ sun: [] }) === null);
import { toInbound, toStatus, secretMatches } from "@/modules/whatsapp/gateway/webhook";
check("gateway: phone message becomes an inbound customer message", toInbound({ id: "X", from: "2348012345678@s.whatsapp.net", rawFrom: "2348012345678@s.whatsapp.net", text: "hi", pushName: "Ada", timestamp: 1700000000 })?.from === "+2348012345678");
check("gateway: group message is ignored", toInbound({ id: "X", from: "120363162609838112@g.us", rawFrom: "120363162609838112@g.us", text: "hi" }) === null);
check("gateway: participant (group sender) is ignored", toInbound({ id: "X", from: "2348012345678@s.whatsapp.net", rawFrom: "120363@g.us", participant: "2348012345678@s.whatsapp.net", text: "hi" }) === null);
check("gateway: channel/community-style id is ignored", toInbound({ id: "X", from: "120363162609838112@s.whatsapp.net", text: "hi" }) === null);
check("gateway: hidden-number @lid is kept and flagged", toInbound({ id: "X", from: "98765432109876@lid", rawFrom: "98765432109876@lid", text: "hi" })?.from === "lid:98765432109876");
check("gateway: voice note has no text but is kept as audio", toInbound({ id: "X", from: "2348012345678@s.whatsapp.net", type: "audioMessage" })?.mediaType === "audio");
check("gateway: empty message is ignored", toInbound({ id: "X", from: "2348012345678@s.whatsapp.net", type: "protocolMessage" }) === null);
check("gateway: receipt maps to a status update", toStatus({ event: "message_status", message_id: "M1", status: "read" })?.status === "read");
check("gateway: unknown status ignored", toStatus({ event: "message_status", message_id: "M1", status: "weird" }) === null);
check("gateway: secret compare is exact and needs 16+ chars", secretMatches("a".repeat(20), "a".repeat(20)) && !secretMatches("a".repeat(20), "b".repeat(20)) && !secretMatches("short", "short") && !secretMatches(null, "a".repeat(20)));
check("due customer gets a 'rebook' nudge", JSON.stringify(nudgeDecision(base, cfg, now)) === JSON.stringify({ send: true, stage: "rebook" }));
check("at_risk → check_in", (nudgeDecision({ ...base, relationship: "at_risk" }, cfg, now) as any).stage === "check_in");
check("lapsed → win_back", (nudgeDecision({ ...base, relationship: "lapsed" }, cfg, now) as any).stage === "win_back");
check("active customers are never nudged", !nudgeDecision({ ...base, relationship: "active" }, cfg, now).send);
check("leads are not nudged", !nudgeDecision({ ...base, relationship: "lead" }, cfg, now).send);
check("opted-out customers are never nudged", (nudgeDecision({ ...base, optedOut: true }, cfg, now) as any).reason === "opted_out");
check("stops after maxNudges", (nudgeDecision({ ...base, nudgeCount: 3 }, cfg, now) as any).reason === "max_nudges");
check("respects nextNudgeAt", (nudgeDecision({ ...base, nextNudgeAt: new Date(now.getTime() + 864e5) }, cfg, now) as any).reason === "too_soon");
check("min 3 days between nudges", (nudgeDecision({ ...base, lastNudgedAt: ago(1) }, cfg, now) as any).reason === "too_soon");
check("not while they're chatting with us (<2 days)", (nudgeDecision({ ...base, lastInteractionAt: ago(1) }, cfg, now) as any).reason === "recently_chatting");
check("never contacted us and no consent → skipped", (nudgeDecision({ ...base, consentAt: null, lastInteractionAt: null }, cfg, now) as any).reason === "never_contacted_us");
check("storefront-only customer (activity but no WhatsApp consent) is not nudged", (nudgeDecision({ ...base, consentAt: null }, cfg, now) as any).reason === "never_contacted_us");

// careConfig clamps
const c = careConfig({ maxNudges: 99, dailyCap: -5, sendFromHour: 30, sendToHour: 2, defaultCycleDays: "abc" });
check("careConfig clamps out-of-range values", c.maxNudges === 5 && c.dailyCap === 1 && c.sendFromHour === 23 && c.sendToHour > c.sendFromHour && c.defaultCycleDays === CARE_DEFAULTS.defaultCycleDays, c);
check("careConfig fills defaults", JSON.stringify(careConfig(null)) === JSON.stringify(CARE_DEFAULTS));

// subscription state
const plan = { key: "starter", name: "Starter" };
check("trial running → active", serviceStateOf({ status: "trialing", trialEndsAt: new Date(now.getTime() + 5 * 864e5), currentPeriodEnd: null, plan }, now).active);
check("trial ended → expired", serviceStateOf({ status: "trialing", trialEndsAt: ago(1), currentPeriodEnd: null, plan }, now).status === "expired");
check("paid & in period → active", serviceStateOf({ status: "active", trialEndsAt: null, currentPeriodEnd: new Date(now.getTime() + 864e5), plan }, now).status === "active");
check("paid, 1 day past end → grace (still active)", (() => { const s = serviceStateOf({ status: "active", trialEndsAt: null, currentPeriodEnd: ago(1), plan }, now); return s.status === "grace" && s.active; })());
check("paid, 5 days past end → expired", (() => { const s = serviceStateOf({ status: "active", trialEndsAt: null, currentPeriodEnd: ago(5), plan }, now); return s.status === "expired" && !s.active; })());
check("status 'expired' stays inactive", !serviceStateOf({ status: "expired", trialEndsAt: null, currentPeriodEnd: ago(9), plan }, now).active);
check("no subscription row → treated as active (legacy)", serviceStateOf(null, now).active);

// Paystack signature
const body = JSON.stringify({ event: "charge.success", data: { reference: "abc" } });
const sig = createHmac("sha512", "sk_test_x").update(body).digest("hex");
check("valid Paystack signature accepted", validSignature(body, sig, "sk_test_x"));
check("tampered body rejected", !validSignature(body + " ", sig, "sk_test_x"));
check("wrong key rejected", !validSignature(body, sig, "sk_test_y"));
check("missing signature rejected", !validSignature(body, null, "sk_test_x"));
check("garbage signature rejected", !validSignature(body, "zz", "sk_test_x"));

check("renderTemplate fills and blanks placeholders", renderTemplate("Hi {name} at {business}{x}", { name: "Ada", business: "Zed" }) === "Hi Ada at Zed");

// brand-specific example prompts: same kind of brand => same examples, different kinds => different
import { examplesFor, topicFor } from "@/modules/industries/prompt-examples";
const ex = (b: Parameters<typeof examplesFor>[0]) => examplesFor(b, "items");
check("two cosmetics brands get identical examples", ex({ name: "GraceFragnace", industryKey: "beauty" }) === ex({ name: "Glow Skin Lab", industryKey: "beauty" }));
check("a perfume brand filed under 'other' is still cosmetics", topicFor({ name: "Ada Perfumes", industryKey: "other", businessType: "perfumes and body sprays" }) === "cosmetics");
check("a solar company gets different examples from a cosmetics brand", ex({ name: "Helios Solar", industryKey: "other", businessType: "solar and battery backup" }) !== ex({ name: "GraceFragnace", industryKey: "beauty" }));
check("solar is recognised even under 'electronics'", topicFor({ name: "BrightPower", industryKey: "electronics", businessType: "solar inverters" }) === "solar");
check("unknown business types still get a tailored prompt", /dispatch riders/.test(ex({ name: "Zed", industryKey: "other", businessType: "dispatch riders" })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
