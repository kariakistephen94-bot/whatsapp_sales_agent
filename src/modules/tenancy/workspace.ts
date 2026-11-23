"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { from, maybe } from "@/server/db";
import { getAuthUser } from "@/modules/auth/session";
import { WORKSPACE_COOKIE } from "./workspace-cookie";

/** Switch which workspace the signed-in user is working in. Only workspaces they belong to are accepted. */
export async function switchWorkspace(organizationId: string) {
  const u = await getAuthUser();
  if (!u) redirect("/login");
  const m = await maybe<{ organizationId: string }>(from("Membership").select("organizationId").eq("userId", u.id).eq("organizationId", String(organizationId)).maybeSingle());
  if (!m) return { ok: false as const, error: "You don't belong to that workspace." };
  (await cookies()).set(WORKSPACE_COOKIE, m.organizationId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}
