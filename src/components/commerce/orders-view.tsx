"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import type { ItemKind, OrderStatus, PaymentStatus } from "@/server/db";
import { Badge, PageHeader, Stat, Table, Td, Th, btn, btnPrimary, inputCls } from "@/components/ui";
import { formatKobo } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { createManualOrder, markPaid, markUnpaid, updateOrderStatus } from "@/modules/orders/actions";
import { CustomerPicker, Drawer, EmptyState, ErrorNote, Field, InfoNote, Modal, Spinner, customerPayload, useAction, type CustomerChoice } from "./shared";

export interface OrderRow {
  id: string; number: number; status: OrderStatus; paymentStatus: PaymentStatus; paymentMethod: string | null; paidAt: string | null;
  date: string; customer: { id: string; name: string | null; phone: string };
  items: { id: string; name: string; quantity: number; unitCents: number }[];
  subtotalCents: number; discountCents: number; totalCents: number; source: string;
  delivery: { method?: string; address?: string; notes?: string } | null; notes: string | null;
}
export interface SellableItem { id: string; name: string; kind: ItemKind; priceCents: number; stock: number | null }

const STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "COMPLETED", "CANCELLED"];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const PAY_LABEL: Record<PaymentStatus, string> = { UNPAID: "Unpaid", PENDING: "Payment pending", PAID: "Paid", REFUNDED: "Refunded" };
const METHODS = [{ v: "bank_transfer", l: "Bank transfer" }, { v: "cash", l: "Cash" }, { v: "pos", l: "POS" }, { v: "card", l: "Card" }] as const;
const methodLabel = (m: string | null) => METHODS.find((x) => x.v === m)?.l ?? (m === "paystack" ? "Paystack" : m ?? "");
const itemsSummary = (o: OrderRow) => o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");

export function OrdersView({ rows, filter, counts, total, items, stats }: {
  rows: OrderRow[]; filter: OrderStatus | null; counts: Partial<Record<OrderStatus, number>>; total: number; items: SellableItem[];
  stats: { paidCents: number; paidCount: number; outstandingCents: number; outstandingCount: number };
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <div>
      <PageHeader title="Orders" sub="Created by the AI from WhatsApp, the storefront, or manually."
        actions={<button onClick={() => setCreating(true)} className={btnPrimary}><Plus size={14} />New order</button>} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders" value={total.toLocaleString("en-NG")} />
        <Stat label="Paid revenue" value={formatKobo(stats.paidCents)} delta="Only paid orders count as revenue" />
        <Stat label="Avg paid order" value={stats.paidCount ? formatKobo(stats.paidCents / stats.paidCount) : "—"} delta={`${stats.paidCount} paid order${stats.paidCount === 1 ? "" : "s"}`} />
        <Stat label="Unpaid outstanding" value={formatKobo(stats.outstandingCents)} delta={`${stats.outstandingCount} open unpaid order${stats.outstandingCount === 1 ? "" : "s"}`} />
      </div>

      <div className="mb-3 flex flex-wrap gap-1 text-xs">
        <Link href="/dashboard/orders" className={cn("rounded-full px-2.5 py-1", !filter ? "bg-border font-medium" : "text-muted hover:text-fg")}>All <span className="opacity-60">{total}</span></Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/dashboard/orders?status=${s.toLowerCase()}`} className={cn("rounded-full px-2.5 py-1", filter === s ? "bg-border font-medium" : "text-muted hover:text-fg")}>
            {label(s)} <span className="opacity-60">{counts[s] ?? 0}</span>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<ShoppingBag size={22} />} title={filter ? `No ${label(filter).toLowerCase()} orders` : "No orders yet"}
          sub={filter ? "Try another status filter." : "Orders the AI takes on WhatsApp and storefront orders will appear here. You can also record one manually."}
          action={!filter && <button onClick={() => setCreating(true)} className={btnPrimary}><Plus size={14} />New order</button>} />
      ) : (
        <Table>
          <thead><tr><Th>Order</Th><Th>Customer</Th><Th>Items</Th><Th right>Total</Th><Th>Payment</Th><Th>Status</Th><Th>Source</Th></tr></thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-bg" onClick={() => setOpenId(o.id)}>
                <Td className="font-medium">#{o.number}<div className="text-xs font-normal text-muted">{o.date}</div></Td>
                <Td label="Customer">{o.customer.name || o.customer.phone}{o.customer.name && <div className="text-xs text-muted">{o.customer.phone}</div>}</Td>
                <Td label="Items" className="max-w-[220px] truncate text-muted">{itemsSummary(o)}</Td>
                <Td right label="Total">{formatKobo(o.totalCents)}</Td>
                <Td label="Payment"><Badge>{PAY_LABEL[o.paymentStatus]}</Badge></Td>
                <Td label="Status"><div onClick={(e) => e.stopPropagation()}><StatusSelect order={o} compact /></div></Td>
                <Td label="Source" className="text-muted">{o.source}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {rows.length === 200 && <p className="mt-2 text-xs text-muted">Showing the 200 most recent orders.</p>}

      <OrderDrawer order={open} onClose={() => setOpenId(null)} />
      {creating && <NewOrderDialog items={items} onClose={() => setCreating(false)} />}
    </div>
  );
}

function StatusSelect({ order, compact }: { order: OrderRow; compact?: boolean }) {
  const { pending, error, run } = useAction();
  const change = (s: OrderStatus) => {
    if (s === "CANCELLED" && !confirm(`Cancel order #${order.number}? Tracked stock will be returned. This can't be undone.`)) return;
    run(() => updateOrderStatus(order.id, s));
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <select value={order.status} disabled={pending || order.status === "CANCELLED"} onChange={(e) => change(e.target.value as OrderStatus)}
          className={cn(inputCls, compact ? "w-auto py-1 text-xs" : "w-auto")}>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        {pending && <Spinner size={12} />}
      </div>
      {error && <p className="mt-1 max-w-[220px] text-xs text-danger">{error}</p>}
    </div>
  );
}

function OrderDrawer({ order, onClose }: { order: OrderRow | null; onClose: () => void }) {
  const [method, setMethod] = useState("");
  const pay = useAction();
  const cancel = useAction();
  return (
    <Drawer open={!!order} onClose={onClose} title={order ? `Order #${order.number}` : ""} sub={order ? `${order.date} · ${order.source}` : undefined}>
      {order && (
        <div className="space-y-5 text-sm">
          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted">Customer</h3>
            <Link href={`/dashboard/customers/${order.customer.id}`} className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-bg">
              <span><span className="font-medium">{order.customer.name || "Unnamed customer"}</span> <span className="text-muted">· {order.customer.phone}</span></span>
              <ExternalLink size={13} className="text-muted" />
            </Link>
          </section>

          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted">Items</h3>
            <ul className="divide-y divide-border/60 rounded-md border border-border">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 px-3 py-2"><span>{i.quantity}× {i.name}</span><span className="tabular-nums">{formatKobo(i.unitCents * i.quantity)}</span></li>
              ))}
            </ul>
            <dl className="mt-2 space-y-1 px-1 tabular-nums">
              <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd>{formatKobo(order.subtotalCents)}</dd></div>
              {order.discountCents > 0 && <div className="flex justify-between text-muted"><dt>Discount</dt><dd>−{formatKobo(order.discountCents)}</dd></div>}
              <div className="flex justify-between font-medium"><dt>Total</dt><dd>{formatKobo(order.totalCents)}</dd></div>
            </dl>
          </section>

          {order.delivery && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-muted">Delivery</h3>
              <div className="rounded-md border border-border px-3 py-2">
                {order.delivery.method && <div className="capitalize">{order.delivery.method}</div>}
                {order.delivery.address && <div className="text-muted">{order.delivery.address}</div>}
                {order.delivery.notes && <div className="mt-1 text-xs text-muted">{order.delivery.notes}</div>}
              </div>
            </section>
          )}
          {order.notes && <section><h3 className="mb-1.5 text-xs font-medium text-muted">Notes</h3><p className="whitespace-pre-wrap rounded-md border border-border px-3 py-2">{order.notes}</p></section>}

          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted">Status</h3>
            <StatusSelect order={order} />
          </section>

          <section>
            <h3 className="mb-1.5 text-xs font-medium text-muted">Payment</h3>
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge>{PAY_LABEL[order.paymentStatus]}</Badge>
                {order.paymentStatus === "PAID" && <span className="text-xs text-muted">{methodLabel(order.paymentMethod)}{order.paidAt ? ` · ${order.paidAt}` : ""}</span>}
              </div>
              {order.paymentStatus === "PAID" ? (
                <button disabled={pay.pending} onClick={() => confirm("Mark this order as unpaid? It will be removed from revenue.") && pay.run(() => markUnpaid(order.id))} className={cn(btn, "mt-3")}>
                  {pay.pending && <Spinner size={12} />}Mark unpaid
                </button>
              ) : order.status === "CANCELLED" ? (
                <p className="mt-2 text-xs text-muted">Cancelled orders can't be marked as paid.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={cn(inputCls, "w-auto flex-1")}>
                    <option value="">How did they pay?</option>
                    {METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select>
                  <button disabled={!method || pay.pending} onClick={() => pay.run(() => markPaid(order.id, method as any), () => setMethod(""))} className={cn(btnPrimary, "disabled:opacity-50")}>
                    {pay.pending && <Spinner size={12} />}Mark as paid
                  </button>
                </div>
              )}
              <p className="mt-2 text-xs text-muted">Only mark as paid once you've confirmed the money arrived.</p>
              <div className="mt-2"><ErrorNote>{pay.error}</ErrorNote></div>
            </div>
          </section>

          {order.status !== "CANCELLED" && (
            <section className="border-t border-border pt-4">
              <button disabled={cancel.pending} onClick={() => confirm(`Cancel order #${order.number}? Tracked stock will be returned. This can't be undone.`) && cancel.run(() => updateOrderStatus(order.id, "CANCELLED"))}
                className={cn(btn, "text-danger")}>{cancel.pending && <Spinner size={12} />}Cancel order</button>
              <div className="mt-2"><ErrorNote>{cancel.error}</ErrorNote></div>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function NewOrderDialog({ items, onClose }: { items: SellableItem[]; onClose: () => void }) {
  const [customer, setCustomer] = useState<CustomerChoice | null>(null);
  const [lines, setLines] = useState<{ itemId: string; quantity: number }[]>([]);
  const [pick, setPick] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const { pending, error, setError, run } = useAction();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const total = lines.reduce((s, l) => s + (byId.get(l.itemId)?.priceCents ?? 0) * l.quantity, 0);

  const add = (id: string) => {
    if (!id) return;
    setLines((ls) => ls.some((l) => l.itemId === id) ? ls.map((l) => l.itemId === id ? { ...l, quantity: l.quantity + 1 } : l) : [...ls, { itemId: id, quantity: 1 }]);
    setPick("");
  };
  const setQty = (id: string, q: number) => setLines((ls) => ls.map((l) => l.itemId === id ? { ...l, quantity: Math.max(1, Math.min(999, q || 1)) } : l));

  const submit = () => {
    if (!customer) return setError("Choose or add a customer");
    if (customer.mode === "new" && (!customer.name.trim() || !customer.phone.trim())) return setError("Enter the new customer's name and phone");
    if (!lines.length) return setError("Add at least one item");
    const addr = deliveryMethod === "pickup" ? "" : address.trim();
    run(() => createManualOrder({
      customer: customerPayload(customer), items: lines,
      delivery: deliveryMethod || addr ? { method: deliveryMethod || undefined, address: addr || undefined } : undefined,
      notes: notes.trim() || undefined,
    }), onClose);
  };

  return (
    <Modal open onClose={onClose} title="New order" wide
      footer={<>
        <span className="mr-auto text-sm">Total <b className="tabular-nums">{formatKobo(total)}</b></span>
        <button onClick={onClose} className={btn}>Cancel</button>
        <button onClick={submit} disabled={pending} className={cn(btnPrimary, "disabled:opacity-50")}>{pending && <Spinner size={12} />}Create order</button>
      </>}>
      <div className="space-y-4">
        <Field label="Customer"><CustomerPicker value={customer} onChange={setCustomer} /></Field>

        <div>
          <span className="mb-1 block text-xs font-medium">Items</span>
          {items.length === 0 ? (
            <InfoNote tone="warn">You have no active items. <Link href="/dashboard/catalog" className="underline">Add products</Link> first.</InfoNote>
          ) : (
            <select value={pick} onChange={(e) => add(e.target.value)} className={inputCls}>
              <option value="">Add an item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id} disabled={i.stock === 0}>
                  {i.name} · {formatKobo(i.priceCents)}{i.stock !== null ? (i.stock === 0 ? " · out of stock" : ` · ${i.stock} in stock`) : ""}
                </option>
              ))}
            </select>
          )}
          {lines.length > 0 && (
            <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border text-sm">
              {lines.map((l) => {
                const it = byId.get(l.itemId);
                if (!it) return null;
                return (
                  <li key={l.itemId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{it.name}</span>
                    <div className="flex items-center rounded-md border border-border">
                      <button type="button" onClick={() => setQty(l.itemId, l.quantity - 1)} className="px-2 py-1 text-muted hover:text-fg" aria-label="Decrease"><Minus size={12} /></button>
                      <input value={l.quantity} onChange={(e) => setQty(l.itemId, parseInt(e.target.value, 10))} inputMode="numeric" className="w-10 bg-transparent text-center text-sm tabular-nums outline-none" />
                      <button type="button" onClick={() => setQty(l.itemId, l.quantity + 1)} className="px-2 py-1 text-muted hover:text-fg" aria-label="Increase"><Plus size={12} /></button>
                    </div>
                    <span className="w-24 text-right tabular-nums">{formatKobo(it.priceCents * l.quantity)}</span>
                    <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.itemId !== l.itemId))} className="text-muted hover:text-danger" aria-label="Remove"><Trash2 size={14} /></button>
                    {it.stock !== null && l.quantity > it.stock && <span className="w-full text-xs text-danger">Only {it.stock} in stock</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Delivery (optional)">
            <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)} className={inputCls}>
              <option value="">None</option><option value="delivery">Delivery</option><option value="pickup">Pickup</option>
            </select>
          </Field>
          <Field label="Address">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={deliveryMethod === "pickup" ? "Not needed for pickup" : "Street, area, city"} className={inputCls} disabled={deliveryMethod === "pickup"} />
          </Field>
        </div>
        <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} /></Field>
        <p className="text-xs text-muted">The order is created as unpaid. Prices come from your catalog and tracked stock is reserved immediately.</p>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
