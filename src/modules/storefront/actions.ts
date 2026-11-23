"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { from, maybe, must, run, type Json } from "@/server/db";
import { action } from "@/modules/tenancy/context";

const url = z.string().trim().max(500).refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "Enter a full link starting with https://");
const handle = z.string().trim().max(200);

const StorefrontInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoUrl: url,
  coverUrl: url,
  social: z.object({ instagram: handle, tiktok: handle, facebook: handle, website: url }),
});
export type StorefrontInput = z.input<typeof StorefrontInput>;

export async function saveStorefront(input: StorefrontInput) {
  return action("ADMIN", async (ctx) => {
    const r = StorefrontInput.safeParse(input);
    if (!r.success) return { error: r.error.issues[0]?.message ?? "Please check the form" };
    const d = r.data;
    const existing = await maybe<{ settings: Json | null }>(ctx.db.from("Storefront").select("settings").maybeSingle());
    const settings = { ...((existing?.settings as Record<string, unknown> | null) ?? {}), social: d.social };
    const data = { name: d.name, description: d.description || null, brandColor: d.brandColor, logoUrl: d.logoUrl || null, coverUrl: d.coverUrl || null, settings };
    await run(ctx.db.from("Storefront").upsert(data, { onConflict: "organizationId" }));
    revalidatePath("/dashboard/storefront");
    return { error: null };
  });
}

export async function setStorefrontPublished(published: boolean) {
  return action("ADMIN", async (ctx) => {
    const p = z.boolean().parse(published);
    const org = await must<{ slug: string; name: string }>(from("Organization").select("slug, name").eq("id", ctx.organizationId).single());
    // Create the storefront (named after the org) if missing, then set the flag; an existing name is left untouched.
    await run(ctx.db.from("Storefront").upsert({ name: org.name, published: p }, { onConflict: "organizationId", ignoreDuplicates: true }));
    await run(ctx.db.from("Storefront").update({ published: p }));
    await run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: p ? "storefront.published" : "storefront.unpublished", entity: "storefront" }));
    revalidatePath("/dashboard/storefront");
    revalidatePath(`/store/${org.slug}`);
    return p;
  });
}
