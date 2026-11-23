"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { from, maybe, run } from "@/server/db";
import { getSuperAdmin } from "./guard";

type Result = { ok: true } | { ok: false; error: string };
const Id = z.string().min(1).max(64);

async function admin<T extends Result>(fn: (adminId: string) => Promise<T>): Promise<Result> {
  const a = await getSuperAdmin();
  if (!a) return { ok: false, error: "Not allowed" };
  try { return await fn(a.id); }
  catch (e) { return { ok: false, error: e instanceof z.ZodError ? "Invalid input" : (e as Error).message }; }
}
const audit = (organizationId: string, actorId: string, action: string, meta?: unknown) =>
  run(from("AuditLog").insert({ organizationId, actorId, action, entity: "organization", entityId: organizationId, meta: meta ?? null }));
const refresh = (id: string) => { revalidatePath("/admin"); revalidatePath("/admin/workspaces"); revalidatePath(`/admin/workspaces/${id}`); };

export async function setWorkspaceStatus(orgId: string, status: "ACTIVE" | "SUSPENDED") {
  return admin(async (adminId) => {
    const id = Id.parse(orgId), st = z.enum(["ACTIVE", "SUSPENDED"]).parse(status);
    const rows = await run<{ id: string }[]>(from("Organization").update({ status: st }).eq("id", id).select("id"));
    if (!rows.length) return { ok: false, error: "Workspace not found" } as const;
    await audit(id, adminId, st === "SUSPENDED" ? "admin.suspended" : "admin.reactivated");
    refresh(id);
    return { ok: true } as const;
  });
}

/** Moves a workspace to any plan without payment (comps, enterprise deals, support fixes). */
export async function setWorkspacePlan(orgId: string, planKey: string, days: number) {
  return admin(async (adminId) => {
    const id = Id.parse(orgId), key = z.string().min(1).max(40).parse(planKey), d = z.number().int().min(1).max(3650).parse(days);
    const plan = await maybe<{ id: string }>(from("Plan").select("id").eq("key", key).maybeSingle());
    if (!plan) return { ok: false, error: "Plan not found" } as const;
    const end = new Date(Date.now() + d * 864e5).toISOString();
    const isTrial = key === "trial";
    await run(from("Subscription").upsert(
      { organizationId: id, planId: plan.id, status: isTrial ? "trialing" : "active", trialEndsAt: isTrial ? end : null, currentPeriodEnd: isTrial ? null : end },
      { onConflict: "organizationId" },
    ));
    if (!isTrial) await run(from("Organization").update({ status: "ACTIVE" }).eq("id", id).in("status", ["TRIAL", "CANCELLED"]));
    await audit(id, adminId, "admin.plan_set", { plan: key, days: d });
    refresh(id);
    return { ok: true } as const;
  });
}

export async function extendWorkspace(orgId: string, days: number) {
  return admin(async (adminId) => {
    const id = Id.parse(orgId), d = z.number().int().min(1).max(365).parse(days);
    const sub = await maybe<{ id: string; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null }>(from("Subscription").select("id, status, trialEndsAt, currentPeriodEnd").eq("organizationId", id).maybeSingle());
    if (!sub) return { ok: false, error: "No subscription to extend" } as const;
    const trial = sub.status === "trialing" || (sub.status === "expired" && !sub.currentPeriodEnd);
    const cur = (trial ? sub.trialEndsAt : sub.currentPeriodEnd) ?? new Date();
    const end = new Date(Math.max(cur.getTime(), Date.now()) + d * 864e5).toISOString();
    await run(from("Subscription").update(trial ? { trialEndsAt: end, status: "trialing" } : { currentPeriodEnd: end, status: "active" }).eq("id", sub.id));
    await audit(id, adminId, "admin.extended", { days: d });
    refresh(id);
    return { ok: true } as const;
  });
}
