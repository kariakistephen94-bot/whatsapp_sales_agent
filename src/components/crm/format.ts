import { DateTime } from "luxon";

/** Client-safe copy of STATUS_LABEL (modules/customers/service imports Prisma, so it can't ship to the browser). */
export const CUSTOMER_STATUS_LABEL: Record<string, string> = {
  new: "New", returning: "Returning", high_value: "High value", potential: "Potential", inactive: "Inactive",
};
export const statusLabel = (s: string) => CUSTOMER_STATUS_LABEL[s] ?? s;

const toDt = (d: Date | string, tz: string) => (typeof d === "string" ? DateTime.fromISO(d) : DateTime.fromJSDate(d)).setZone(tz);

/** "5m ago", "3d ago", or a date for anything older than a month. */
export function relativeTime(d: Date | string | null | undefined, tz: string) {
  if (!d) return "—";
  const dt = toDt(d, tz);
  const diff = Date.now() - dt.toMillis();
  if (diff < 60_000) return "just now";
  if (diff < 30 * 864e5) return dt.toRelative({ style: "short" }) ?? dt.toFormat("d LLL yyyy");
  return dt.toFormat("d LLL yyyy");
}

/** Chat-list style stamp: 14:05 today, "Yesterday", weekday this week, else 3 Mar. */
export function listStamp(d: string, tz: string) {
  const dt = toDt(d, tz);
  const now = DateTime.now().setZone(tz);
  if (dt.hasSame(now, "day")) return dt.toFormat("HH:mm");
  if (dt.hasSame(now.minus({ days: 1 }), "day")) return "Yesterday";
  if (now.diff(dt, "days").days < 7) return dt.toFormat("ccc");
  return dt.hasSame(now, "year") ? dt.toFormat("d LLL") : dt.toFormat("d LLL yyyy");
}

export function dayLabel(d: string, tz: string) {
  const dt = toDt(d, tz);
  const now = DateTime.now().setZone(tz);
  if (dt.hasSame(now, "day")) return "Today";
  if (dt.hasSame(now.minus({ days: 1 }), "day")) return "Yesterday";
  return dt.hasSame(now, "year") ? dt.toFormat("cccc, d LLL") : dt.toFormat("d LLL yyyy");
}

export const fmtTime = (d: Date | string, tz: string) => toDt(d, tz).toFormat("HH:mm");
export const fmtDateTime = (d: Date | string, tz: string) => toDt(d, tz).toFormat("d LLL yyyy, HH:mm");
export const fmtDate = (d: Date | string, tz: string) => toDt(d, tz).toFormat("d LLL yyyy");
export const dayKey = (d: string, tz: string) => toDt(d, tz).toISODate() ?? d.slice(0, 10);
