-- 007 · Customer relationship tracking + billing
-- • Customer: when they last bought/booked, how often they usually come back, when they're expected next,
--   and where they stand (lead / active / due / at_risk / lapsed), plus nudge bookkeeping for the AI.
-- • app_refresh_relationships(): recomputes all of the above for one workspace in a single statement.
-- • BillingTransaction + app_activate_plan(): Paystack payments, activated exactly once.
-- • Existing workspaces get the "customer_care" automation (switched OFF; the owner opts in).
-- Safe to re-run.

BEGIN;

-- ── Customer relationship columns ─────────────────────────────────────────────
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "relationship"          TEXT NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS "lastPurchaseAt"        TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "nextBookingAt"         TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "visitCount"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "avgGapDays"            INTEGER,
  ADD COLUMN IF NOT EXISTS "expectedNextAt"        TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "lastNudgedAt"          TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "nudgeCount"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextNudgeAt"           TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "relationshipUpdatedAt" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "Customer_organizationId_relationship_idx" ON "Customer" ("organizationId", "relationship");

-- Per-customer activity: every non-cancelled order and every past booked/completed appointment is a "visit".
CREATE OR REPLACE FUNCTION app_customer_activity(p_org text)
RETURNS TABLE (cid text, event_count int, first_at timestamptz, last_at timestamptz, next_booking_at timestamptz)
LANGUAGE sql STABLE AS $$
  WITH ev AS (
    SELECT "customerId" AS cid, "createdAt" AS at FROM "Order"
      WHERE "organizationId" = p_org AND status <> 'CANCELLED'
    UNION ALL
    SELECT "customerId", "startsAt" FROM "Appointment"
      WHERE "organizationId" = p_org AND status IN ('booked', 'completed') AND "startsAt" <= now()
  ), nb AS (
    SELECT "customerId" AS cid, min("startsAt") AS at FROM "Appointment"
      WHERE "organizationId" = p_org AND status = 'booked' AND "startsAt" > now() GROUP BY "customerId"
  )
  SELECT c.id, count(ev.at)::int, min(ev.at), max(ev.at), (SELECT nb.at FROM nb WHERE nb.cid = c.id)
  FROM "Customer" c LEFT JOIN ev ON ev.cid = c.id
  WHERE c."organizationId" = p_org
  GROUP BY c.id;
$$;
REVOKE ALL ON FUNCTION app_customer_activity(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_customer_activity(text) TO service_role;

-- Recompute relationship state for every customer of one workspace. Returns how many rows changed.
--   usual gap  = (last visit − first visit) / (visits − 1), clamped to 7–180 days; one visit → p_default_days
--   ratio      = days since last visit / usual gap
--   active (<0.8) · due (0.8–1.25: they're about to be, or just are, expected back) · at_risk (<2.5) · lapsed
--   no visits  = lead, or cold_lead after 14 days of silence
CREATE OR REPLACE FUNCTION app_refresh_relationships(p_org text, p_default_days int DEFAULT 30)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH calc AS (
    SELECT a.cid, a.event_count, a.last_at, a.next_booking_at,
      CASE WHEN a.event_count >= 2
             THEN greatest(7, least(180, round(extract(epoch FROM (a.last_at - a.first_at)) / 86400.0 / (a.event_count - 1))::int))
           WHEN a.event_count = 1 THEN greatest(7, least(180, p_default_days))
      END AS gap
    FROM app_customer_activity(p_org) a
  ), cls AS (
    SELECT calc.*, c."lastInteractionAt", c.relationship AS old_rel,
      CASE WHEN calc.event_count > 0 THEN extract(epoch FROM (now() - calc.last_at)) / 86400.0 / calc.gap END AS ratio
    FROM calc JOIN "Customer" c ON c.id = calc.cid
  ), fin AS (
    SELECT cls.*,
      CASE
        WHEN next_booking_at IS NOT NULL THEN 'active'
        WHEN event_count = 0 THEN
          CASE WHEN "lastInteractionAt" IS NOT NULL AND "lastInteractionAt" < now() - interval '14 days' THEN 'cold_lead' ELSE 'lead' END
        WHEN ratio < 0.8 THEN 'active'
        WHEN ratio < 1.25 THEN 'due'
        WHEN ratio < 2.5 THEN 'at_risk'
        ELSE 'lapsed'
      END AS rel
    FROM cls
  ), upd AS (
    UPDATE "Customer" c SET
      relationship = f.rel,
      "lastPurchaseAt" = f.last_at,
      "nextBookingAt" = f.next_booking_at,
      "visitCount" = f.event_count,
      "avgGapDays" = f.gap,
      "expectedNextAt" = CASE WHEN f.last_at IS NOT NULL THEN f.last_at + make_interval(days => f.gap) END,
      "nudgeCount" = CASE WHEN f.rel = 'active' THEN 0 ELSE c."nudgeCount" END,
      "nextNudgeAt" = CASE WHEN f.rel = 'active' THEN NULL ELSE c."nextNudgeAt" END,
      "relationshipUpdatedAt" = now()
    FROM fin f
    WHERE c.id = f.cid AND c."organizationId" = p_org
      AND (c.relationship, c."lastPurchaseAt", c."nextBookingAt", c."visitCount", c."avgGapDays")
          IS DISTINCT FROM (f.rel, f.last_at, f.next_booking_at, f.event_count, f.gap)
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION app_refresh_relationships(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_refresh_relationships(text, int) TO service_role;

-- ── Billing ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BillingTransaction" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "planId"         TEXT NOT NULL,
  "reference"      TEXT NOT NULL,
  "amountCents"    INTEGER NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'NGN',
  "status"         TEXT NOT NULL DEFAULT 'pending',   -- pending | success | failed
  "gateway"        TEXT NOT NULL DEFAULT 'paystack',
  "gatewayPayload" JSONB,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"         TIMESTAMPTZ(3),
  CONSTRAINT "BillingTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "BillingTransaction_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingTransaction_reference_key" ON "BillingTransaction" ("reference");
CREATE INDEX IF NOT EXISTS "BillingTransaction_organizationId_createdAt_idx" ON "BillingTransaction" ("organizationId", "createdAt");

-- Activate a paid plan exactly once (called by both the Paystack webhook and the return-page verification).
-- Locks the transaction row, so concurrent calls can't extend the subscription twice.
CREATE OR REPLACE FUNCTION app_activate_plan(p_reference text, p_paid_kobo int, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  tx "BillingTransaction";
  sub "Subscription";
  base timestamptz;
  new_end timestamptz;
  has_sub boolean;
  old_price int;
  new_price int;
  credit interval := interval '0';
BEGIN
  SELECT * INTO tx FROM "BillingTransaction" WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_reference'); END IF;
  IF tx.status = 'success' THEN RETURN jsonb_build_object('ok', true, 'already', true, 'organizationId', tx."organizationId"); END IF;
  IF p_paid_kobo < tx."amountCents" THEN
    UPDATE "BillingTransaction" SET status = 'failed', "gatewayPayload" = p_payload WHERE id = tx.id;
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  END IF;

  SELECT * INTO sub FROM "Subscription" WHERE "organizationId" = tx."organizationId" FOR UPDATE;
  has_sub := FOUND;
  -- Renewing the same plan extends from the current period end.
  -- Switching plans starts now, and the unused time on the old plan is carried over as credit,
  -- converted by price (upgrade: fewer days of the dearer plan; downgrade: more days of the cheaper one).
  IF has_sub AND sub."planId" = tx."planId" AND sub.status = 'active' AND sub."currentPeriodEnd" > now() THEN
    base := sub."currentPeriodEnd";
  ELSE
    base := now();
    IF has_sub AND sub.status = 'active' AND sub."currentPeriodEnd" > now() AND sub."planId" <> tx."planId" THEN
      SELECT "priceCents" INTO old_price FROM "Plan" WHERE id = sub."planId";
      SELECT "priceCents" INTO new_price FROM "Plan" WHERE id = tx."planId";
      IF COALESCE(old_price, 0) > 0 AND COALESCE(new_price, 0) > 0 THEN
        credit := (sub."currentPeriodEnd" - now()) * old_price::numeric / new_price::numeric;
      END IF;
    END IF;
  END IF;
  new_end := base + interval '30 days' + credit;

  IF has_sub THEN
    UPDATE "Subscription" SET "planId" = tx."planId", status = 'active', "trialEndsAt" = NULL, "currentPeriodEnd" = new_end WHERE id = sub.id;
  ELSE
    INSERT INTO "Subscription" ("organizationId", "planId", status, "currentPeriodEnd") VALUES (tx."organizationId", tx."planId", 'active', new_end);
  END IF;

  UPDATE "BillingTransaction" SET status = 'success', "paidAt" = now(), "gatewayPayload" = p_payload WHERE id = tx.id;
  UPDATE "Organization" SET status = 'ACTIVE' WHERE id = tx."organizationId" AND status IN ('TRIAL', 'CANCELLED');
  INSERT INTO "AuditLog" ("organizationId", action, entity, "entityId", meta)
  VALUES (tx."organizationId", 'billing.paid', 'plan', tx."planId", jsonb_build_object('reference', p_reference, 'amountCents', tx."amountCents", 'carriedOver', to_char(credit, 'DD "days" HH24 "hours"')));
  RETURN jsonb_build_object('ok', true, 'organizationId', tx."organizationId", 'currentPeriodEnd', new_end, 'creditDays', round(extract(epoch FROM credit) / 86400.0, 1));
END $$;
REVOKE ALL ON FUNCTION app_activate_plan(text, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_activate_plan(text, int, jsonb) TO service_role;

-- ── "customer_care" automation for workspaces that already exist (OFF until the owner turns it on) ──
INSERT INTO "Automation" ("organizationId", key, name, trigger, config, enabled)
SELECT o.id, 'customer_care', 'Keep in touch with customers', 'customer_lifecycle',
  '{"template": "Hi {name}, it''s been a while since your last visit to {business}. We''d love to see you again — would you like to book or order? Just reply here.", "aiPersonalize": true, "defaultCycleDays": 30, "maxNudges": 3, "dailyCap": 20, "sendFromHour": 9, "sendToHour": 19}'::jsonb,
  false
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Automation" a WHERE a."organizationId" = o.id AND a.key = 'customer_care');

-- Existing agents that can browse the catalogue may now also send item photos on WhatsApp.
UPDATE "AiAgent" SET "enabledTools" = array_append("enabledTools", 'send_item_photos')
WHERE 'search_products' = ANY("enabledTools") AND NOT ('send_item_photos' = ANY("enabledTools"));

-- Lock the new table away from the public Data API (same as 002).
ALTER TABLE "BillingTransaction" ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
