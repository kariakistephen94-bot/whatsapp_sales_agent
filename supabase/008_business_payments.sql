-- 008 · Businesses collect order payments with their OWN Paystack account
-- • PaymentConfig: the owner's Paystack keys (secret key stored encrypted by the app). Kept out of "Organization" on purpose,
--   so a SELECT * on the organization can never carry the key anywhere.
-- • OrderPayment: one row per payment link sent for an order; the Paystack reference is how we match the payment back.
-- • Existing agents that can create orders get the "send_payment_link" tool.
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS "PaymentConfig" (
  "organizationId"  TEXT NOT NULL,
  "provider"        TEXT NOT NULL DEFAULT 'paystack',
  "publicKey"       TEXT NOT NULL,
  "secretEncrypted" TEXT NOT NULL,
  "mode"            TEXT NOT NULL DEFAULT 'test',      -- test | live
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentConfig_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "PaymentConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "OrderPayment" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId"   TEXT NOT NULL,
  "orderId"          TEXT NOT NULL,
  "reference"        TEXT NOT NULL,
  "amountCents"      INTEGER NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'NGN',
  "status"           TEXT NOT NULL DEFAULT 'pending',   -- pending | success | failed
  "authorizationUrl" TEXT,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"           TIMESTAMPTZ(3),
  CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrderPayment_reference_key" ON "OrderPayment" ("reference");
CREATE INDEX IF NOT EXISTS "OrderPayment_orderId_idx" ON "OrderPayment" ("orderId");

UPDATE "AiAgent" SET "enabledTools" = array_append("enabledTools", 'send_payment_link')
WHERE 'create_order' = ANY("enabledTools") AND NOT ('send_payment_link' = ANY("enabledTools"));

ALTER TABLE "PaymentConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderPayment" ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
