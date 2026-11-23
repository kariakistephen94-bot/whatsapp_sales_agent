/** Where a customer stands, as computed by app_refresh_relationships (supabase/007). */
export type Relationship = "lead" | "cold_lead" | "active" | "due" | "at_risk" | "lapsed";

export const RELATIONSHIP_LABEL: Record<string, string> = {
  lead: "New lead", cold_lead: "Cold lead", active: "Active", due: "Due to return", at_risk: "At risk", lapsed: "Lapsed",
};
export const RELATIONSHIP_TONE: Record<string, "green" | "blue" | "amber" | "red" | "gray"> = {
  lead: "blue", cold_lead: "gray", active: "green", due: "amber", at_risk: "amber", lapsed: "red",
};

/** Relationship states the AI reaches out about, and the kind of message for each. */
export const NUDGE_STAGE = { due: "rebook", at_risk: "check_in", lapsed: "win_back" } as const;
/** Days to wait before the next nudge to the same customer, per stage. */
export const NUDGE_GAP_DAYS = { rebook: 5, check_in: 10, win_back: 21 } as const;

export type CareConfig = {
  template: string; aiPersonalize: boolean; defaultCycleDays: number; maxNudges: number; dailyCap: number; sendFromHour: number; sendToHour: number;
};
export const CARE_DEFAULTS: CareConfig = {
  template: "Hi {name}, it's been a while since your last visit to {business}. We'd love to see you again — would you like to book or order? Just reply here.",
  aiPersonalize: true, defaultCycleDays: 30, maxNudges: 3, dailyCap: 20, sendFromHour: 9, sendToHour: 19,
};
const clamp = (n: unknown, lo: number, hi: number, d: number) => { const x = Number(n); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
export function careConfig(raw: unknown): CareConfig {
  const c = (raw ?? {}) as Record<string, unknown>;
  const from = clamp(c.sendFromHour, 0, 23, CARE_DEFAULTS.sendFromHour);
  return {
    template: typeof c.template === "string" && c.template.trim() ? c.template : CARE_DEFAULTS.template,
    aiPersonalize: c.aiPersonalize !== false,
    defaultCycleDays: clamp(c.defaultCycleDays, 7, 180, CARE_DEFAULTS.defaultCycleDays),
    maxNudges: clamp(c.maxNudges, 1, 5, CARE_DEFAULTS.maxNudges),
    dailyCap: clamp(c.dailyCap, 1, 200, CARE_DEFAULTS.dailyCap),
    sendFromHour: from,
    sendToHour: Math.max(from + 1, clamp(c.sendToHour, 1, 24, CARE_DEFAULTS.sendToHour)),
  };
}

export type NudgeCheck = { relationship: string; optedOut: boolean; nudgeCount: number; nextNudgeAt: Date | null; lastInteractionAt: Date | null; lastNudgedAt: Date | null; consentAt: Date | null };
/** Pure: should this customer be offered a nudge right now? (Re-checked again when the job runs.) */
export function nudgeDecision(c: NudgeCheck, cfg: CareConfig, now = new Date()): { send: false; reason: string } | { send: true; stage: keyof typeof NUDGE_GAP_DAYS } {
  const stage = NUDGE_STAGE[c.relationship as keyof typeof NUDGE_STAGE];
  if (!stage) return { send: false, reason: "not_lapsing" };
  if (c.optedOut) return { send: false, reason: "opted_out" };
  if (!c.consentAt) return { send: false, reason: "never_contacted_us" }; // only people who messaged us on WhatsApp; storefront or manually added customers never consented
  if (c.nudgeCount >= cfg.maxNudges) return { send: false, reason: "max_nudges" };
  if (c.nextNudgeAt && c.nextNudgeAt > now) return { send: false, reason: "too_soon" };
  if (c.lastNudgedAt && now.getTime() - c.lastNudgedAt.getTime() < 3 * 864e5) return { send: false, reason: "too_soon" };
  if (c.lastInteractionAt && now.getTime() - c.lastInteractionAt.getTime() < 2 * 864e5) return { send: false, reason: "recently_chatting" };
  return { send: true, stage };
}
