import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.paystack.co";

export const paystackConfigured = () => Boolean(process.env.PAYSTACK_SECRET_KEY);
const secret = () => {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return k;
};

type PaystackRes<T> = { status: boolean; message: string; data: T };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as PaystackRes<T> | null;
  if (!res.ok || !json?.status) throw new Error(`Paystack: ${json?.message ?? res.statusText}`);
  return json.data;
}

/** Start a hosted checkout. `amountKobo` is already in kobo (Paystack's minor unit for NGN). */
export function initializeTransaction(input: { email: string; amountKobo: number; currency?: string; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) {
  return call<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({ email: input.email, amount: input.amountKobo, currency: input.currency ?? "NGN", reference: input.reference, callback_url: input.callbackUrl, metadata: input.metadata }),
  });
}

export type VerifiedTransaction = { status: string; reference: string; amount: number; currency: string; paid_at?: string; metadata?: Record<string, unknown> };
export const verifyTransaction = (reference: string) =>
  call<VerifiedTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);

/** Paystack signs the raw request body with the secret key (HMAC-SHA512) in x-paystack-signature. */
export function validSignature(rawBody: string, signature: string | null, key = process.env.PAYSTACK_SECRET_KEY) {
  if (!key || !signature) return false;
  const expected = createHmac("sha512", key).update(rawBody).digest();
  let got: Buffer;
  try { got = Buffer.from(signature, "hex"); } catch { return false; }
  return got.length === expected.length && timingSafeEqual(got, expected);
}
