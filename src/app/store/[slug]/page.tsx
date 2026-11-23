import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { maybe, tenant } from "@/server/db";
import { getAuthUser } from "@/modules/auth/session";
import { getPublicStore } from "@/modules/storefront/public";
import { PublicStoreView } from "@/components/store/public-store";

export const dynamic = "force-dynamic";

const load = cache(async (slug: string, preview: boolean) => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const store = await getPublicStore(slug);
  if (!store) return null;
  if (store.published) return { store, preview: false };
  if (!preview) return null;
  // Drafts are visible only to signed-in members of the workspace.
  const user = await getAuthUser().catch(() => null);
  if (!user) return null;
  const member = await maybe<{ id: string }>(tenant(store.organizationId).from("Membership").select("id").eq("userId", user.id).limit(1).maybeSingle());
  return member ? { store, preview: true } : null;
});

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const r = await load(slug, sp.preview === "1");
  if (!r) return { title: "Store not found", robots: { index: false } };
  const { store } = r;
  const description = store.description ?? `Shop and book with ${store.name} — chat with us on WhatsApp.`;
  return {
    title: store.name, description,
    robots: r.preview ? { index: false, follow: false } : undefined,
    openGraph: { title: store.name, description, images: store.coverUrl ? [store.coverUrl] : store.logoUrl ? [store.logoUrl] : undefined },
    icons: store.logoUrl ? { icon: store.logoUrl } : undefined,
  };
}

export default async function StorePage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const r = await load(slug, sp.preview === "1");
  if (!r) notFound();
  const { organizationId: _omit, ...store } = r.store; // never send internal ids to the browser
  void _omit;
  return <PublicStoreView store={store} preview={r.preview} />;
}
