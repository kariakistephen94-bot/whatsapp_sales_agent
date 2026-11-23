import "server-only";
import { notFound } from "next/navigation";
import { maybe, from } from "@/server/db";
import { getAuthUser, ensureAppUser } from "@/modules/auth/session";

/** The signed-in platform admin, or null. Reads the flag from the database on every call (never from the token). */
export async function getSuperAdmin() {
  const u = await getAuthUser();
  if (!u) return null;
  await ensureAppUser(u);
  const row = await maybe<{ id: string; email: string; isSuperAdmin: boolean }>(from("User").select("id, email, isSuperAdmin").eq("id", u.id).maybeSingle());
  return row?.isSuperAdmin ? row : null;
}

/** For pages: anyone who isn't a platform admin sees a plain 404, so /admin's existence isn't advertised. */
export async function requireSuperAdmin() {
  const a = await getSuperAdmin();
  if (!a) notFound();
  return a;
}
