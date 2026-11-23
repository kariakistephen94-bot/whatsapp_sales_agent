"use client";
import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { Check, Clock, Facebook, Globe, Instagram, Loader2, MapPin, MessageCircle, Minus, Plus, Search, ShoppingBag, X } from "lucide-react";
import { formatKobo } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type { PublicItem, PublicStore } from "@/modules/storefront/public";

type Store = Omit<PublicStore, never>;
const TZ = "Africa/Lagos";

/** Readable text colour on top of the brand colour. */
export function onColor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? "#111111" : "#ffffff";
}

const field = "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[var(--brand)]";
const waLink = (digits: string | null, text: string) => (digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null);

function socialHref(kind: string, v: string) {
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, "");
  return kind === "instagram" ? `https://instagram.com/${h}` : kind === "tiktok" ? `https://www.tiktok.com/@${h}` : kind === "facebook" ? `https://facebook.com/${h}` : `https://${h}`;
}

function TikTok({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-2.59-2.6c.27 0 .53.04.77.12V9.77a5.7 5.7 0 0 0-.77-.05A5.69 5.69 0 1 0 15.54 15.4V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.3 4.3 0 0 1-3.24-1.48Z" /></svg>;
}

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted hover:bg-bg"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ItemImage({ item, brand, className }: { item: PublicItem; brand: string; className?: string }) {
  if (item.image) return <img src={item.image} alt={item.name} loading="lazy" className={cn("object-cover", className)} />;
  return (
    <div className={cn("flex items-center justify-center text-2xl font-semibold", className)} style={{ background: `color-mix(in srgb, ${brand} 9%, transparent)`, color: brand }}>
      {item.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

// ───────────── Booking ─────────────

type Slot = { start: string; staffId: string | null; staffName: string | null };

function BookingFlow({ slug, service, preview, whatsapp, onDone }: { slug: string; service: PublicItem; preview: boolean; whatsapp: string | null; onDone: () => void }) {
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => DateTime.now().setZone(TZ).startOf("day").plus({ days: i })), []);
  const [date, setDate] = useState(days[0].toISODate()!);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ startsAt: string; staffName: string | null } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (preview) { setSlots([]); setLoadErr("Publish your store to take bookings."); return; }
    let live = true;
    setSlots(null); setSlot(null); setLoadErr("");
    fetch(`/api/store/${slug}/availability?serviceId=${encodeURIComponent(service.id)}&date=${date}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!live) return; if (!r.ok) { setSlots([]); setLoadErr(j.error ?? "Couldn't load times"); } else setSlots(j.slots ?? []); })
      .catch(() => live && (setSlots([]), setLoadErr("Couldn't load times. Check your connection.")));
    return () => { live = false; };
  }, [slug, service.id, date, preview, reload]);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!slot) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/store/${slug}/book`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: service.id, startsAt: slot.start, staffId: slot.staffId, name, phone, notes }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "Couldn't book that time"); if (r.status === 409) setReload((n) => n + 1); return; }
      setDone({ startsAt: j.startsAt, staffName: j.staffName });
    } catch { setError("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  if (done) {
    const when = DateTime.fromISO(done.startsAt, { setZone: true }).toFormat("cccc d LLLL 'at' h:mm a");
    const link = waLink(whatsapp, `Hi! I just booked ${service.name} for ${when} on your website. My name is ${name}.`);
    return (
      <div className="py-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full" style={{ background: "var(--brand)", color: "var(--on-brand)" }}><Check size={22} /></div>
        <h3 className="mt-4 text-lg font-semibold">You’re booked!</h3>
        <p className="mt-1 text-sm text-muted">{service.name}{done.staffName ? ` with ${done.staffName}` : ""}<br />{when}</p>
        <p className="mt-3 text-xs text-muted">We’ll send reminders on WhatsApp to {phone}.</p>
        <div className="mt-5 flex flex-col gap-2">
          {link && <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium" style={{ background: "var(--brand)", color: "var(--on-brand)" }}><MessageCircle size={16} />Message us on WhatsApp</a>}
          <button onClick={onDone} className="rounded-lg border border-border px-4 py-2.5 text-sm">Done</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={book} className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <div><div className="font-medium">{service.name}</div>{service.durationMins && <div className="text-xs text-muted">{service.durationMins} min</div>}</div>
        <div className="font-semibold tabular-nums">{formatKobo(service.priceCents)}</div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Choose a day</div>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {days.map((d) => {
            const iso = d.toISODate()!, sel = iso === date;
            return (
              <button type="button" key={iso} onClick={() => setDate(iso)}
                className={cn("flex w-14 shrink-0 flex-col items-center rounded-xl border py-2 text-xs transition-colors", sel ? "border-transparent" : "border-border hover:bg-bg")}
                style={sel ? { background: "var(--brand)", color: "var(--on-brand)" } : undefined}>
                <span className="opacity-80">{d.toFormat("ccc")}</span><span className="text-base font-semibold">{d.toFormat("d")}</span><span className="opacity-80">{d.toFormat("LLL")}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Choose a time</div>
        {slots === null ? <div className="flex items-center gap-2 py-3 text-sm text-muted"><Loader2 size={14} className="animate-spin" />Checking availability…</div>
          : loadErr ? <p className="py-3 text-sm text-muted">{loadErr}</p>
          : slots.length === 0 ? <p className="py-3 text-sm text-muted">No times left on this day — try another day.</p>
          : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => {
                const sel = slot?.start === s.start;
                return (
                  <button type="button" key={s.start} onClick={() => setSlot(s)}
                    className={cn("rounded-lg border py-2 text-sm tabular-nums transition-colors", sel ? "border-transparent font-medium" : "border-border hover:bg-bg")}
                    style={sel ? { background: "var(--brand)", color: "var(--on-brand)" } : undefined}>
                    {DateTime.fromISO(s.start, { setZone: true }).toFormat("h:mm a")}
                  </button>
                );
              })}
            </div>
          )}
        {slot?.staffName && <p className="mt-2 text-xs text-muted">With {slot.staffName}</p>}
      </div>

      {slot && (
        <div className="space-y-3">
          <input className={field} required minLength={2} maxLength={100} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <input className={field} required type="tel" inputMode="tel" placeholder="WhatsApp number, e.g. 0803 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          <textarea className={field} rows={2} maxLength={500} placeholder="Anything we should know? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button disabled={busy || preview} className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium disabled:opacity-60" style={{ background: "var(--brand)", color: "var(--on-brand)" }}>
            {busy && <Loader2 size={16} className="animate-spin" />}Confirm booking
          </button>
        </div>
      )}
    </form>
  );
}

// ───────────── Catalog & cart ─────────────

function Catalog({ title, id, items, canOrder, cart, add, whatsapp }: {
  title: string; id: string; items: PublicItem[]; canOrder: boolean; cart: Record<string, number>; add: (id: string, d: number) => void; whatsapp: string | null;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const cats = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))] as string[], [items]);
  const shown = items.filter((i) => (!cat || i.category === cat) && (!q || `${i.name} ${i.description ?? ""} ${i.category ?? ""}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {items.length > 6 && (
          <label className="relative w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className={cn(field, "pl-9")} placeholder={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
      </div>
      {cats.length > 1 && (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {[null, ...cats].map((c) => (
            <button key={c ?? "all"} onClick={() => setCat(c)}
              className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors", cat === c ? "border-transparent font-medium" : "border-border text-muted hover:text-fg")}
              style={cat === c ? { background: "var(--brand)", color: "var(--on-brand)" } : undefined}>{c ?? "All"}</button>
          ))}
        </div>
      )}
      {shown.length === 0 ? <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted">Nothing matches your search.</p> : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {shown.map((i) => {
            const n = cart[i.id] ?? 0;
            const ask = waLink(whatsapp, `Hi! I'm interested in ${i.name}.`);
            return (
              <article key={i.id} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
                <div className="relative aspect-[4/3] overflow-hidden bg-bg">
                  <ItemImage item={i} brand="var(--brand)" className="size-full transition-transform duration-300 group-hover:scale-[1.03]" />
                  {i.soldOut && <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">Sold out</span>}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <h3 className="text-sm font-medium leading-snug">{i.name}</h3>
                  {i.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{i.description}</p>}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <span className="text-sm font-semibold tabular-nums">{formatKobo(i.priceCents)}</span>
                    {canOrder ? (
                      i.soldOut ? null : n > 0 ? (
                        <div className="flex items-center gap-1 rounded-full border border-border">
                          <button aria-label="Remove one" onClick={() => add(i.id, -1)} className="p-1.5"><Minus size={13} /></button>
                          <span className="min-w-4 text-center text-sm tabular-nums">{n}</span>
                          <button aria-label="Add one" onClick={() => add(i.id, 1)} className="p-1.5"><Plus size={13} /></button>
                        </div>
                      ) : (
                        <button onClick={() => add(i.id, 1)} aria-label={`Add ${i.name} to cart`} className="flex size-8 items-center justify-center rounded-full" style={{ background: "var(--brand)", color: "var(--on-brand)" }}><Plus size={16} /></button>
                      )
                    ) : ask ? <a href={ask} target="_blank" rel="noopener noreferrer" className="text-xs font-medium" style={{ color: "var(--brand-text)" }}>Ask</a> : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Checkout({ slug, store, lines, total, preview, onPlaced, clear }: {
  slug: string; store: Store; lines: { item: PublicItem; qty: number }[]; total: number; preview: boolean; onPlaced: (r: { number: number; totalCents: number }) => void; clear: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"pickup" | "delivery">(store.delivery ? "delivery" : "pickup");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/store/${slug}/order`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, deliveryMethod: method, address, notes, items: lines.map((l) => ({ itemId: l.item.id, quantity: l.qty })) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setError(j.error ?? "Couldn't place your order");
      clear();
      onPlaced({ number: j.number, totalCents: j.totalCents });
    } catch { setError("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input className={field} required minLength={2} maxLength={100} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      <input className={field} required type="tel" inputMode="tel" placeholder="WhatsApp number, e.g. 0803 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      <div className="grid grid-cols-2 gap-2">
        {(["pickup", ...(store.delivery ? ["delivery"] : [])] as ("pickup" | "delivery")[]).map((m) => (
          <button type="button" key={m} onClick={() => setMethod(m)}
            className={cn("rounded-lg border py-2.5 text-sm capitalize", method === m ? "border-transparent font-medium" : "border-border")}
            style={method === m ? { background: "var(--brand)", color: "var(--on-brand)" } : undefined}>{m}</button>
        ))}
      </div>
      {method === "delivery" && <textarea className={field} required minLength={5} rows={2} maxLength={400} placeholder="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" />}
      <textarea className={field} rows={2} maxLength={500} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex justify-between border-t border-border pt-3 text-sm"><span className="text-muted">Total{method === "delivery" ? " (excl. delivery)" : ""}</span><span className="font-semibold tabular-nums">{formatKobo(total)}</span></div>
      <p className="text-xs text-muted">Payment is not taken online. We’ll confirm your order{method === "delivery" ? " and delivery fee" : ""} on WhatsApp and share how to pay.</p>
      {preview && <p className="text-xs text-amber-600">Preview mode — publish your store to accept orders.</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <button disabled={busy || preview || !lines.length} className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium disabled:opacity-60" style={{ background: "var(--brand)", color: "var(--on-brand)" }}>
        {busy && <Loader2 size={16} className="animate-spin" />}Place order
      </button>
    </form>
  );
}

// ───────────── Page ─────────────

export function PublicStoreView({ store, preview }: { store: Store; preview: boolean }) {
  const brand = store.brandColor;
  const on = onColor(brand);
  const sellable = useMemo(() => [...store.products, ...store.menu], [store.products, store.menu]);
  const byId = useMemo(() => new Map(sellable.map((i) => [i.id, i])), [sellable]);
  const key = `cart:${store.slug}`;

  const [cart, setCart] = useState<Record<string, number>>({});
  const [booking, setBooking] = useState<PublicItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [placed, setPlaced] = useState<{ number: number; totalCents: number } | null>(null);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, number>;
      const clean = Object.fromEntries(Object.entries(raw).filter(([id, n]) => byId.has(id) && !byId.get(id)!.soldOut && Number.isInteger(n) && n > 0).map(([id, n]) => [id, Math.min(99, n)]));
      setCart(clean);
    } catch { /* storage unavailable */ }
  }, [key, byId]);
  const save = (c: Record<string, number>) => { setCart(c); try { localStorage.setItem(key, JSON.stringify(c)); } catch { /* ignore */ } };
  const add = (id: string, d: number) => {
    const n = Math.max(0, Math.min(99, (cart[id] ?? 0) + d));
    const next = { ...cart };
    if (n) next[id] = n; else delete next[id];
    save(next);
  };

  const lines = Object.entries(cart).flatMap(([id, qty]) => (byId.has(id) ? [{ item: byId.get(id)!, qty }] : []));
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.qty * l.item.priceCents, 0);
  const chat = waLink(store.whatsapp, `Hi ${store.name}!`);
  const sections = [
    store.services.length && { id: "services", label: "Services" },
    store.menu.length && { id: "menu", label: "Menu" },
    store.products.length && { id: "products", label: "Products" },
    { id: "visit", label: "Visit" },
  ].filter(Boolean) as { id: string; label: string }[];
  const socials = Object.entries(store.social) as [keyof Store["social"], string][];
  const empty = !store.services.length && !store.products.length && !store.menu.length;

  return (
    <div className="min-h-screen bg-bg text-fg" style={{ "--brand": brand, "--on-brand": on, "--brand-text": on === "#ffffff" ? brand : "hsl(var(--fg))" } as React.CSSProperties}>
      {preview && <div className="bg-amber-500 px-4 py-2 text-center text-xs font-medium text-black">Draft preview — only your team can see this page until you publish it.</div>}

      {/* Hero */}
      <header className="relative">
        <div className="h-44 w-full overflow-hidden sm:h-64" style={{ background: `linear-gradient(135deg, ${brand}, ${brand}aa)` }}>
          {store.coverUrl && <img src={store.coverUrl} alt="" className="size-full object-cover" />}
        </div>
        <div className="mx-auto max-w-5xl px-4">
          <div className="-mt-12 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-bg text-3xl font-semibold shadow-sm sm:size-28" style={{ background: brand, color: on }}>
                {store.logoUrl ? <img src={store.logoUrl} alt={`${store.name} logo`} className="size-full object-cover" /> : store.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="pb-1">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{store.name}</h1>
                {store.address && <p className="mt-1 flex items-center gap-1 text-sm text-muted"><MapPin size={14} />{store.address}</p>}
              </div>
            </div>
            {chat && (
              <a href={chat} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium shadow-sm" style={{ background: brand, color: on }}>
                <MessageCircle size={16} />Chat on WhatsApp
              </a>
            )}
          </div>
          {store.description && <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">{store.description}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
            {store.hours && <span className="flex items-center gap-1.5"><Clock size={14} />{store.hours}</span>}
            {socials.map(([k, v]) => (
              <a key={k} href={socialHref(k, v)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-fg">
                {k === "instagram" ? <Instagram size={15} /> : k === "facebook" ? <Facebook size={15} /> : k === "tiktok" ? <TikTok size={15} /> : <Globe size={15} />}
                <span className="capitalize">{k}</span>
              </a>
            ))}
          </div>
        </div>
      </header>

      {sections.length > 2 && (
        <nav className="sticky top-0 z-30 mt-6 border-b border-border bg-bg/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
            {sections.map((s) => <a key={s.id} href={`#${s.id}`} className="whitespace-nowrap px-3 py-3 text-sm text-muted hover:text-fg">{s.label}</a>)}
          </div>
        </nav>
      )}

      <main className="mx-auto max-w-5xl space-y-12 px-4 pb-32 pt-8">
        {empty && <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted">This store is getting ready. {chat ? "Chat with us on WhatsApp in the meantime." : ""}</p>}

        {store.services.length > 0 && (
          <section id="services" className="scroll-mt-20">
            <h2 className="mb-4 text-xl font-semibold tracking-tight">Services</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {store.services.map((s) => {
                const ask = waLink(store.whatsapp, `Hi! I'd like to ask about ${s.name}.`);
                return (
                  <li key={s.id} className="flex items-center gap-4 p-4">
                    {s.image && <img src={s.image} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg object-cover" />}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{s.name}</div>
                      {s.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{s.description}</p>}
                      <div className="mt-1 text-xs text-muted">{s.durationMins ? `${s.durationMins} min · ` : ""}<span className="font-medium text-fg">{formatKobo(s.priceCents)}</span></div>
                    </div>
                    {store.canBook ? (
                      <button onClick={() => setBooking(s)} className="shrink-0 rounded-full px-4 py-2 text-sm font-medium" style={{ background: brand, color: on }}>Book</button>
                    ) : ask ? <a href={ask} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-full border border-border px-4 py-2 text-sm">Ask</a> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {store.menu.length > 0 && <Catalog title="Menu" id="menu" items={store.menu} canOrder={store.canOrder} cart={cart} add={add} whatsapp={store.whatsapp} />}
        {store.products.length > 0 && <Catalog title="Products" id="products" items={store.products} canOrder={store.canOrder} cart={cart} add={add} whatsapp={store.whatsapp} />}

        <section id="visit" className="scroll-mt-20 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-tight">Visit or reach us</h2>
          <div className="mt-3 grid gap-3 text-sm text-muted sm:grid-cols-2">
            {store.address && <p className="flex items-start gap-2"><MapPin size={16} className="mt-0.5 shrink-0" />{store.address}</p>}
            {store.hours && <p className="flex items-start gap-2"><Clock size={16} className="mt-0.5 shrink-0" />{store.hours}</p>}
          </div>
          {chat && <a href={chat} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium" style={{ background: brand, color: on }}><MessageCircle size={16} />Chat on WhatsApp</a>}
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted">© {new Date().getFullYear()} {store.name}</footer>

      {store.canOrder && count > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3 sm:p-4">
          <button onClick={() => setCartOpen(true)} className="mx-auto flex w-full max-w-lg items-center justify-between rounded-full px-5 py-3.5 text-sm font-medium shadow-xl" style={{ background: brand, color: on }}>
            <span className="flex items-center gap-2"><ShoppingBag size={17} />View cart · {count} item{count === 1 ? "" : "s"}</span>
            <span className="tabular-nums">{formatKobo(total)}</span>
          </button>
        </div>
      )}

      <Sheet open={!!booking} onClose={() => setBooking(null)} title="Book an appointment">
        {booking && <BookingFlow slug={store.slug} service={booking} preview={preview} whatsapp={store.whatsapp} onDone={() => setBooking(null)} />}
      </Sheet>

      <Sheet open={cartOpen || !!placed} onClose={() => { setCartOpen(false); setPlaced(null); }} title={placed ? "Order placed" : "Your cart"}>
        {placed ? (
          <div className="py-4 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full" style={{ background: brand, color: on }}><Check size={22} /></div>
            <h3 className="mt-4 text-lg font-semibold">Thank you! Order #{placed.number}</h3>
            <p className="mt-1 text-sm text-muted">Total {formatKobo(placed.totalCents)}</p>
            <p className="mx-auto mt-3 max-w-xs text-sm text-muted">We’ll confirm on WhatsApp; payment is not taken online.</p>
            <div className="mt-5 flex flex-col gap-2">
              {store.whatsapp && <a href={waLink(store.whatsapp, `Hi ${store.name}! I just placed order #${placed.number} on your website.`)!} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium" style={{ background: brand, color: on }}><MessageCircle size={16} />Send order #{placed.number} on WhatsApp</a>}
              <button onClick={() => setPlaced(null)} className="rounded-lg border border-border px-4 py-2.5 text-sm">Continue shopping</button>
            </div>
          </div>
        ) : lines.length === 0 ? <p className="py-8 text-center text-sm text-muted">Your cart is empty.</p> : (
          <div className="space-y-5">
            <ul className="divide-y divide-border">
              {lines.map(({ item, qty }) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <ItemImage item={item} brand={brand} className="size-12 shrink-0 rounded-lg text-base" />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{item.name}</div><div className="text-xs text-muted tabular-nums">{formatKobo(item.priceCents)}</div></div>
                  <div className="flex items-center gap-1 rounded-full border border-border">
                    <button aria-label="Remove one" onClick={() => add(item.id, -1)} className="p-1.5"><Minus size={13} /></button>
                    <span className="min-w-4 text-center text-sm tabular-nums">{qty}</span>
                    <button aria-label="Add one" onClick={() => add(item.id, 1)} className="p-1.5"><Plus size={13} /></button>
                  </div>
                </li>
              ))}
            </ul>
            <Checkout slug={store.slug} store={store} lines={lines} total={total} preview={preview} clear={() => save({})} onPlaced={(r) => { setCartOpen(false); setPlaced(r); }} />
          </div>
        )}
      </Sheet>
    </div>
  );
}
