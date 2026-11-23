"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { count, from, maybe, must, rpc, run, type Role } from "@/server/db";
import { notifyQueue } from "@/server/queue";
import { normalizeNgPhone } from "@/lib/locale";
import { logger } from "@/server/logger";
import { action, hasRole, UserError, type TenantContext } from "@/modules/tenancy/context";
import { planLimits } from "@/modules/billing/usage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DAYS, hoursProblem } from "@/modules/appointments/hours";

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Please check the form and try again.");
  return r.data;
}

async function audit(ctx: TenantContext, act: string, entity: string, entityId: string, meta?: Record<string, unknown>) {
  await run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: act, entity, entityId, meta: meta ?? null })).catch(() => {});
}

// ───────── Members & invitations ─────────

export type InviteOutcome = "sent" | "existing_user" | "not_configured" | "failed";
export type WhatsappOutcome = "queued" | "not_connected";

const APP_URL = () => process.env.APP_URL ?? "http://localhost:3000";
const phoneField = z.string().trim().min(1, "Enter their WhatsApp number").transform((v, c) => {
  const n = normalizeNgPhone(v);
  if (!n) c.addIssue({ code: "custom", message: "Enter a valid WhatsApp number, e.g. 0803 123 4567" });
  return n ?? "";
});

export async function inviteMember(input: { email: string; phone: string; role: "ADMIN" | "STAFF" }) {
  return action("ADMIN", async (ctx) => {
    const d = parse(z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address"), phone: phoneField, role: z.enum(["ADMIN", "STAFF"]) }), input);

    const member = await maybe<{ id: string }>(
      ctx.db.from("Membership").select("id, user:User!inner(email)").eq("user.email", d.email).limit(1).maybeSingle(),
    );
    if (member) throw new UserError("That person is already on your team.");
    const samePhone = await maybe<{ id: string }>(ctx.db.from("Membership").select("id").eq("phone", d.phone).limit(1).maybeSingle());
    if (samePhone) throw new UserError("Someone on your team already uses that WhatsApp number.");

    const pending = await maybe<{ id: string }>(
      ctx.db.from("Invitation").select("id").eq("email", d.email).is("acceptedAt", null).limit(1).maybeSingle(),
    );
    if (!pending) {
      const max = (await planLimits(ctx.organizationId)).teamMembers;
      if (max !== -1) {
        const [members, invites] = await Promise.all([
          count(ctx.db.from("Membership").select("*", { count: "exact", head: true })),
          count(ctx.db.from("Invitation").select("*", { count: "exact", head: true }).is("acceptedAt", null)),
        ]);
        if (members + invites >= max) throw new UserError(`Your plan allows ${max} team member${max === 1 ? "" : "s"} (including pending invitations). Upgrade your plan or revoke an invitation first.`);
      }
    }

    // Insert, or re-issue an existing invitation for this email (fresh role, phone, link, inviter; not accepted).
    const token = randomBytes(24).toString("base64url");
    const inv = await must<{ id: string }>(
      ctx.db.from("Invitation").upsert(
        {
          email: d.email, phone: d.phone, role: d.role, invitedById: ctx.userId, acceptedAt: null, createdAt: new Date().toISOString(),
          token, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        },
        { onConflict: "organizationId,email" },
      ).select("id").single(),
    );

    // Email invite (Supabase). Remember the auth user it creates so the WhatsApp join link can activate it.
    let outcome: InviteOutcome = "sent";
    let admin;
    try { admin = supabaseAdmin(); } catch { outcome = "not_configured"; }
    if (admin) {
      try {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(d.email, { redirectTo: `${APP_URL()}/auth/callback?next=/dashboard` });
        if (error) {
          const already = error.status === 422 || /already|registered|exists/i.test(error.message);
          outcome = already ? "existing_user" : "failed";
          if (!already) logger.warn({ err: error }, "supabase invite failed");
        } else if (data.user) {
          await run(ctx.db.from("Invitation").update({ authUserId: data.user.id }).eq("id", inv.id));
        }
      } catch (e) {
        logger.warn({ err: e }, "supabase invite threw");
        outcome = "failed";
      }
    }

    // WhatsApp invite from the business number, with a private join link.
    const org = await must<{ name: string }>(from("Organization").select("name").eq("id", ctx.organizationId).single());
    const inviter = await maybe<{ name: string | null }>(from("User").select("name").eq("id", ctx.userId).maybeSingle());
    const connected = await count(ctx.db.from("WhatsappConnection").select("*", { count: "exact", head: true }).eq("status", "connected"));
    let whatsapp: WhatsappOutcome = "not_connected";
    if (connected) {
      const text = `Hi! ${inviter?.name ?? "Your team"} has added you to ${org.name} as ${d.role === "ADMIN" ? "an admin" : "a staff member"}.\n\n`
        + `Tap to join and set your password:\n${APP_URL()}/join/${token}\n\n`
        + `You'll get WhatsApp alerts on this number when a customer needs a person. The link expires in 7 days.`;
      await notifyQueue().add("invite", { organizationId: ctx.organizationId, to: d.phone, text, kind: "invite" }, { attempts: 3 });
      whatsapp = "queued";
    }

    await audit(ctx, "invitation.created", "invitation", inv.id, { email: d.email, role: d.role, outcome, whatsapp });
    revalidatePath("/dashboard/team");
    return { outcome, whatsapp };
  });
}

/** Set a member's WhatsApp number and whether they get hand-off alerts. Admins can edit anyone; staff only themselves. */
export async function updateMemberContact(membershipId: string, input: { phone: string; notifyHandoffs: boolean }) {
  return action("STAFF", async (ctx) => {
    const d = parse(z.object({ phone: phoneField, notifyHandoffs: z.boolean() }), input);
    const m = await maybe<{ id: string; userId: string }>(ctx.db.from("Membership").select("id, userId").eq("id", String(membershipId)).maybeSingle());
    if (!m) throw new UserError("Member not found");
    if (m.userId !== ctx.userId && !hasRole(ctx.role, "ADMIN")) throw new UserError("You can only change your own number.");
    const clash = await maybe<{ id: string }>(ctx.db.from("Membership").select("id").eq("phone", d.phone).neq("id", m.id).limit(1).maybeSingle());
    if (clash) throw new UserError("Someone else on your team already uses that WhatsApp number.");
    await run(ctx.db.from("Membership").update({ phone: d.phone, notifyHandoffs: d.notifyHandoffs }).eq("id", m.id));
    await audit(ctx, "member.contact_updated", "membership", m.id, { notifyHandoffs: d.notifyHandoffs });
    revalidatePath("/dashboard/team");
    revalidatePath("/dashboard");
    return { phone: d.phone };
  });
}

export async function revokeInvitation(id: string) {
  return action("ADMIN", async (ctx) => {
    const inv = await maybe<{ id: string; email: string }>(
      ctx.db.from("Invitation").select("id, email").eq("id", String(id)).is("acceptedAt", null).maybeSingle(),
    );
    if (!inv) throw new UserError("Invitation not found or already accepted");
    await run(ctx.db.from("Invitation").delete().eq("id", inv.id));
    await audit(ctx, "invitation.revoked", "invitation", inv.id, { email: inv.email });
    revalidatePath("/dashboard/team");
    return { revoked: true };
  });
}

export async function changeMemberRole(membershipId: string, role: "ADMIN" | "STAFF") {
  return action("ADMIN", async (ctx) => {
    const r = parse(z.enum(["ADMIN", "STAFF"]), role);
    const m = await maybe<{ id: string; userId: string; role: Role }>(
      ctx.db.from("Membership").select("id, userId, role").eq("id", String(membershipId)).maybeSingle(),
    );
    if (!m) throw new UserError("Member not found");
    if (m.role === "OWNER") throw new UserError("The owner's role can't be changed.");
    if (m.userId === ctx.userId) throw new UserError("You can't change your own role. Ask another admin or the owner.");
    if (m.role === r) return { role: r };
    await run(ctx.db.from("Membership").update({ role: r }).eq("id", m.id));
    await audit(ctx, "member.role_changed", "membership", m.id, { userId: m.userId, from: m.role, to: r });
    revalidatePath("/dashboard/team");
    return { role: r };
  });
}

export async function removeMember(membershipId: string) {
  return action("ADMIN", async (ctx) => {
    const m = await maybe<{ id: string; userId: string; role: Role; user: { email: string } }>(
      ctx.db.from("Membership").select("id, userId, role, user:User!inner(email)").eq("id", String(membershipId)).maybeSingle(),
    );
    if (!m) throw new UserError("Member not found");
    if (m.role === "OWNER") throw new UserError("The owner can't be removed.");
    if (m.userId === ctx.userId) throw new UserError("You can't remove yourself.");
    // Delete the membership and drop the accepted invitation (so they don't silently rejoin), in one transaction.
    // A new invite can be sent later.
    await rpc("app_remove_member", { p_organization_id: ctx.organizationId, p_membership_id: m.id, p_email: m.user.email });
    await audit(ctx, "member.removed", "membership", m.id, { userId: m.userId, email: m.user.email });
    revalidatePath("/dashboard/team");
    return { removed: true };
  });
}

// ───────── Bookable staff ─────────

const time = z.string().regex(/^\d{2}:\d{2}$/);
const windowSchema = z.object({ start: time, end: time }).refine((w) => w.start < w.end, "Each day's end time must be after its start time");
const hoursSchema = z.object(Object.fromEntries(DAYS.map((d) => [d, z.array(windowSchema).max(4).optional()])) as Record<(typeof DAYS)[number], z.ZodOptional<z.ZodArray<typeof windowSchema>>>);

const staffSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Enter the staff member's name").max(80),
  role: z.string().trim().max(60).optional(),
  serviceIds: z.array(z.string()).max(500).default([]),
  workingHours: hoursSchema,
  active: z.boolean().default(true),
});

export async function saveStaffMember(input: z.input<typeof staffSchema>) {
  return action("ADMIN", async (ctx) => {
    const d = parse(staffSchema, input);
    // Only keep ids of this org's services.
    const valid = d.serviceIds.length
      ? (await run<{ id: string }[]>(ctx.db.from("CatalogItem").select("id").in("id", d.serviceIds).eq("kind", "SERVICE"))).map((s) => s.id)
      : [];
    const bad = hoursProblem(d.workingHours as any); if (bad) throw new UserError(`Fix the working hours. ${bad}`);
    const hours = Object.fromEntries(DAYS.map((day) => [day, d.workingHours[day] ?? []]));
    const data = { name: d.name, role: d.role || null, serviceIds: valid, workingHours: hours, active: d.active };
    let id = d.id;
    if (id) {
      const s = await maybe<{ id: string }>(ctx.db.from("StaffMember").select("id").eq("id", id).maybeSingle());
      if (!s) throw new UserError("Staff member not found");
      await run(ctx.db.from("StaffMember").update(data).eq("id", s.id));
    } else {
      id = (await must<{ id: string }>(ctx.db.from("StaffMember").insert(data).select("id").single())).id;
    }
    await audit(ctx, d.id ? "staff.updated" : "staff.created", "staff", id, { name: d.name });
    revalidatePath("/dashboard/team");
    revalidatePath("/dashboard/appointments");
    return { id };
  });
}

export async function setStaffActive(id: string, active: boolean) {
  return action("ADMIN", async (ctx) => {
    const r = await run<{ id: string }[]>(ctx.db.from("StaffMember").update({ active: !!active }).eq("id", String(id)).select("id"));
    if (r.length !== 1) throw new UserError("Staff member not found");
    await audit(ctx, active ? "staff.activated" : "staff.deactivated", "staff", String(id));
    revalidatePath("/dashboard/team");
    revalidatePath("/dashboard/appointments");
    return { active: !!active };
  });
}

/** Deletes staff with no appointment history; otherwise deactivates them so past bookings stay intact. */
export async function deleteStaffMember(id: string) {
  return action("ADMIN", async (ctx) => {
    const s = await maybe<{ id: string; name: string }>(ctx.db.from("StaffMember").select("id, name").eq("id", String(id)).maybeSingle());
    if (!s) throw new UserError("Staff member not found");
    const appointments = await count(ctx.db.from("Appointment").select("*", { count: "exact", head: true }).eq("staffId", s.id));
    const deactivated = appointments > 0;
    if (deactivated) await run(ctx.db.from("StaffMember").update({ active: false }).eq("id", s.id));
    else await run(ctx.db.from("StaffMember").delete().eq("id", s.id));
    await audit(ctx, deactivated ? "staff.deactivated" : "staff.deleted", "staff", s.id, { name: s.name });
    revalidatePath("/dashboard/team");
    revalidatePath("/dashboard/appointments");
    return { deactivated };
  });
}
