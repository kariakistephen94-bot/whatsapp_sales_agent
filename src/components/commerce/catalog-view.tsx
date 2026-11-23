"use client";
import { WriteWithAi } from "@/components/agent/write-with-ai";
import { useMemo, useState } from "react";
import { ImagePlus, Package, Pencil, Plus, Search, X } from "lucide-react";
import type { ItemKind } from "@/server/db";
import { Badge, PageHeader, Table, Td, Th, btn, btnPrimary, inputCls } from "@/components/ui";
import { formatKobo } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { deleteCatalogItem, saveCatalogItem, setCatalogItemActive } from "@/modules/catalog/actions";
import { EmptyState, ErrorNote, Field, InfoNote, Modal, Spinner, Toggle, useAction } from "./shared";

export interface CatalogRow {
  id: string; kind: ItemKind; name: string; description: string | null; category: string | null; priceCents: number;
  durationMins: number | null; trackInventory: boolean; stock: number | null; active: boolean; used: boolean; images: string[];
}
export interface CatalogTab { kind: ItemKind; label: string; readOnly?: boolean }

const LOW_STOCK = 5;
const SINGULAR: Record<ItemKind, string> = { SERVICE: "service", PRODUCT: "product", MENU_ITEM: "menu item" };
const stockBadge = (r: CatalogRow) => !r.trackInventory ? null : (r.stock ?? 0) === 0 ? "Out of stock" : (r.stock ?? 0) <= LOW_STOCK ? "Low stock" : "In stock";

export function CatalogView({ rows, tabs, canEdit, inventoryDefault, limit }: { rows: CatalogRow[]; tabs: CatalogTab[]; canEdit: boolean; inventoryDefault: boolean; limit: number }) {
  const [tab, setTab] = useState<ItemKind>(tabs[0].kind);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<CatalogRow | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current = tabs.find((t) => t.kind === tab) ?? tabs[0];
  const isService = tab === "SERVICE";

  const inTab = rows.filter((r) => r.kind === tab);
  const categories = useMemo(() => [...new Set(inTab.map((r) => r.category).filter(Boolean) as string[])].sort(), [inTab]);
  const shown = inTab.filter((r) => (!cat || r.category === cat) && (r.name + " " + (r.category ?? "") + " " + (r.description ?? "")).toLowerCase().includes(q.toLowerCase()));
  const atLimit = limit !== -1 && rows.length >= limit;

  return (
    <div>
      <PageHeader title="Products & Services" sub="The AI quotes prices, durations and stock from here only."
        actions={canEdit && !current.readOnly && <button onClick={() => { setNotice(null); setEditing("new"); }} className={btnPrimary}><Plus size={14} />Add {SINGULAR[tab]}</button>} />

      {tabs.length > 1 && (
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((t) => (
            <button key={t.kind} onClick={() => { setTab(t.kind); setCat(""); }} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === t.kind ? "border-accent font-medium" : "border-transparent text-muted hover:text-fg")}>
              {t.label} <span className="text-xs opacity-60">{rows.filter((r) => r.kind === t.kind).length}</span>
            </button>
          ))}
        </div>
      )}

      {notice && <div className="mb-3"><InfoNote>{notice}</InfoNote></div>}
      {canEdit && atLimit && <div className="mb-3"><InfoNote tone="warn">You've reached your plan's limit of {limit} products & services. Upgrade to add more.</InfoNote></div>}

      {inTab.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative w-full max-w-xs"><Search size={14} className="absolute left-2.5 top-2.5 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${current.label.toLowerCase()}`} className={cn(inputCls, "pl-8")} /></div>
          {categories.length > 0 && (
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={cn(inputCls, "w-auto")}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      )}

      {inTab.length === 0 ? (
        <EmptyState icon={<Package size={22} />} title={`No ${current.label.toLowerCase()} yet`}
          sub={isService ? "Add what you offer with prices and durations so the AI can quote and book them." : "Add what you sell with prices (and stock if you track it) so the AI can take orders."}
          action={canEdit && !current.readOnly && <button onClick={() => setEditing("new")} className={btnPrimary}><Plus size={14} />Add {SINGULAR[tab]}</button>} />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing matches" sub="Try a different search or category." />
      ) : (
        <Table>
          <thead><tr>
            <Th>{isService ? "Service" : tab === "MENU_ITEM" ? "Item" : "Product"}</Th><Th>Category</Th>
            {isService ? <Th right>Duration</Th> : <Th right>Stock</Th>}
            <Th right>Price</Th><Th>{isService ? "Bookable by AI" : "Sellable by AI"}</Th>{canEdit && <Th />}
          </tr></thead>
          <tbody>{shown.map((r) => <Row key={r.id} r={r} canEdit={canEdit} onEdit={() => { setNotice(null); setEditing(r); }} />)}</tbody>
        </Table>
      )}

      {editing && (
        <ItemDialog item={editing === "new" ? null : editing} kind={editing === "new" ? tab : editing.kind} inventoryDefault={inventoryDefault} categories={categories}
          onClose={() => setEditing(null)} onDeleted={(deactivated, name) => setNotice(deactivated ? `"${name}" has orders or appointments, so it was deactivated instead of deleted. It's hidden from the AI and storefront.` : `"${name}" was deleted.`)} />
      )}
    </div>
  );
}

function Row({ r, canEdit, onEdit }: { r: CatalogRow; canEdit: boolean; onEdit: () => void }) {
  const { pending, error, run } = useAction();
  const sb = stockBadge(r);
  return (
    <tr className={cn(!r.active && "opacity-60")}>
      <Td className="font-medium">
        <div className="flex items-center gap-3">
          {r.images[0] ? <img src={r.images[0]} alt="" loading="lazy" className="size-10 shrink-0 rounded-md border border-border object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-md border border-dashed border-border text-muted"><ImagePlus size={14} /></span>}
          <div className="min-w-0">{r.name}{r.description && <div className="max-w-[280px] truncate text-xs font-normal text-muted">{r.description}</div>}</div>
        </div>
      </Td>
      <Td label="Category" className="text-muted">{r.category ?? "—"}</Td>
      {r.kind === "SERVICE"
        ? <Td right label="Duration">{r.durationMins ? `${r.durationMins} min` : "—"}</Td>
        : <Td right label="Stock">{r.trackInventory ? <span className="inline-flex items-center gap-2"><span className="tabular-nums">{r.stock ?? 0}</span>{sb && sb !== "In stock" && <Badge>{sb}</Badge>}</span> : <span className="text-muted">Not tracked</span>}</Td>}
      <Td right label="Price">{formatKobo(r.priceCents)}</Td>
      <Td label={r.kind === "SERVICE" ? "Bookable by AI" : "Sellable by AI"}>
        <div className="flex items-center gap-2">
          <Toggle checked={r.active} disabled={!canEdit || pending} onChange={(v) => run(() => setCatalogItemActive(r.id, v))} label={`${r.active ? "Deactivate" : "Activate"} ${r.name}`} />
          {pending && <Spinner size={12} />}
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </Td>
      {canEdit && <Td label="Actions" right><button onClick={onEdit} className={cn(btn, "px-2")} aria-label={`Edit ${r.name}`}><Pencil size={13} /></button></Td>}
    </tr>
  );
}

function ItemDialog({ item, kind, inventoryDefault, categories, onClose, onDeleted }: {
  item: CatalogRow | null; kind: ItemKind; inventoryDefault: boolean; categories: string[]; onClose: () => void; onDeleted: (deactivated: boolean, name: string) => void;
}) {
  const isService = kind === "SERVICE";
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [price, setPrice] = useState(item ? String(item.priceCents / 100) : "");
  const [duration, setDuration] = useState(String(item?.durationMins ?? 60));
  const [track, setTrack] = useState(item ? item.trackInventory : inventoryDefault);
  const [stock, setStock] = useState(String(item?.stock ?? 0));
  const [active, setActive] = useState(item?.active ?? true);
  const [images, setImages] = useState<string[]>(item?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const save = useAction();
  const del = useAction();

  const submit = () => {
    const p = Number(price.replace(/[,\s₦]/g, ""));
    if (!name.trim()) return save.setError("Give it a name");
    if (price.trim() === "" || !Number.isFinite(p) || p < 0) return save.setError("Enter a valid price in naira");
    const dur = parseInt(duration, 10), st = parseInt(stock, 10);
    if (isService && (!dur || dur < 5)) return save.setError("Duration must be at least 5 minutes");
    if (!isService && track && (!Number.isInteger(st) || st < 0)) return save.setError("Enter the quantity in stock");
    save.run(() => saveCatalogItem({
      id: item?.id, kind, name: name.trim(), description: description.trim() || undefined, category: category.trim() || undefined,
      priceNaira: p, durationMins: isService ? dur : null, trackInventory: !isService && track, stock: !isService && track ? st : null, active, images,
    }), onClose);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    save.setError(null); setUploading(true);
    try {
      for (const f of Array.from(files).slice(0, 5 - images.length)) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) { save.setError("Use PNG, JPEG or WebP photos"); continue; }
        if (f.size > 3 * 1024 * 1024) { save.setError(`${f.name} is over 3 MB`); continue; }
        const fd = new FormData(); fd.append("file", f);
        const r = await fetch("/api/uploads", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { save.setError(j.error ?? "Upload failed"); break; }
        setImages((cur) => [...cur, j.url].slice(0, 5));
      }
    } finally { setUploading(false); }
  };

  const remove = () => {
    if (!item) return;
    const msg = item.used
      ? `"${item.name}" is linked to past orders or appointments, so it will be deactivated (hidden from the AI and storefront) instead of deleted. Continue?`
      : `Delete "${item.name}"? This can't be undone.`;
    if (!confirm(msg)) return;
    del.run(() => deleteCatalogItem(item.id), (d) => { onDeleted(d.deactivated, item.name); onClose(); });
  };

  return (
    <Modal open onClose={onClose} title={item ? `Edit ${SINGULAR[kind]}` : `Add ${SINGULAR[kind]}`}
      footer={<>
        {item && <button onClick={remove} disabled={del.pending} className={cn(btn, "mr-auto text-danger")}>{del.pending && <Spinner size={12} />}{item.used ? "Deactivate" : "Delete"}</button>}
        <button onClick={onClose} className={btn}>Cancel</button>
        <button onClick={submit} disabled={save.pending || uploading} className={cn(btnPrimary, "disabled:opacity-50")}>{save.pending && <Spinner size={12} />}{item ? "Save changes" : "Add"}</button>
      </>}>
      <div className="space-y-3">
        <Field label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder={isService ? "e.g. Knotless braids (medium)" : "e.g. Ankara maxi dress"} /></Field>
        <Field label="Photos" hint={isService ? "Optional. Shown on your storefront." : "Shown on your storefront. The first photo is the cover. Up to 5, 3 MB each."}>
          <div className="flex flex-wrap gap-2">
            {images.map((u, i) => (
              <div key={u} className="group relative size-20 overflow-hidden rounded-md border border-border">
                <img src={u} alt="" className="size-full object-cover" />
                {i === 0 && <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[10px] text-white">Cover</span>}
                <button type="button" aria-label="Remove photo" onClick={() => setImages((c) => c.filter((x) => x !== u))} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
              </div>
            ))}
            {images.length < 5 && (
              <label className={cn("grid size-20 cursor-pointer place-items-center rounded-md border border-dashed border-border text-muted transition hover:border-accent hover:text-accent", uploading && "pointer-events-none opacity-60")}>
                {uploading ? <Spinner size={16} /> : <span className="flex flex-col items-center gap-1 text-[11px]"><ImagePlus size={18} />Add photo</span>}
                <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </Field>
        <Field label="Description" hint="The AI uses this to answer questions. Keep it factual."><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputCls} /><div className="mt-2"><WriteWithAi kind="field" current={description} onApply={(t) => setDescription(t)} context={{ fieldType: "textarea", fieldKey: "itemDescription", fieldLabel: "Item description", purpose: "A short, factual description of this item that the AI can use to answer customer questions: what it is, key details, who it suits. No hype, no invented details such as materials, sizes or ingredients the owner did not give.", maxChars: "400", related: `Name: ${name}; category: ${category}; price: ${price} naira` }} /></div></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            <input value={category} onChange={(e) => setCategory(e.target.value)} list="catalog-categories" className={inputCls} placeholder="Optional" />
            <datalist id="catalog-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Price (₦)"><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" /></Field>
        </div>
        {isService ? (
          <Field label="Duration (minutes)"><input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" className={inputCls} /></Field>
        ) : (
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-sm font-medium">Track inventory</div><div className="text-xs text-muted">Stock goes down with each order and the AI won't sell what's out of stock.</div></div>
              <Toggle checked={track} onChange={setTrack} label="Track inventory" />
            </div>
            {track && <Field label="In stock" className="mt-3"><input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" className={inputCls} /></Field>}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <div><div className="text-sm font-medium">{isService ? "Bookable by AI" : "Sellable by AI"}</div><div className="text-xs text-muted">Inactive items are hidden from the AI and your storefront.</div></div>
          <Toggle checked={active} onChange={setActive} label="Active" />
        </div>
        <ErrorNote>{save.error ?? del.error}</ErrorNote>
      </div>
    </Modal>
  );
}
