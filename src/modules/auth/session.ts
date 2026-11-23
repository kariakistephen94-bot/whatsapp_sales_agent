import "server-only";
import { cache } from "react";
import { rpc } from "@/server/db";
import { supabaseServer, supabaseConfigured } from "@/lib/supabase/server";
import { createOrganizationForUser } from "@/modules/tenancy/bootstrap";

export interface AuthUser { id: string; email: string; name?: string; businessName?: string }

/** The signed-in Supabase user for this request (JWT verified), or null. Cached per request. */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  if (!supabaseConfigured()) return null;
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  const c = data?.claims;
  if (error || !c?.sub || !c.email) return null;
  const meta = (c.user_metadata ?? {}) as Record<string, string>;
  return { id: c.sub, email: String(c.email).toLowerCase(), name: meta.name, businessName: meta.businessName };
});

/**
 * Makes sure the app-side User row exists and the user belongs to a workspace:
 * accepts pending invitations, or creates their own workspace from the business name given at sign-up.
 */
export const ensureAppUser = cache(async (u: AuthUser) => {
  // One atomic call: upsert the User row, accept pending invitations (membership + acceptedAt + audit).
  const { memberships } = await rpc<{ memberships: number }>("app_ensure_user", {
    p_user_id: u.id, p_email: u.email, p_name: u.name ?? null,
  });
  if (Number(memberships) === 0) await createOrganizationForUser(u.id, u.businessName || `${u.name ?? "My"} business`);
});
