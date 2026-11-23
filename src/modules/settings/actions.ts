"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { from, must, rpc, run } from "@/server/db";
import { action, UserError } from "@/modules/tenancy/context";
import { asHours, hoursProblem, type WeeklyHours } from "@/modules/appointments/hours";
import { normalizeNgPhone } from "@/lib/locale";
import { supabaseConfigured, supabaseServer } from "@/lib/supabase/server";
import { controlQueue } from "@/server/queue";
import { logger } from "@/server/logger";

const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);

const Profile = z.object({
  name: z.string().trim().min(2, "Business name is too short").max(80),
  description: opt(1000),
  email: z.string().trim().max(200).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email").transform((v) => v || null),
  phone: z.string().trim().max(30),
  address: opt(300),
  city: opt(80),
  website: z.string().trim().max(300).refine((v) => !v || /^https?:\/\/\S+\.\S+/i.test(v), "Website must start with https://").transform((v) => v || null),
});
export type ProfileInput = z.input<typeof Profile>;

export async function updateProfile(input: ProfileInput) {
  return action("ADMIN", async (ctx) => {
    const r = Profile.safeParse(input);
    if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Please check the form");
    const d = r.data;
    let phone: string | null = null;
    if (d.phone) {
      phone = normalizeNgPhone(d.phone);
      if (!phone) throw new UserError("Enter a valid phone number, e.g. 0803 123 4567");
    }
    const before = await must<{ name: string; description: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; website: string | null }>(
      from("Organization").select("name, description, email, phone, address, city, website").eq("id", ctx.organizationId).single(),
    );
    const next = { ...d, phone };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (before[k] ?? null) !== (next[k] ?? null));
    if (!changed.length) return { phone };
    // Organization update + audit row in one transaction.
    await rpc("app_update_org_settings", {
      p_organization_id: ctx.organizationId, p_actor_id: ctx.userId, p_fields: next,
      p_action: "settings.profile_updated", p_meta: { fields: changed },
    });
    revalidatePath("/dashboard", "layout");
    return { phone };
  });
}

export async function updateBusinessHours(hours: WeeklyHours) {
  return action("ADMIN", async (ctx) => {
    const bad = hoursProblem(hours); if (bad) throw new UserError(bad);
    const clean = asHours(hours);
    // asHours drops invalid windows; reject instead of silently saving something different.
    const submitted = Object.values(hours ?? {}).reduce((n, w) => n + (Array.isArray(w) ? w.length : 0), 0);
    const kept = clean ? Object.values(clean).reduce((n, w) => n + (w?.length ?? 0), 0) : 0;
    if (submitted !== kept) throw new UserError("Each day's closing time must be after its opening time");
    const value = clean ?? { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    await rpc("app_update_org_settings", {
      p_organization_id: ctx.organizationId, p_actor_id: ctx.userId, p_fields: { businessHours: value },
      p_action: "settings.hours_updated", p_meta: null,
    });
    revalidatePath("/dashboard/settings");
    return true;
  });
}

/**
 * Permanently deletes the workspace (OWNER only, must type the exact name). Rows that reference
 * customers/catalog with RESTRICT foreign keys are removed first, then the organization cascades.
 */
export async function deleteWorkspace(confirmName: string) {
  const res = await action("OWNER", async (ctx) => {
    const org = await must<{ id: string; name: string }>(from("Organization").select("id, name").eq("id", ctx.organizationId).single());
    if (z.string().parse(confirmName).trim() !== org.name.trim()) throw new UserError("The name you typed doesn't match the workspace name");

    const conns = await run<{ id: string }[]>(ctx.db.from("WhatsappConnection").select("id"));
    for (const c of conns) {
      try { await controlQueue().add("logout", { connectionId: c.id, action: "logout" }); }
      catch (e) { logger.warn({ err: e }, "could not queue WhatsApp logout during workspace deletion"); }
    }

    // Orders, appointments, conversations, messages, dashboard prefs, audit row, then the org (cascade), in one transaction.
    await rpc("app_delete_organization", { p_organization_id: org.id, p_actor_id: ctx.userId });
    return true;
  });
  if (!res.ok) return res;
  if (supabaseConfigured()) await (await supabaseServer()).auth.signOut().catch(() => {});
  redirect("/login?deleted=1");
}

const OfferingInput = z.object({ products: z.boolean(), services: z.boolean(), menu: z.boolean(), inventory: z.boolean() });
// Capabilities this screen owns. Anything else (delivery, reservations…) is left exactly as it was.
const MANAGED = ["products", "services", "menu", "appointments", "orders", "inventory"];

/**
 * Change what the business offers (products, services, menu) at any time. Updates the workspace capabilities,
 * which drive the sidebar, the catalogue tabs, the automations shown and the tools the AI may use.
 * Existing catalogue items are never deleted.
 */
export async function saveOffering(input: z.input<typeof OfferingInput>) {
  return action("ADMIN", async (ctx) => {
    const d = OfferingInput.parse(input);
    if (!d.products && !d.services && !d.menu) throw new UserError("Choose at least one: products, services or menu");
    const { toolsForCapabilities } = await import("@/modules/industries/templates");
    const before = ctx.capabilities;
    const kept = before.filter((c) => !MANAGED.includes(c));
    const next = [
      ...kept,
      ...(d.products ? ["products", "orders"] : []),
      ...(d.menu ? ["menu", "orders"] : []),
      ...(d.services ? ["services", "appointments"] : []),
      ...(d.inventory && (d.products || d.menu) ? ["inventory"] : []),
    ];
    const caps = [...new Set(next)];

    // The AI agent keeps its own list of enabled tools: add tools that just became possible, drop ones that no longer apply.
    const oldAllowed = toolsForCapabilities(before) as string[];
    const newAllowed = toolsForCapabilities(caps) as string[];
    const agent = await from("AiAgent").select("enabledTools").eq("organizationId", ctx.organizationId).maybeSingle();
    const enabled = (agent.data?.enabledTools as string[] | null) ?? [];
    const tools = [...new Set([...enabled.filter((t) => newAllowed.includes(t)), ...newAllowed.filter((t) => !oldAllowed.includes(t))])];

    await run(from("Organization").update({ capabilities: caps }).eq("id", ctx.organizationId));
    if (agent.data) await run(from("AiAgent").update({ enabledTools: tools }).eq("organizationId", ctx.organizationId));
    await run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: "settings.offering_updated", entity: "organization", meta: { from: before, to: caps } }));
    revalidatePath("/dashboard", "layout");
    return { capabilities: caps };
  });
}
