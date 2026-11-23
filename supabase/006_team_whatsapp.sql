-- 006 · Team members on WhatsApp
-- • Every team member has a WhatsApp number (used for hand-off alerts).
-- • Invitations carry the invitee's WhatsApp number and a private join link sent on WhatsApp.
-- Safe to re-run.

BEGIN;

ALTER TABLE "Membership"
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "notifyHandoffs" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "Membership_organizationId_phone_idx" ON "Membership" ("organizationId", "phone");

ALTER TABLE "Invitation"
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "token" TEXT,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "authUserId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_token_key" ON "Invitation" ("token");

-- Accepting an invitation now copies the invitee's WhatsApp number onto their membership.
CREATE OR REPLACE FUNCTION app_ensure_user(p_user_id text, p_email text, p_name text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  inv record;
BEGIN
  INSERT INTO "User" (id, email, name) VALUES (p_user_id, p_email, p_name)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = COALESCE("User".name, EXCLUDED.name);

  FOR inv IN
    SELECT id, "organizationId", role, phone FROM "Invitation"
    WHERE email = p_email AND "acceptedAt" IS NULL
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO "Membership" ("userId", "organizationId", role, phone)
    VALUES (p_user_id, inv."organizationId", inv.role, inv.phone)
    ON CONFLICT ("userId", "organizationId") DO UPDATE SET phone = COALESCE("Membership".phone, EXCLUDED.phone);
    UPDATE "Invitation" SET "acceptedAt" = now(), token = NULL WHERE id = inv.id AND "organizationId" = inv."organizationId";
    INSERT INTO "AuditLog" ("organizationId", "actorId", action)
    VALUES (inv."organizationId", p_user_id, 'invitation.accepted');
  END LOOP;

  RETURN jsonb_build_object('memberships', (SELECT count(*) FROM "Membership" WHERE "userId" = p_user_id));
END $$;
REVOKE ALL ON FUNCTION app_ensure_user(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_ensure_user(text, text, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
