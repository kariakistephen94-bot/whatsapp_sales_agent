/** Market: Nigeria. Single place for locale constants so expanding to other countries later is one change. */
export const LOCALE = {
  country: "Nigeria",
  currency: "NGN",
  currencySymbol: "₦",
  timezone: "Africa/Lagos", // WAT, UTC+1, no daylight saving
  dialCode: "+234",
} as const;

export const NG_CITIES = [
  "Lagos", "Abuja", "Port Harcourt", "Ibadan", "Kano", "Benin City", "Enugu", "Kaduna", "Abeokuta",
  "Owerri", "Warri", "Uyo", "Jos", "Ilorin", "Asaba", "Akure", "Calabar", "Onitsha", "Aba", "Maiduguri",
];

export const LANGUAGES = ["English", "Nigerian Pidgin", "Yoruba", "Igbo", "Hausa"];

/** Format an amount in Naira (major units). Never abbreviates, so prices stay exact. */
export function formatNaira(amount: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
}

/** Amounts are stored in kobo (minor units) in the database. */
export const formatKobo = (kobo: number) => formatNaira(Math.round(kobo) / 100);
export const nairaToKobo = (naira: number) => Math.round(naira * 100);

/** Compact form for chart axes: ₦45k, ₦1.2M. */
export function compactNaira(n: number) {
  if (n >= 1_000_000) return `₦${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${+(n / 1_000).toFixed(0)}k`;
  return `₦${n}`;
}

/**
 * Normalise Nigerian phone numbers to E.164 (+234…).
 * Accepts 0803 123 4567, 803 123 4567, 234803…, +234 803…, 00234…
 * Returns null if it can't be a valid Nigerian mobile/landline number.
 */
export function normalizeNgPhone(input: string): string | null {
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+")) {
    const digits = d.slice(1);
    return digits.startsWith("234") && digits.length === 13 ? `+${digits}` : /^\d{8,15}$/.test(digits) ? `+${digits}` : null; // other countries allowed through
  }
  if (d.startsWith("234") && d.length === 13) return `+${d}`;
  if (d.startsWith("0") && d.length === 11) return `+234${d.slice(1)}`;
  if (d.length === 10 && /^[789]/.test(d)) return `+234${d}`;
  return null;
}
