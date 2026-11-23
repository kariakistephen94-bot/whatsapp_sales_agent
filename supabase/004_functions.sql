-- 004 · Database functions used by the app through the Supabase API (rpc)
-- Operations that must happen all-or-nothing live here: booking (no double bookings), orders
-- (stock + order numbers), workspace creation, deletes, counters, the job queue, rate limits and analytics.
-- Every function is callable ONLY with the service role key (server side); the public anon key can't run them.
-- Safe to re-run (CREATE OR REPLACE).

BEGIN;

-- ════════ 00_core ════════
-- ── Job queue: claim due jobs atomically (several workers never get the same job) ──
CREATE OR REPLACE FUNCTION app_claim_jobs(p_queue text, p_limit int)
RETURNS TABLE (id text, name text, data jsonb, attempts int, "maxAttempts" int)
LANGUAGE sql AS $$
  UPDATE "Job" j SET status = 'running', "lockedAt" = now(), attempts = j.attempts + 1
  WHERE j.id IN (
    SELECT id FROM "Job"
    WHERE queue = p_queue AND status = 'pending' AND "runAt" <= now()
    ORDER BY "runAt" LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING j.id, j.name, j.data, j.attempts, j."maxAttempts";
$$;

-- ── Fixed-window rate limit: returns the request count in the current window ──
CREATE OR REPLACE FUNCTION app_rate_limit_hit(p_key text, p_window_seconds int)
RETURNS int LANGUAGE sql AS $$
  INSERT INTO "RateLimitBucket" (key, count, "resetAt")
  VALUES (p_key, 1, now() + make_interval(secs => p_window_seconds))
  ON CONFLICT (key) DO UPDATE SET
    count     = CASE WHEN "RateLimitBucket"."resetAt" < now() THEN 1 ELSE "RateLimitBucket".count + 1 END,
    "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" < now() THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
  RETURNING count;
$$;

-- ════════ a_platform ════════
-- ── Group A: platform (auth, tenancy, billing, settings, team) ──

-- ── First sign-in: mirror the auth user, accept pending invitations, report membership count ──
-- Platform-level (runs before the user has an organization): invitations are matched by the
-- verified email of the signed-in user, exactly as the app did before.
CREATE OR REPLACE FUNCTION app_ensure_user(p_user_id text, p_email text, p_name text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  inv record;
BEGIN
  INSERT INTO "User" (id, email, name) VALUES (p_user_id, p_email, p_name)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  FOR inv IN
    SELECT id, "organizationId", role FROM "Invitation"
    WHERE email = p_email AND "acceptedAt" IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO "Membership" ("userId", "organizationId", role)
    VALUES (p_user_id, inv."organizationId", inv.role)
    ON CONFLICT ("userId", "organizationId") DO NOTHING;
    UPDATE "Invitation" SET "acceptedAt" = now() WHERE id = inv.id AND "organizationId" = inv."organizationId";
    INSERT INTO "AuditLog" ("organizationId", "actorId", action)
    VALUES (inv."organizationId", p_user_id, 'invitation.accepted');
  END LOOP;

  RETURN jsonb_build_object('memberships', (SELECT count(*) FROM "Membership" WHERE "userId" = p_user_id));
END $$;
REVOKE ALL ON FUNCTION app_ensure_user(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_ensure_user(text, text, text) TO service_role;

-- ── New workspace: org + owner membership + agent + storefront + automations + trial + audit, atomically ──
-- Creates the organization, so it takes no organization id; every row it writes uses the new org's id.
-- p_automations: [{ "key", "name", "trigger", "config", "enabled" }] (templates live in the app).
CREATE OR REPLACE FUNCTION app_create_organization(p_user_id text, p_name text, p_base_slug text, p_automations jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_org "Organization";
  v_slug text := p_base_slug;
  v_i int := 2;
  v_plan_id text;
BEGIN
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Organization" WHERE slug = v_slug) THEN
      BEGIN
        INSERT INTO "Organization" (name, slug, capabilities)
        VALUES (p_name, v_slug, ARRAY[]::text[])
        RETURNING * INTO v_org;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        NULL; -- slug taken concurrently: try the next suffix
      END;
    END IF;
    v_slug := p_base_slug || '-' || v_i;
    v_i := v_i + 1;
  END LOOP;

  INSERT INTO "Membership" ("userId", "organizationId", role) VALUES (p_user_id, v_org.id, 'OWNER');
  INSERT INTO "AiAgent" ("organizationId", "enabledTools") VALUES (v_org.id, ARRAY[]::text[]);
  INSERT INTO "Storefront" ("organizationId", name) VALUES (v_org.id, p_name);

  INSERT INTO "Automation" ("organizationId", key, name, trigger, config, enabled)
  SELECT v_org.id, a->>'key', a->>'name', a->>'trigger', COALESCE(a->'config', '{}'::jsonb), COALESCE((a->>'enabled')::boolean, false)
  FROM jsonb_array_elements(COALESCE(p_automations, '[]'::jsonb)) AS a;

  SELECT id INTO v_plan_id FROM "Plan" WHERE key = 'trial';
  IF v_plan_id IS NOT NULL THEN
    INSERT INTO "Subscription" ("organizationId", "planId", status, "trialEndsAt")
    VALUES (v_org.id, v_plan_id, 'trialing', now() + interval '14 days');
  END IF;

  INSERT INTO "AuditLog" ("organizationId", "actorId", action) VALUES (v_org.id, p_user_id, 'org.created');
  RETURN to_jsonb(v_org);
END $$;
REVOKE ALL ON FUNCTION app_create_organization(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_create_organization(text, text, text, jsonb) TO service_role;

-- ── Monthly usage counter: atomic increment (no lost updates under concurrent AI replies) ──
CREATE OR REPLACE FUNCTION app_increment_usage(p_organization_id text, p_metric text, p_period text, p_by int)
RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO "UsageCounter" ("organizationId", metric, period, count)
  VALUES (p_organization_id, p_metric, p_period, p_by)
  ON CONFLICT ("organizationId", metric, period) DO UPDATE SET count = "UsageCounter".count + EXCLUDED.count
  RETURNING jsonb_build_object('count', count);
$$;
REVOKE ALL ON FUNCTION app_increment_usage(text, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_increment_usage(text, text, text, int) TO service_role;

-- ── Settings: update whitelisted organization fields + write the audit row, atomically ──
-- Only keys present in p_fields are changed (name, description, email, phone, address, city, website, businessHours).
CREATE OR REPLACE FUNCTION app_update_org_settings(p_organization_id text, p_actor_id text, p_fields jsonb, p_action text, p_meta jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Organization" SET
    name            = CASE WHEN p_fields ? 'name'          THEN p_fields->>'name'          ELSE name END,
    description     = CASE WHEN p_fields ? 'description'   THEN p_fields->>'description'   ELSE description END,
    email           = CASE WHEN p_fields ? 'email'         THEN p_fields->>'email'         ELSE email END,
    phone           = CASE WHEN p_fields ? 'phone'         THEN p_fields->>'phone'         ELSE phone END,
    address         = CASE WHEN p_fields ? 'address'       THEN p_fields->>'address'       ELSE address END,
    city            = CASE WHEN p_fields ? 'city'          THEN p_fields->>'city'          ELSE city END,
    website         = CASE WHEN p_fields ? 'website'       THEN p_fields->>'website'       ELSE website END,
    "businessHours" = CASE WHEN p_fields ? 'businessHours' THEN p_fields->'businessHours'  ELSE "businessHours" END
  WHERE id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO "AuditLog" ("organizationId", "actorId", action, entity, "entityId", meta)
  VALUES (p_organization_id, p_actor_id, p_action, 'organization', p_organization_id, p_meta);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION app_update_org_settings(text, text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_update_org_settings(text, text, jsonb, text, jsonb) TO service_role;

-- ── Team: remove a membership and the member's invitations in this org, atomically ──
CREATE OR REPLACE FUNCTION app_remove_member(p_organization_id text, p_membership_id text, p_email text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "Membership" WHERE id = p_membership_id AND "organizationId" = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM "Invitation" WHERE "organizationId" = p_organization_id AND email = p_email;
  RETURN jsonb_build_object('removed', true);
END $$;
REVOKE ALL ON FUNCTION app_remove_member(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_remove_member(text, text, text) TO service_role;

-- ── Delete a workspace: RESTRICT-referencing rows first, audit (org-less), then the org cascades ──
CREATE OR REPLACE FUNCTION app_delete_organization(p_organization_id text, p_actor_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
BEGIN
  SELECT name INTO v_name FROM "Organization" WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002'; END IF;

  DELETE FROM "Order"               WHERE "organizationId" = p_organization_id; -- order items cascade
  DELETE FROM "Appointment"         WHERE "organizationId" = p_organization_id; -- reminder logs cascade
  DELETE FROM "Conversation"        WHERE "organizationId" = p_organization_id; -- messages & notes cascade
  DELETE FROM "Message"             WHERE "organizationId" = p_organization_id;
  DELETE FROM "DashboardPreference" WHERE "organizationId" = p_organization_id; -- no FK to organization
  INSERT INTO "AuditLog" ("organizationId", "actorId", action, entity, "entityId", meta)
  VALUES (NULL, p_actor_id, 'org.deleted', 'organization', p_organization_id, jsonb_build_object('name', v_name));
  DELETE FROM "Organization" WHERE id = p_organization_id;                     -- everything else cascades
  RETURN jsonb_build_object('deleted', true);
END $$;
REVOKE ALL ON FUNCTION app_delete_organization(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_delete_organization(text, text) TO service_role;

-- ════════ b_commerce ════════
-- ───────────── Group B: commerce (orders, appointments, customer stats) ─────────────
-- All functions take the organization id and filter by it. Called only by the server (service role).

-- ── Create an order atomically ──
-- Prices come from the catalog (never the caller), tracked stock is decremented conditionally,
-- the order number is max+1 per org under an advisory lock, and the order + items are inserted together.
-- p_items: [{ "itemId": text, "quantity": int, "variant": object|null }, ...]
-- Returns { ok: true, orderId, number, totalCents, items: [{name, quantity, unitCents}] } or { ok: false, error }.
CREATE OR REPLACE FUNCTION app_create_order(
  p_org text, p_customer text, p_items jsonb, p_delivery jsonb, p_source text,
  p_created_by_ai boolean, p_conversation text, p_notes text, p_discount int
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_currency text;
  v_line jsonb;
  v_qty int;
  v_item "CatalogItem"%ROWTYPE;
  v_stock int;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal bigint := 0;
  v_discount bigint;
  v_number int;
  v_order_id text;
BEGIN
  SELECT currency INTO v_currency FROM "Organization" WHERE id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization % not found', p_org; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Order has no items');
  END IF;

  -- Serialize order creation per org (order numbers + stock).
  PERFORM pg_advisory_xact_lock(hashtext('app_order'), hashtext(p_org));

  BEGIN -- inner block: any AP001 below rolls back every stock change made here
    IF NOT EXISTS (SELECT 1 FROM "Customer" WHERE id = p_customer AND "organizationId" = p_org) THEN
      RAISE EXCEPTION USING ERRCODE = 'AP001', MESSAGE = 'Customer not found';
    END IF;

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) WITH ORDINALITY ORDER BY ordinality LOOP
      v_qty := (v_line->>'quantity')::int;
      IF v_qty IS NULL OR v_qty < 1 OR v_qty > 999 THEN
        RAISE EXCEPTION USING ERRCODE = 'AP001', MESSAGE = 'Invalid quantity';
      END IF;

      SELECT * INTO v_item FROM "CatalogItem"
      WHERE id = v_line->>'itemId' AND "organizationId" = p_org AND active = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'AP001', MESSAGE = 'One of the items is no longer available';
      END IF;

      IF v_item."trackInventory" THEN
        UPDATE "CatalogItem" SET stock = stock - v_qty
        WHERE id = v_item.id AND "organizationId" = p_org AND stock >= v_qty
        RETURNING stock INTO v_stock;
        IF NOT FOUND THEN
          RAISE EXCEPTION USING ERRCODE = 'AP001', MESSAGE = 'Not enough stock for ' || v_item.name ||
            CASE WHEN v_item.stock IS NOT NULL THEN ' (only ' || v_item.stock || ' left)' ELSE '' END;
        END IF;
      END IF;

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'itemId', v_item.id, 'name', v_item.name, 'quantity', v_qty, 'unitCents', v_item."priceCents",
        'variant', NULLIF(v_line->'variant', 'null'::jsonb)
      ));
      v_subtotal := v_subtotal + v_item."priceCents"::bigint * v_qty;
    END LOOP;

    v_discount := LEAST(GREATEST(0, COALESCE(p_discount, 0)), v_subtotal);
    SELECT COALESCE(MAX(number), 1000) + 1 INTO v_number FROM "Order" WHERE "organizationId" = p_org;

    INSERT INTO "Order" (
      "organizationId", "customerId", number, "subtotalCents", "discountCents", "totalCents", currency,
      delivery, source, "createdByAi", "conversationId", notes
    ) VALUES (
      p_org, p_customer, v_number, v_subtotal::int, v_discount::int, (v_subtotal - v_discount)::int, v_currency,
      NULLIF(p_delivery, 'null'::jsonb), p_source, COALESCE(p_created_by_ai, false), p_conversation, p_notes
    ) RETURNING id INTO v_order_id;

    INSERT INTO "OrderItem" ("orderId", "itemId", name, quantity, "unitCents", variant)
    SELECT v_order_id, l->>'itemId', l->>'name', (l->>'quantity')::int, (l->>'unitCents')::int, l->'variant'
    FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS t(l, ord) ORDER BY ord;

    RETURN jsonb_build_object(
      'ok', true, 'orderId', v_order_id, 'number', v_number, 'totalCents', (v_subtotal - v_discount)::int,
      'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', l->'name', 'quantity', l->'quantity', 'unitCents', l->'unitCents') ORDER BY ord), '[]'::jsonb)
                FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS t(l, ord))
    );
  EXCEPTION WHEN SQLSTATE 'AP001' THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;
END;
$$;
REVOKE ALL ON FUNCTION app_create_order(text, text, jsonb, jsonb, text, boolean, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_create_order(text, text, jsonb, jsonb, text, boolean, text, text, int) TO service_role;

-- ── Change an order's status; cancelling returns tracked stock in the same transaction ──
-- Returns the updated Order row as jsonb, or null when the order isn't in this org.
CREATE OR REPLACE FUNCTION app_set_order_status(p_org text, p_order text, p_status text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_old "OrderStatus";
  v_row "Order"%ROWTYPE;
BEGIN
  SELECT status INTO v_old FROM "Order" WHERE id = p_order AND "organizationId" = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF p_status = 'CANCELLED' AND v_old <> 'CANCELLED' THEN
    UPDATE "CatalogItem" c SET stock = c.stock + q.qty
    FROM (SELECT "itemId", SUM(quantity)::int AS qty FROM "OrderItem" WHERE "orderId" = p_order GROUP BY "itemId") q
    WHERE c.id = q."itemId" AND c."organizationId" = p_org AND c."trackInventory" = true;
  END IF;

  UPDATE "Order" SET status = p_status::"OrderStatus"
  WHERE id = p_order AND "organizationId" = p_org
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION app_set_order_status(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_set_order_status(text, text, text) TO service_role;

-- ── Order dashboard stats (avoids PostgREST row caps on large orgs) ──
-- Returns { total, paidCents, paidCount, outstandingCents, outstandingCount, byStatus: { STATUS: n } }.
CREATE OR REPLACE FUNCTION app_order_stats(p_org text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM "Order" WHERE "organizationId" = p_org),
    'paidCents', (SELECT COALESCE(SUM("totalCents"), 0) FROM "Order" WHERE "organizationId" = p_org AND "paymentStatus" = 'PAID'),
    'paidCount', (SELECT COUNT(*) FROM "Order" WHERE "organizationId" = p_org AND "paymentStatus" = 'PAID'),
    'outstandingCents', (SELECT COALESCE(SUM("totalCents"), 0) FROM "Order"
                         WHERE "organizationId" = p_org AND "paymentStatus" IN ('UNPAID', 'PENDING') AND status <> 'CANCELLED'),
    'outstandingCount', (SELECT COUNT(*) FROM "Order"
                         WHERE "organizationId" = p_org AND "paymentStatus" IN ('UNPAID', 'PENDING') AND status <> 'CANCELLED'),
    'byStatus', (SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                 FROM (SELECT status::text AS status, COUNT(*) AS n FROM "Order" WHERE "organizationId" = p_org GROUP BY status) s)
  );
$$;
REVOKE ALL ON FUNCTION app_order_stats(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_order_stats(text) TO service_role;

-- ── Book an appointment atomically ──
-- Per-org advisory lock, then for each candidate staff (in order) re-check for an overlapping booked
-- appointment and insert into the first free one. p_staff_ids NULL = no staff, book against the business.
-- p_ignore: an appointment that must not block (the one being rescheduled).
-- Returns { appointmentId, staffName } or null when no candidate is free.
CREATE OR REPLACE FUNCTION app_book_appointment(
  p_org text, p_customer text, p_service text, p_starts timestamptz, p_ends timestamptz, p_staff_ids text[],
  p_source text, p_created_by_ai boolean, p_conversation text, p_notes text, p_ignore text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_candidates text[] := COALESCE(p_staff_ids, ARRAY[NULL::text]);
  v_staff text;
  v_id text;
  v_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_org));

  IF NOT EXISTS (SELECT 1 FROM "CatalogItem" WHERE id = p_service AND "organizationId" = p_org) THEN
    RAISE EXCEPTION 'Service % not in organization', p_service;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Customer" WHERE id = p_customer AND "organizationId" = p_org) THEN
    RAISE EXCEPTION 'Customer % not in organization', p_customer;
  END IF;

  FOREACH v_staff IN ARRAY v_candidates LOOP
    IF v_staff IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "StaffMember" WHERE id = v_staff AND "organizationId" = p_org) THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM "Appointment" a
      WHERE a."organizationId" = p_org AND a.status = 'booked'
        AND (p_ignore IS NULL OR a.id <> p_ignore)
        AND (v_staff IS NULL OR a."staffId" = v_staff OR a."staffId" IS NULL)
        AND a."startsAt" < p_ends AND a."endsAt" > p_starts
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO "Appointment" (
      "organizationId", "customerId", "serviceId", "staffId", "startsAt", "endsAt", source, "createdByAi", "conversationId", notes
    ) VALUES (
      p_org, p_customer, p_service, v_staff, p_starts, p_ends, p_source, COALESCE(p_created_by_ai, false), p_conversation, p_notes
    ) RETURNING id INTO v_id;

    IF v_staff IS NOT NULL THEN
      SELECT name INTO v_name FROM "StaffMember" WHERE id = v_staff AND "organizationId" = p_org;
    END IF;
    RETURN jsonb_build_object('appointmentId', v_id, 'staffName', v_name);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_book_appointment(text, text, text, timestamptz, timestamptz, text[], text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_book_appointment(text, text, text, timestamptz, timestamptz, text[], text, boolean, text, text, text) TO service_role;

-- ── Recompute a customer's lifetime value and status in one statement ──
-- LTV = paid orders + completed visits (valued at the service's price).
-- Status: high_value ≥ p_high_value; else inactive if last interaction older than p_inactive_days;
-- else returning with ≥2 purchases; keeps potential with 0 purchases; else new.
-- Returns { lifetimeValueCents, status } or null when the customer isn't in this org.
CREATE OR REPLACE FUNCTION app_refresh_customer(p_org text, p_customer text, p_high_value bigint, p_inactive_days int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_paid_sum bigint; v_paid_n int; v_visit_sum bigint; v_visit_n int;
  v_ltv bigint; v_purchases int;
  v_out jsonb;
BEGIN
  SELECT COALESCE(SUM("totalCents"), 0), COUNT(*) INTO v_paid_sum, v_paid_n
  FROM "Order" WHERE "organizationId" = p_org AND "customerId" = p_customer AND "paymentStatus" = 'PAID';

  SELECT COALESCE(SUM(c."priceCents"), 0), COUNT(*) INTO v_visit_sum, v_visit_n
  FROM "Appointment" a JOIN "CatalogItem" c ON c.id = a."serviceId"
  WHERE a."organizationId" = p_org AND a."customerId" = p_customer AND a.status = 'completed';

  v_ltv := v_paid_sum + v_visit_sum;
  v_purchases := v_paid_n + v_visit_n;

  UPDATE "Customer" cu SET
    "lifetimeValueCents" = v_ltv::int,
    status = CASE
      WHEN v_ltv >= p_high_value THEN 'high_value'
      WHEN cu."lastInteractionAt" IS NOT NULL AND now() - cu."lastInteractionAt" > make_interval(days => p_inactive_days) THEN 'inactive'
      WHEN v_purchases >= 2 THEN 'returning'
      WHEN v_purchases = 0 AND cu.status = 'potential' THEN 'potential'
      ELSE 'new'
    END
  WHERE cu.id = p_customer AND cu."organizationId" = p_org
  RETURNING jsonb_build_object('lifetimeValueCents', cu."lifetimeValueCents", 'status', cu.status) INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION app_refresh_customer(text, text, bigint, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_refresh_customer(text, text, bigint, int) TO service_role;

-- ════════ c_ai_whatsapp ════════
-- ── Group C: AI engine, WhatsApp, inbox, automations ──

-- Atomically bump an automation's sent counter (replaces Prisma `sentCount: { increment: 1 }`).
-- Tenant-scoped: only touches the row when it belongs to p_org. Returns the new count (null if not found).
CREATE OR REPLACE FUNCTION app_automation_sent(p_org text, p_automation_id text)
RETURNS jsonb LANGUAGE sql AS $$
  WITH u AS (
    UPDATE "Automation" SET "sentCount" = "sentCount" + 1
    WHERE id = p_automation_id AND "organizationId" = p_org
    RETURNING "sentCount"
  )
  SELECT jsonb_build_object('sentCount', (SELECT "sentCount" FROM u));
$$;
REVOKE ALL ON FUNCTION app_automation_sent(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_automation_sent(text, text) TO service_role;

-- ════════ d_crm_analytics ════════
-- ══════════════════════════════════════════════════════════════════════════════
-- Group D · CRM, analytics
-- Every function takes the organization id and filters by it (tenant isolation).
-- Only the service role may execute them.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── CRM: delete a customer and everything that references them, atomically ──
-- Appointments (reminder logs cascade), order items, orders, conversations (messages + notes cascade),
-- then the customer (tags + followups cascade), plus an audit log entry. All or nothing.
CREATE OR REPLACE FUNCTION app_delete_customer(p_org text, p_customer_id text, p_actor_id text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  c        "Customer"%ROWTYPE;
  n_appts  int;
  n_items  int;
  n_orders int;
  n_convos int;
BEGIN
  SELECT * INTO c FROM "Customer" WHERE id = p_customer_id AND "organizationId" = p_org FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  DELETE FROM "Appointment" WHERE "organizationId" = p_org AND "customerId" = c.id;
  GET DIAGNOSTICS n_appts = ROW_COUNT;

  DELETE FROM "OrderItem" WHERE "orderId" IN (
    SELECT id FROM "Order" WHERE "organizationId" = p_org AND "customerId" = c.id
  );
  GET DIAGNOSTICS n_items = ROW_COUNT;

  DELETE FROM "Order" WHERE "organizationId" = p_org AND "customerId" = c.id;
  GET DIAGNOSTICS n_orders = ROW_COUNT;

  DELETE FROM "Conversation" WHERE "organizationId" = p_org AND "customerId" = c.id;
  GET DIAGNOSTICS n_convos = ROW_COUNT;

  DELETE FROM "Customer" WHERE id = c.id AND "organizationId" = p_org;

  INSERT INTO "AuditLog" ("organizationId", "actorId", action, entity, "entityId", meta)
  VALUES (p_org, p_actor_id, 'customer.deleted', 'customer', c.id, jsonb_build_object(
    'name', c.name, 'phoneLast4', right(c.phone, 4),
    'appointments', n_appts, 'orderItems', n_items, 'orders', n_orders, 'conversations', n_convos
  ));

  RETURN jsonb_build_object('ok', true, 'appointments', n_appts, 'orderItems', n_items, 'orders', n_orders, 'conversations', n_convos);
END;
$$;
REVOKE ALL ON FUNCTION app_delete_customer(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_delete_customer(text, text, text) TO service_role;


-- ── Analytics: per-day series (days keyed yyyy-MM-dd in p_tz) ──
-- Revenue = PAID orders (by paidAt) + COMPLETED appointments at the service's listed price (by startsAt, not in the future).
-- AI revenue = paid orders with createdByAi or a conversationId + completed appointments with createdByAi.
CREATE OR REPLACE FUNCTION app_analytics_daily(p_org text, p_since timestamptz, p_tz text)
RETURNS TABLE (
  day text, "messagesIn" int, "messagesOut" int, "newCustomers" int, orders int,
  "orderRevenueKobo" bigint, "appointmentRevenueKobo" bigint, "aiRevenueKobo" bigint
)
LANGUAGE sql STABLE AS $$
  WITH ev AS (
    SELECT to_char(m."createdAt" AT TIME ZONE p_tz, 'YYYY-MM-DD') AS day,
           count(*) FILTER (WHERE m.direction = 'in') AS mi,
           count(*) FILTER (WHERE m.direction IS DISTINCT FROM 'in') AS mo,
           0::bigint AS nc, 0::bigint AS o, 0::bigint AS orev, 0::bigint AS arev, 0::bigint AS airev
    FROM "Message" m
    WHERE m."organizationId" = p_org AND m."createdAt" >= p_since
    GROUP BY 1
    UNION ALL
    SELECT to_char(c."createdAt" AT TIME ZONE p_tz, 'YYYY-MM-DD'), 0, 0, count(*), 0, 0, 0, 0
    FROM "Customer" c
    WHERE c."organizationId" = p_org AND c."createdAt" >= p_since
    GROUP BY 1
    UNION ALL
    SELECT to_char(o."createdAt" AT TIME ZONE p_tz, 'YYYY-MM-DD'), 0, 0, 0, count(*), 0, 0, 0
    FROM "Order" o
    WHERE o."organizationId" = p_org AND o."createdAt" >= p_since AND o.status <> 'CANCELLED'
    GROUP BY 1
    UNION ALL
    SELECT to_char(o."paidAt" AT TIME ZONE p_tz, 'YYYY-MM-DD'), 0, 0, 0, 0,
           sum(o."totalCents"),
           0,
           coalesce(sum(o."totalCents") FILTER (WHERE o."createdByAi" OR o."conversationId" IS NOT NULL), 0)
    FROM "Order" o
    WHERE o."organizationId" = p_org AND o."paymentStatus" = 'PAID' AND o."paidAt" >= p_since
    GROUP BY 1
    UNION ALL
    SELECT to_char(a."startsAt" AT TIME ZONE p_tz, 'YYYY-MM-DD'), 0, 0, 0, 0,
           0,
           sum(s."priceCents"),
           coalesce(sum(s."priceCents") FILTER (WHERE a."createdByAi"), 0)
    FROM "Appointment" a
    JOIN "CatalogItem" s ON s.id = a."serviceId"
    WHERE a."organizationId" = p_org AND a.status = 'completed' AND a."startsAt" >= p_since AND a."startsAt" <= now()
    GROUP BY 1
  )
  SELECT day,
         sum(mi)::int, sum(mo)::int, sum(nc)::int, sum(o)::int,
         sum(orev)::bigint, sum(arev)::bigint, sum(airev)::bigint
  FROM ev
  GROUP BY day;
$$;
REVOKE ALL ON FUNCTION app_analytics_daily(text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_analytics_daily(text, timestamptz, text) TO service_role;


-- ── Analytics: conversations with ≥1 AI message since p_since, and how many had no human message ──
CREATE OR REPLACE FUNCTION app_analytics_ai_resolution(p_org text, p_since timestamptz)
RETURNS TABLE (resolved int, total int)
LANGUAGE sql STABLE AS $$
  SELECT count(*) FILTER (WHERE NOT has_human)::int AS resolved, count(*)::int AS total FROM (
    SELECT "conversationId", bool_or(sender = 'human') AS has_human
    FROM "Message"
    WHERE "organizationId" = p_org AND "createdAt" >= p_since
    GROUP BY 1
    HAVING bool_or(sender = 'ai')
  ) t;
$$;
REVOKE ALL ON FUNCTION app_analytics_ai_resolution(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_analytics_ai_resolution(text, timestamptz) TO service_role;


-- ── Analytics: average seconds from an inbound message to the AI's reply ──
-- Only inbound messages whose very next message is an outbound AI message count.
CREATE OR REPLACE FUNCTION app_analytics_avg_ai_response(p_org text, p_since timestamptz)
RETURNS TABLE (secs double precision, n int)
LANGUAGE sql STABLE AS $$
  SELECT avg(EXTRACT(EPOCH FROM (nx."createdAt" - m."createdAt")))::float8 AS secs, count(*)::int AS n
  FROM "Message" m
  JOIN LATERAL (
    SELECT x."createdAt", x.sender, x.direction FROM "Message" x
    WHERE x."organizationId" = p_org AND x."conversationId" = m."conversationId" AND x."createdAt" > m."createdAt"
    ORDER BY x."createdAt" ASC LIMIT 1
  ) nx ON nx.direction = 'out' AND nx.sender = 'ai'
  WHERE m."organizationId" = p_org AND m.direction = 'in' AND m."createdAt" >= p_since;
$$;
REVOKE ALL ON FUNCTION app_analytics_avg_ai_response(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_analytics_avg_ai_response(text, timestamptz) TO service_role;


-- ── Analytics: funnel (conversations → enquired → ordered/booked → converted → paid/completed) ──
CREATE OR REPLACE FUNCTION app_analytics_funnel(p_org text, p_since timestamptz)
RETURNS TABLE (conversations int, enquired int, ordered int, converted int, paid int)
LANGUAGE sql STABLE AS $$
  WITH enq AS (
    SELECT DISTINCT c."customerId" AS id
    FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId" AND c."organizationId" = p_org
    WHERE m."organizationId" = p_org AND m.direction = 'in' AND m."createdAt" >= p_since
  ),
  flags AS (
    SELECT enq.id,
      EXISTS (SELECT 1 FROM "Order" o WHERE o."organizationId" = p_org AND o."customerId" = enq.id AND o."createdAt" >= p_since AND o.status <> 'CANCELLED') AS ordered,
      EXISTS (SELECT 1 FROM "Order" o WHERE o."organizationId" = p_org AND o."customerId" = enq.id AND o."createdAt" >= p_since AND o."paymentStatus" = 'PAID') AS paid_order,
      EXISTS (SELECT 1 FROM "Appointment" a WHERE a."organizationId" = p_org AND a."customerId" = enq.id AND a."startsAt" >= p_since AND a.status <> 'cancelled') AS booked_any,
      EXISTS (SELECT 1 FROM "Appointment" a WHERE a."organizationId" = p_org AND a."customerId" = enq.id AND a."startsAt" >= p_since AND a.status IN ('booked', 'completed')) AS booked,
      EXISTS (SELECT 1 FROM "Appointment" a WHERE a."organizationId" = p_org AND a."customerId" = enq.id AND a."startsAt" >= p_since AND a.status = 'completed') AS completed
    FROM enq
  )
  SELECT
    (SELECT count(DISTINCT "conversationId") FROM "Message" WHERE "organizationId" = p_org AND "createdAt" >= p_since)::int,
    (SELECT count(*) FROM flags)::int,
    (SELECT count(*) FROM flags WHERE ordered OR booked_any)::int,
    (SELECT count(*) FROM flags WHERE paid_order OR booked)::int,
    (SELECT count(*) FROM flags WHERE paid_order OR completed)::int;
$$;
REVOKE ALL ON FUNCTION app_analytics_funnel(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_analytics_funnel(text, timestamptz) TO service_role;


-- ── Analytics: retention (all time) — buyers with ≥1 vs ≥2 paid orders + completed appointments ──
CREATE OR REPLACE FUNCTION app_analytics_retention(p_org text)
RETURNS TABLE (buyers int, repeat int)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int AS buyers, count(*) FILTER (WHERE n >= 2)::int AS repeat FROM (
    SELECT "customerId", count(*) AS n FROM (
      SELECT "customerId" FROM "Order" WHERE "organizationId" = p_org AND "paymentStatus" = 'PAID'
      UNION ALL
      SELECT "customerId" FROM "Appointment" WHERE "organizationId" = p_org AND status = 'completed'
    ) x GROUP BY 1
  ) t;
$$;
REVOKE ALL ON FUNCTION app_analytics_retention(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_analytics_retention(text) TO service_role;


-- ── Analytics: revenue per item name (paid order lines by paidAt + completed appointments by startsAt) ──
CREATE OR REPLACE FUNCTION app_analytics_revenue_by_item(p_org text, p_since timestamptz)
RETURNS TABLE (name text, kobo bigint)
LANGUAGE sql STABLE AS $$
  SELECT name, sum(v)::bigint AS kobo FROM (
    SELECT l.name, (l.quantity * l."unitCents")::bigint AS v
    FROM "OrderItem" l JOIN "Order" o ON o.id = l."orderId"
    WHERE o."organizationId" = p_org AND o."paymentStatus" = 'PAID' AND o."paidAt" >= p_since
    UNION ALL
    SELECT s.name, s."priceCents"::bigint
    FROM "Appointment" a JOIN "CatalogItem" s ON s.id = a."serviceId"
    WHERE a."organizationId" = p_org AND a.status = 'completed' AND a."startsAt" >= p_since
  ) x
  GROUP BY name
  ORDER BY kobo DESC;
$$;
REVOKE ALL ON FUNCTION app_analytics_revenue_by_item(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_analytics_revenue_by_item(text, timestamptz) TO service_role;


-- ── Analytics: distinct conversations handed to a human (escalation audit logs ∪ handler = HUMAN) ──
-- Escalation logs without an entityId each count once (same as the previous JS implementation).
CREATE OR REPLACE FUNCTION app_analytics_handoffs(p_org text, p_since timestamptz)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT (
    (SELECT count(*) FROM (
      SELECT "entityId" AS k FROM "AuditLog"
      WHERE "organizationId" = p_org AND action = 'conversation.escalated' AND "createdAt" >= p_since AND "entityId" IS NOT NULL
      UNION
      SELECT id FROM "Conversation"
      WHERE "organizationId" = p_org AND handler = 'HUMAN' AND "lastMessageAt" >= p_since
    ) u)
    +
    (SELECT count(*) FROM "AuditLog"
      WHERE "organizationId" = p_org AND action = 'conversation.escalated' AND "createdAt" >= p_since AND "entityId" IS NULL)
  )::int;
$$;
REVOKE ALL ON FUNCTION app_analytics_handoffs(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_analytics_handoffs(text, timestamptz) TO service_role;


-- ── Analytics: existing customers (created before p_since) who messaged in since p_since ──
CREATE OR REPLACE FUNCTION app_analytics_returning(p_org text, p_since timestamptz)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT count(DISTINCT c."customerId")::int
  FROM "Message" m
  JOIN "Conversation" c ON c.id = m."conversationId" AND c."organizationId" = p_org
  JOIN "Customer" cu ON cu.id = c."customerId" AND cu."organizationId" = p_org
  WHERE m."organizationId" = p_org AND m.direction = 'in' AND m."createdAt" >= p_since AND cu."createdAt" < p_since;
$$;
REVOKE ALL ON FUNCTION app_analytics_returning(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_analytics_returning(text, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION app_claim_jobs(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_claim_jobs(text, int) TO service_role;
REVOKE ALL ON FUNCTION app_rate_limit_hit(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_rate_limit_hit(text, int) TO service_role;
REVOKE ALL ON FUNCTION app_touch_updated_at() FROM PUBLIC, anon, authenticated;

COMMIT;

-- Make the API see the new functions immediately.
NOTIFY pgrst, 'reload schema';
