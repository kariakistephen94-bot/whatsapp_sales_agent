import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DATE_COLUMNS, JSON_COLUMNS, type TableName } from "./db-types";

export * from "./db-types";

/**
 * Data access: Supabase only (HTTPS API + service role key). No direct Postgres connection.
 *
 *   const rows = await run<Customer[]>(tenant(orgId).from("Customer").select("*").order("createdAt", { ascending: false }));
 *   const one  = await maybe<Customer>(tenant(orgId).from("Customer").select("*").eq("id", id).maybeSingle());
 *   const n    = await count(tenant(orgId).from("Order").select("*", { count: "exact", head: true }).eq("status", "PENDING"));
 *   const res  = await rpc<{ ok: boolean }>("app_book_appointment", { ... });
 *
 * The service role bypasses RLS, so tenant isolation is enforced here: `tenant(orgId)` filters every
 * select/update/delete by organizationId and stamps it onto every insert/upsert.
 * Server-side code only: the service role key is never available in the browser.
 */

const g = globalThis as unknown as { __sbAdmin?: SupabaseClient };

export function db(): SupabaseClient {
  if (g.__sbAdmin) return g.__sbAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  return (g.__sbAdmin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-client-info": "wa-sales-server" } },
  }));
}

export class DbError extends Error {
  constructor(message: string, readonly code?: string, readonly details?: string) { super(message); this.name = "DbError"; }
}
/** Postgres unique violation (duplicate key). */
export const isUniqueViolation = (e: unknown) => e instanceof DbError && e.code === "23505";

/** Convert timestamp columns (by name) from ISO strings to Date, recursively through embedded rows. */
export function reviveDates<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reviveDates) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const o = value as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (JSON_COLUMNS.has(k)) continue;
      if (typeof v === "string" && DATE_COLUMNS.has(k)) o[k] = new Date(v);
      else if (v && typeof v === "object") o[k] = reviveDates(v);
    }
  }
  return value;
}

type Res = { data: unknown; error: { message: string; code?: string; details?: string } | null; count?: number | null };
const check = (r: Res) => { if (r.error) throw new DbError(r.error.message, r.error.code, r.error.details); };

/** Await a query; throw on error; return rows with Dates revived. */
export async function run<T>(query: PromiseLike<Res>): Promise<T> {
  const r = await query; check(r);
  return reviveDates(r.data as T);
}
/** For `.maybeSingle()` queries: the row, or null. */
export async function maybe<T>(query: PromiseLike<Res>): Promise<T | null> {
  const r = await query; check(r);
  return (r.data ? reviveDates(r.data as T) : null);
}
/** For `.single()` queries or anything that must return a row. */
export async function must<T>(query: PromiseLike<Res>, notFound = "Not found"): Promise<T> {
  const r = await query; check(r);
  if (r.data == null) throw new DbError(notFound, "NOT_FOUND");
  return reviveDates(r.data as T);
}
/** For `select("*", { count: "exact", head: true })` queries. */
export async function count(query: PromiseLike<Res>): Promise<number> {
  const r = await query; check(r);
  return r.count ?? 0;
}
/** Call a Postgres function (defined in supabase/*.sql). */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await db().rpc(fn, args); check(r as Res);
  return reviveDates(r.data as T);
}

/** Unscoped table access. Use ONLY for platform-level code (auth, super-admin, workers resolving an org). */
export const from = (table: TableName) => db().from(table);

// Tables that carry organizationId directly.
const TENANT_TABLES = new Set<TableName>([
  "Customer", "Tag", "Segment", "Invitation", "Followup", "CatalogItem", "Order", "StaffMember",
  "Appointment", "WhatsappConnection", "Conversation", "Message", "Automation",
  "KnowledgeSource", "KnowledgeChunk", "UsageCounter", "Membership", "Storefront", "AiAgent",
  "Subscription", "DashboardPreference", "AuditLog", "BillingTransaction", "PaymentConfig", "OrderPayment",
]);

const strip = (v: Record<string, unknown>) => { const { organizationId: _drop, ...rest } = v; return rest; };

/**
 * Tenant-scoped access. Every read/update/delete is filtered by organizationId and every
 * insert/upsert has it stamped on, so a request can never touch another organization's rows,
 * even with a guessed id. Always derive orgId from the session, never from input.
 */
export function tenant(organizationId: string) {
  if (!organizationId) throw new Error("tenant() requires an organizationId");
  return {
    organizationId,
    from(table: TableName) {
      if (!TENANT_TABLES.has(table)) throw new Error(`${table} is not a tenant table; use from() with an explicit filter`);
      const t = db().from(table);
      return {
        select: (columns = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) =>
          t.select(columns, opts).eq("organizationId", organizationId),
        insert: <V extends Record<string, unknown>>(values: V | V[]) =>
          t.insert(Array.isArray(values) ? values.map((v) => ({ ...v, organizationId })) : { ...values, organizationId }),
        upsert: <V extends Record<string, unknown>>(values: V | V[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) =>
          t.upsert(Array.isArray(values) ? values.map((v) => ({ ...v, organizationId })) : { ...values, organizationId }, opts),
        update: (values: Record<string, unknown>) => t.update(strip(values)).eq("organizationId", organizationId),
        delete: () => t.delete().eq("organizationId", organizationId),
      };
    },
  };
}
export type TenantDb = ReturnType<typeof tenant>;

/**
 * One-to-one embeds (e.g. Organization → Storefront / AiAgent) can come back from PostgREST as a
 * one-element array. Normalise to a single row (or null).
 */
export const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
