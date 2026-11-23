import "server-only";
import { cookies } from "next/headers";
import { from, run, tenant, type Role, type TenantDb } from "@/server/db";
import { getAuthUser, ensureAppUser } from "@/modules/auth/session";
import { WORKSPACE_COOKIE } from "./workspace-cookie";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface TenantContext {
  userId: string;
  email: string;
  organizationId: string;
  role: Role;
  capabilities: string[];
  db: TenantDb;
}

const RANK: Record<Role, number> = { STAFF: 1, ADMIN: 2, OWNER: 3 };
export const hasRole = (role: Role, min: Role) => RANK[role] >= RANK[min];

/**
 * Resolves the caller's organization from the verified Supabase session — never from request input.
 * Suspended organizations are rejected here, so every guarded route enforces it.
 */
export async function getTenantContext(minRole: Role = "STAFF"): Promise<TenantContext> {
  const u = await getAuthUser();
  if (!u) throw new HttpError(401, "Unauthenticated");
  await ensureAppUser(u);

  const all = await run<{ organizationId: string; role: Role; organization: { id: string; status: string; capabilities: string[] } }[]>(
    from("Membership")
      .select("organizationId, role, organization:Organization!inner(id, status, capabilities)")
      .eq("userId", u.id).order("createdAt", { ascending: true }).order("id", { ascending: true }).limit(50),
  );
  // The workspace chosen in the switcher (a cookie, only honoured if the user really belongs to it), else the oldest usable one.
  const chosen = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const m = all.find((x) => x.organizationId === chosen && x.organization.status !== "SUSPENDED")
    ?? all.find((x) => x.organization.status !== "SUSPENDED") ?? all[0];
  if (!m) throw new HttpError(403, "No organization");
  if (m.organization.status === "SUSPENDED") throw new HttpError(403, "This workspace is suspended. Contact support.");
  if (!hasRole(m.role, minRole)) throw new HttpError(403, "You don't have permission to do that");

  return {
    userId: u.id, email: u.email, organizationId: m.organizationId, role: m.role,
    capabilities: m.organization.capabilities, db: tenant(m.organizationId),
  };
}

/** Wrap route handlers: consistent auth + error shape. */
export function withTenant<T>(minRole: Role, handler: (ctx: TenantContext, req: Request) => Promise<T>) {
  return async (req: Request) => {
    try {
      const ctx = await getTenantContext(minRole);
      const out = await handler(ctx, req);
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      throw e;
    }
  };
}

/** For server actions: returns { error } instead of throwing, so forms can show the message. */
export async function action<T>(minRole: Role, fn: (ctx: TenantContext) => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const ctx = await getTenantContext(minRole);
    return { ok: true, data: await fn(ctx) };
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, error: e.message };
    if (e instanceof Error && e.name === "ZodError") return { ok: false, error: "Please check the form and try again." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Throw inside actions for messages that are safe to show the user. */
export class UserError extends Error {}
