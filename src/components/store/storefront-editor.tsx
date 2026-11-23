"use client";
import { WriteWithAi } from "@/components/agent/write-with-ai";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, ExternalLink, ImagePlus, Loader2, MapPin, MessageCircle, Trash2 } from "lucide-react";
import { Badge, Card, PageHeader, btn, btnPrimary, inputCls } from "@/components/ui";
import { formatKobo } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { saveStorefront, setStorefrontPublished, type StorefrontInput } from "@/modules/storefront/actions";
import type { PublicStore } from "@/modules/storefront/public";
import { onColor } from "./public-store";

type Form = { name: string; description: string; brandColor: string; logoUrl: string; coverUrl: string; social: { instagram: string; tiktok: string; facebook: string; website: string } };
const SWATCHES = ["#111111", "#0f766e", "#1d4ed8", "#7c3aed", "#be185d", "#c2410c", "#a16207", "#15803d"];

function Upload({ label, value, onChange, aspect }: { label: string; value: string; onChange: (v: string) => void; aspect: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pick(f: File | undefined) {
    if (!f) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) return setError("Use PNG, JPEG or WebP");
    if (f.size > 3 * 1024 * 1024) return setError("Max 3 MB");
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await fetch("/api/uploads", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error ?? "Upload failed"); else onChange(j.url);
    } catch { setError("Upload failed"); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  }
  return (
    <div>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <div className={cn("relative flex items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-bg", aspect)}>
        {value ? <img src={value} alt="" className="size-full object-cover" /> : <ImagePlus size={18} className="text-muted" />}
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-surface/70"><Loader2 size={16} className="animate-spin" /></div>}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <button type="button" className={cn(btn, "px-2 py-1 text-xs")} onClick={() => ref.current?.click()} disabled={busy}>{value ? "Replace" : "Upload"}</button>
        {value && <button type="button" aria-label={`Remove ${label}`} className={cn(btn, "px-2 py-1 text-xs")} onClick={() => onChange("")}><Trash2 size={12} /></button>}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

export function StorefrontEditor({ store, initial }: { store: Omit<PublicStore, never>; initial: Form }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(initial);
  const [saved, setSaved] = useState(initial);
  const [published, setPublished] = useState(store.published);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF((p) => ({ ...p, [k]: v })); setMsg(null); };
  const setSocial = (k: keyof Form["social"], v: string) => set("social", { ...f.social, [k]: v });
  const path = `/store/${store.slug}`;
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);

  const save = () => start(async () => {
    const r = await saveStorefront(f as StorefrontInput);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    if (r.data.error) return setMsg({ ok: false, text: r.data.error });
    setSaved(f); setMsg({ ok: true, text: "Saved" }); router.refresh();
  });
  const togglePublish = () => start(async () => {
    if (!published && dirty) {
      const s = await saveStorefront(f as StorefrontInput);
      if (!s.ok || s.data.error) return setMsg({ ok: false, text: s.ok ? s.data.error! : s.error });
      setSaved(f);
    }
    const r = await setStorefrontPublished(!published);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setPublished(r.data); setMsg({ ok: true, text: r.data ? "Your store is live" : "Store unpublished" });
  });

  const brand = f.brandColor, on = onColor(brand);
  const items = [...store.services, ...store.menu, ...store.products].slice(0, 4);

  return (
    <div>
      <PageHeader title="Storefront" sub="Your public mini-site, built from your catalog."
        actions={<>
          {msg && <span className={cn("text-xs", msg.ok ? "text-success" : "text-danger")}>{msg.text}</span>}
          <a className={btn} href={published ? path : `${path}?preview=1`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{published ? "View store" : "Preview"}</a>
          <button className={btn} onClick={save} disabled={pending || !dirty}>Save</button>
          <button onClick={togglePublish} className={btnPrimary} disabled={pending}>{pending && <Loader2 size={14} className="animate-spin" />}{published ? "Unpublish" : "Publish"}</button>
        </>} />

      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card title="Branding" action={published ? <Badge tone="green">Published</Badge> : <Badge tone="gray">Draft</Badge>}>
            <div className="space-y-3 text-sm">
              <label className="block"><span className="mb-1 block text-xs text-muted">Store name</span><input className={inputCls} maxLength={80} value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
              <label className="block"><span className="mb-1 block text-xs text-muted">Description</span><textarea rows={3} maxLength={600} className={inputCls} value={f.description} placeholder="What you offer, where you are, why customers love you." onChange={(e) => set("description", e.target.value)} /><div className="mt-2"><WriteWithAi kind="field" current={f.description} onApply={(t) => set("description", t)} context={{ fieldType: "textarea", fieldKey: "storeDescription", fieldLabel: "Store description", purpose: "A friendly 2 to 3 sentence storefront blurb for customers: what the business offers, where it is, and why to buy. Only facts the owner gives.", maxChars: "500", related: `Store: ${f.name}` }} /></div></label>
              <div>
                <span className="mb-1 block text-xs text-muted">Brand colour</span>
                <div className="flex flex-wrap items-center gap-2">
                  {SWATCHES.map((c) => <button key={c} type="button" aria-label={c} onClick={() => set("brandColor", c)} className={cn("size-6 rounded-full border-2", brand.toLowerCase() === c ? "border-fg" : "border-transparent")} style={{ background: c }} />)}
                  <input type="color" aria-label="Custom colour" value={brand} onChange={(e) => set("brandColor", e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent" />
                </div>
              </div>
              <div className="grid grid-cols-[96px_1fr] gap-3">
                <Upload label="Logo" value={f.logoUrl} onChange={(v) => set("logoUrl", v)} aspect="aspect-square" />
                <Upload label="Cover image" value={f.coverUrl} onChange={(v) => set("coverUrl", v)} aspect="aspect-[16/9]" />
              </div>
              <div className="rounded-md bg-bg px-3 py-2 text-xs text-muted break-all">{host}{path} · {published ? "Published" : "Draft"}</div>
            </div>
          </Card>

          <Card title="Social links">
            <div className="space-y-3 text-sm">
              {(["instagram", "tiktok", "facebook"] as const).map((k) => (
                <label key={k} className="block"><span className="mb-1 block text-xs capitalize text-muted">{k}</span><input className={inputCls} maxLength={200} placeholder="@yourhandle" value={f.social[k]} onChange={(e) => setSocial(k, e.target.value)} /></label>
              ))}
              <label className="block"><span className="mb-1 block text-xs text-muted">Website</span><input className={inputCls} maxLength={500} placeholder="https://" value={f.social.website} onChange={(e) => setSocial("website", e.target.value)} /></label>
            </div>
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-muted"><span>Live preview</span>{dirty && <span className="text-amber-600 dark:text-amber-400">Unsaved changes</span>}</div>
          <div className="overflow-hidden rounded-lg border border-border bg-bg">
            <div className="h-32 overflow-hidden sm:h-40" style={{ background: `linear-gradient(135deg, ${brand}, ${brand}aa)` }}>
              {f.coverUrl && <img src={f.coverUrl} alt="" className="size-full object-cover" />}
            </div>
            <div className="px-5 pb-6">
              <div className="-mt-9 flex flex-wrap items-end justify-between gap-3">
                <div className="flex size-[72px] items-center justify-center overflow-hidden rounded-xl border-4 border-bg text-xl font-semibold" style={{ background: brand, color: on }}>
                  {f.logoUrl ? <img src={f.logoUrl} alt="" className="size-full object-cover" /> : (f.name[0] ?? "S").toUpperCase()}
                </div>
                {store.whatsapp ? (
                  <span className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium" style={{ background: brand, color: on }}><MessageCircle size={14} />Chat on WhatsApp</span>
                ) : <span className="text-xs text-muted">Add a business phone or connect WhatsApp to show the chat button</span>}
              </div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight">{f.name || "Your store"}</h2>
              {f.description && <p className="mt-1 text-sm text-muted">{f.description}</p>}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {store.address && <span className="flex items-center gap-1"><MapPin size={12} />{store.address}</span>}
                {store.hours && <span className="flex items-center gap-1"><Clock size={12} />{store.hours}</span>}
              </div>
              {items.length ? (
                <ul className="mt-5 divide-y divide-border/60 rounded-lg border border-border bg-surface text-sm">
                  {items.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0"><div className="truncate font-medium">{s.name}</div>{s.durationMins && <div className="text-xs text-muted">{s.durationMins} min</div>}</div>
                      <div className="flex shrink-0 items-center gap-3"><span className="tabular-nums">{formatKobo(s.priceCents)}</span>
                        <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: brand, color: on }}>{s.durationMins != null && store.canBook ? "Book" : store.canOrder ? "Add" : "Ask"}</span></div>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-5 rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted">Add active items in your catalog and they’ll appear here.</p>}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Only active catalog items are shown. Stock levels, customers and orders are never visible on your public store.</p>
        </div>
      </div>
    </div>
  );
}
