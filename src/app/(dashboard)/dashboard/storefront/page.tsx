import { from, must, run, type Storefront } from "@/server/db";
import { getTenantContext } from "@/modules/tenancy/context";
import { getPublicStore } from "@/modules/storefront/public";
import { StorefrontEditor } from "@/components/store/storefront-editor";

export const dynamic = "force-dynamic";

export default async function StorefrontPage() {
  const ctx = await getTenantContext("ADMIN");
  const org = await must<{ slug: string; name: string }>(from("Organization").select("slug, name").eq("id", ctx.organizationId).single());
  await run(ctx.db.from("Storefront").upsert({ name: org.name }, { onConflict: "organizationId", ignoreDuplicates: true }));
  const store = await getPublicStore(org.slug);
  if (!store) return <p className="text-sm text-muted">The storefront isn’t available for this workspace right now.</p>;
  const { organizationId: _o, ...data } = store;
  void _o;
  const sf = await must<Storefront>(ctx.db.from("Storefront").select("*").single());
  const social = ((sf.settings as any)?.social ?? {}) as Record<string, string>;

  return (
    <StorefrontEditor
      store={data}
      initial={{
        name: sf.name ?? org.name, description: sf.description ?? "", brandColor: /^#[0-9a-fA-F]{6}$/.test(sf.brandColor) ? sf.brandColor : "#111111",
        logoUrl: sf.logoUrl ?? "", coverUrl: sf.coverUrl ?? "",
        social: { instagram: social.instagram ?? "", tiktok: social.tiktok ?? "", facebook: social.facebook ?? "", website: social.website ?? "" },
      }}
    />
  );
}
