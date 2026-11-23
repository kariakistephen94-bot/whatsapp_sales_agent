import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.paystack.co";
type Res<T> = { status: boolean; message: string; data: T };

/** Calls Paystack with a business's own secret key. The key is passed in per call and never logged. */
async function call<T>(secret: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as Res<T> | null;
  if (!res.ok || !json?.status) throw new Error(json?.message ?? `Paystack error ${res.status}`);
  return json.data;
}

export const keyMode = (k: string): "live" | "test" | null => (/^(sk|pk)_live_[A-Za-z0-9]+$/.test(k) ? "live" : /^(sk|pk)_test_[A-Za-z0-9]+$/.test(k) ? "test" : null);

/** True only if Paystack accepts this secret key. */
export const checkSecretKey = (secret: string) => call<unknown>(secret, "/balance").then(() => true, () => false);

export const initializeForBusiness = (secret: string, input: { email: string; amountKobo: number; currency: string; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) =>
  call<{ authorization_url: string; reference: string }>(secret, "/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({ email: input.email, amount: input.amountKobo, currency: input.currency, reference: input.reference, callback_url: input.callbackUrl, metadata: input.metadata }),
  });

export type Verified = { status: string; reference: string; amount: number; currency: string; paid_at?: string; metadata?: Record<string, unknown> };
export const verifyForBusiness = (secret: string, reference: string) => call<Verified>(secret, `/transaction/verify/${encodeURIComponent(reference)}`);

/** Paystack signs webhook bodies with the account's secret key (HMAC-SHA512). */
export function signatureMatches(raw: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha512", secret).update(raw).digest();
  let got: Buffer;
  try { got = Buffer.from(signature, "hex"); } catch { return false; }
  return got.length === expected.length && timingSafeEqual(got, expected);
}
