"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { from, isUniqueViolation, maybe, must, rpc, run, type Customer, type Json, type Tag } from "@/server/db";
import { action, UserError, type TenantContext } from "@/modules/tenancy/context";
import { normalizeNgPhone } from "@/lib/locale";

const id = z.string().min(1).max(64);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optionalEmail = z.string().trim().max(200).optional()
  .refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email address")
  .transform((v) => (v ? v.toLowerCase() : null));

async function findCustomer(ctx: TenantContext, customerId: string) {
  const c = await maybe<Customer>(ctx.db.from("Customer").select("*").eq("id", id.parse(customerId)).maybeSingle());
  if (!c) throw new UserError("Customer not found");
  return c;
}

function revalidateCustomer(customerId: string) {
  revalidatePath("/dashboard/customers");
  revalidatePath(`/dashboard/customers/${customerId}`);
  revalidatePath("/dashboard/conversations");
}

const zodMessage = (e: z.ZodError) => e.issues[0]?.message ?? "Please check the form and try again.";

export async function createCustomer(input: { name: string; phone: string; email?: string; notes?: string }) {
  return action("STAFF", async (ctx) => {
    const parsed = z.object({
      name: z.string().trim().min(1, "Name is required").max(120),
      phone: z.string().trim().min(1, "Phone is required").max(40),
      email: optionalEmail,
      notes: optionalText(2000),
    }).safeParse(input);
    if (!parsed.success) throw new UserError(zodMessage(parsed.error));
    const phone = normalizeNgPhone(parsed.data.phone);
    if (!phone) throw new UserError("Enter a valid phone number, e.g. 0803 123 4567 or +234 803 123 4567");

    const existing = await maybe<{ id: string; name: string | null }>(ctx.db.from("Customer").select("id, name").eq("phone", phone).limit(1).maybeSingle());
    if (existing) throw new UserError(`${existing.name || "A customer"} already uses ${phone}. Open their profile instead.`);
    try {
      const c = await must<{ id: string }>(ctx.db.from("Customer").insert({
        name: parsed.data.name, phone, email: parsed.data.email, notes: parsed.data.notes, source: "manual",
      }).select("id").single());
      revalidatePath("/dashboard/customers");
      return { id: c.id };
    } catch (e) {
      if (isUniqueViolation(e)) throw new UserError(`A customer with ${phone} already exists.`);
      throw e;
    }
  });
}

export async function updateCustomer(customerId: string, input: { name: string; email?: string; notes?: string }) {
  return action("STAFF", async (ctx) => {
    const c = await findCustomer(ctx, customerId);
    const parsed = z.object({ name: optionalText(120), email: optionalEmail, notes: optionalText(2000) }).safeParse(input);
    if (!parsed.success) throw new UserError(zodMessage(parsed.error));
    await run(ctx.db.from("Customer").update(parsed.data).eq("id", c.id));
    revalidateCustomer(c.id);
    return { id: c.id };
  });
}

export async function addCustomerTag(customerId: string, tagName: string) {
  return action("STAFF", async (ctx) => {
    const c = await findCustomer(ctx, customerId);
    const name = z.string().trim().min(1, "Enter a tag").max(40, "Tags can be up to 40 characters").safeParse(tagName.replace(/\s+/g, " "));
    if (!name.success) throw new UserError(zodMessage(name.error));
    // Find-or-create the tag (re-setting name to the same value on conflict returns the existing row).
    const tag = await must<Tag>(ctx.db.from("Tag").upsert({ name: name.data }, { onConflict: "organizationId,name" }).select().single());
    // customerId is org-verified above and the tag belongs to this org, so this link is tenant-safe.
    await run(from("CustomerTag").upsert({ customerId: c.id, tagId: tag.id }, { onConflict: "customerId,tagId", ignoreDuplicates: true }));
    revalidateCustomer(c.id);
    return { id: tag.id, name: tag.name };
  });
}

export async function removeCustomerTag(customerId: string, tagId: string) {
  return action("STAFF", async (ctx) => {
    const c = await findCustomer(ctx, customerId);
    // customerId is org-verified above, so this delete can't touch another tenant's rows.
    await run(from("CustomerTag").delete().eq("customerId", c.id).eq("tagId", id.parse(tagId)));
    revalidateCustomer(c.id);
    return { ok: true };
  });
}

const prefList = (p: Json | null): string[] => {
  const notes = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>).notes : null;
  return Array.isArray(notes) ? notes.map(String) : [];
};

export async function addCustomerPreference(customerId: string, text: string) {
  return action("STAFF", async (ctx) => {
    const c = await findCustomer(ctx, customerId);
    const t = z.string().trim().min(1, "Write a preference first").max(200).safeParse(text);
    if (!t.success) throw new UserError(zodMessage(t.error));
    const base = c.preferences && typeof c.preferences === "object" && !Array.isArray(c.preferences) ? (c.preferences as Record<string, Json>) : {};
    const notes = [...prefList(c.preferences), t.data].slice(-30);
    await run(ctx.db.from("Customer").update({ preferences: { ...base, notes } }).eq("id", c.id));
    revalidateCustomer(c.id);
    return { notes };
  });
}

export async function removeCustomerPreference(customerId: string, index: number, text: string) {
  return action("STAFF", async (ctx) => {
    const c = await findCustomer(ctx, customerId);
    const list = prefList(c.preferences);
    // Match index + text so a concurrent AI edit can't make us delete the wrong entry.
    const i = list[index] === text ? index : list.indexOf(text);
    if (i < 0) throw new UserError("That preference was already removed");
    const base = c.preferences && typeof c.preferences === "object" && !Array.isArray(c.preferences) ? (c.preferences as Record<string, Json>) : {};
    const notes = list.filter((_, j) => j !== i);
    await run(ctx.db.from("Customer").update({ preferences: { ...base, notes } }).eq("id", c.id));
    revalidateCustomer(c.id);
    return { notes };
  });
}

export async function setCustomerOptOut(customerId: string, optedOut: boolean) {
  return action("STAFF", async (ctx) => {
    const c = await findCustomer(ctx, customerId);
    const value = z.boolean().parse(optedOut);
    await run(ctx.db.from("Customer").update({ optedOut: value, ...(value ? {} : { consentAt: new Date().toISOString() }) }).eq("id", c.id));
    await run(ctx.db.from("AuditLog").insert({
      actorId: ctx.userId, action: value ? "customer.opted_out" : "customer.opted_in", entity: "customer", entityId: c.id, meta: { by: "staff" },
    }));
    revalidateCustomer(c.id);
    return { optedOut: value };
  });
}

/** ADMIN only. Removes the customer and everything that references them, in one transaction. */
export async function deleteCustomer(customerId: string) {
  return action("ADMIN", async (ctx) => {
    const c = await findCustomer(ctx, customerId);
    // app_delete_customer deletes appointments, order items, orders, conversations and the customer and
    // writes the audit log in one database transaction (all or nothing), scoped to this organization.
    const r = await rpc<{ ok: boolean; error?: string }>("app_delete_customer", {
      p_org: ctx.organizationId, p_customer_id: c.id, p_actor_id: ctx.userId,
    });
    if (!r?.ok) throw new UserError("Customer not found");
    revalidatePath("/dashboard/customers");
    revalidatePath("/dashboard/conversations");
    return { ok: true };
  });
}
