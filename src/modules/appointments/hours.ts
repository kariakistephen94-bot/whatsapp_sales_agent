import { DateTime } from "luxon";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export type Window = { start: string; end: string }; // "HH:mm" in org timezone
export type WeeklyHours = Partial<Record<Day, Window[]>>;

export const DEFAULT_HOURS: WeeklyHours = {
  mon: [{ start: "09:00", end: "18:00" }], tue: [{ start: "09:00", end: "18:00" }], wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }], fri: [{ start: "09:00", end: "18:00" }], sat: [{ start: "10:00", end: "16:00" }],
};

export const DAY_LABEL: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export function asHours(v: unknown): WeeklyHours | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: WeeklyHours = {};
  for (const d of DAYS) {
    const w = (v as any)[d];
    if (Array.isArray(w)) out[d] = w.filter((x) => /^\d{2}:\d{2}$/.test(x?.start) && /^\d{2}:\d{2}$/.test(x?.end) && x.start < x.end);
  }
  return Object.keys(out).length ? out : null;
}

/** Problem with one day's windows (bad range or overlap), or null. */
export function windowsProblem(ws: Window[] | undefined): string | null {
  if (!ws?.length) return null;
  if (ws.some((w) => !(w.start < w.end))) return "Each end time must be after its start";
  const s = [...ws].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < s.length; i++) if (s[i].start < s[i - 1].end) return "Time windows overlap";
  return null;
}
export const hoursProblem = (h: WeeklyHours | null | undefined): string | null => {
  for (const d of DAYS) { const e = windowsProblem(h?.[d]); if (e) return `${DAY_LABEL[d]}: ${e}`; }
  return null;
};

export const dayOf = (dt: DateTime): Day => DAYS[dt.weekday - 1];

/** "Mon–Fri 09:00–18:00, Sat 10:00–16:00" — for prompts and the storefront. */
export function describeHours(h: WeeklyHours | null): string {
  if (!h) return "not set";
  const parts: string[] = [];
  let i = 0;
  while (i < DAYS.length) {
    const key = JSON.stringify(h[DAYS[i]] ?? []);
    let j = i;
    while (j + 1 < DAYS.length && JSON.stringify(h[DAYS[j + 1]] ?? []) === key) j++;
    const w = h[DAYS[i]] ?? [];
    if (w.length) parts.push(`${DAY_LABEL[DAYS[i]]}${j > i ? `–${DAY_LABEL[DAYS[j]]}` : ""} ${w.map((x) => `${x.start}–${x.end}`).join(", ")}`);
    i = j + 1;
  }
  return parts.join("; ") || "closed every day";
}

/** Best-effort parse of free text like "Mon–Fri 9:00–18:00, Sat 10:00–16:00" typed during onboarding. */
export function parseHoursText(text: string): WeeklyHours | null {
  const out: WeeklyHours = {};
  const idx = (s: string) => DAYS.findIndex((d) => s.toLowerCase().startsWith(d));
  const pad = (t: string) => { const [h, m = "00"] = t.split(/[:.]/); return `${h.padStart(2, "0")}:${m.padEnd(2, "0").slice(0, 2)}`; };
  const to24 = (t: string, ap?: string) => {
    let [h, m] = pad(t).split(":").map(Number);
    if (ap?.toLowerCase() === "pm" && h < 12) h += 12;
    if (ap?.toLowerCase() === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const re = /([A-Za-z]{3})[a-z]*\s*(?:[-–to]+\s*([A-Za-z]{3})[a-z]*)?\s*:?\s*(\d{1,2}(?:[:.]\d{2})?)\s*(am|pm)?\s*[-–to]+\s*(\d{1,2}(?:[:.]\d{2})?)\s*(am|pm)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = idx(m[1]), b = m[2] ? idx(m[2]) : a;
    if (a < 0 || b < 0) continue;
    const w = { start: to24(m[3], m[4]), end: to24(m[5], m[6]) };
    if (w.start >= w.end) continue;
    for (let i = a; i <= (b >= a ? b : a); i++) out[DAYS[i]] = [w];
  }
  return Object.keys(out).length ? out : null;
}
