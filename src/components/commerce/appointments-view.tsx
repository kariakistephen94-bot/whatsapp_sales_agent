"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Plus } from "lucide-react";
import { Badge, PageHeader, btn, btnPrimary, inputCls } from "@/components/ui";
import { formatKobo } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { createAppointment, rescheduleAppointmentAction, updateAppointmentStatus } from "@/modules/appointments/actions";
import { CustomerPicker, Drawer, EmptyState, ErrorNote, Field, InfoNote, Modal, Spinner, customerPayload, useAction, type CustomerChoice } from "./shared";

export interface ApptRow {
  id: string; status: string; source: string; createdByAi: boolean; notes: string | null;
  customer: { id: string; name: string | null; phone: string };
  service: { id: string; name: string; durationMins: number | null; priceCents: number };
  staff: { id: string; name: string } | null;
  startsAt: string; date: string; dayIndex: number; startMin: number; endMin: number; dateLabel: string; timeLabel: string; mins: number;
}
export interface StaffOption { id: string; name: string; active: boolean; serviceIds: string[] }
export interface ServiceOption { id: string; name: string; durationMins: number | null; priceCents: number }
interface Week { label: string; start: string; prev: string; next: string; isCurrent: boolean; days: { date: string; short: string; num: string; long: string }[] }
interface Slot { start: string; staffId: string | null; staffName: string | null }

const ROW = 48; // px per hour
const PALETTE = [
  "bg-emerald-500/15 border-emerald-500/50", "bg-indigo-500/15 border-indigo-500/50", "bg-amber-500/15 border-amber-500/50",
  "bg-sky-500/15 border-sky-500/50", "bg-rose-500/15 border-rose-500/50", "bg-violet-500/15 border-violet-500/50",
  "bg-teal-500/15 border-teal-500/50", "bg-orange-500/15 border-orange-500/50",
];
const DOT = ["bg-emerald-500", "bg-indigo-500", "bg-amber-500", "bg-sky-500", "bg-rose-500", "bg-violet-500", "bg-teal-500", "bg-orange-500"];
const NEUTRAL = "bg-border/50 border-border";
const STATUS_LABEL: Record<string, string> = { booked: "Booked", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };
const sourceLabel = (a: ApptRow) => a.source === "whatsapp" ? (a.createdByAi ? "AI · WhatsApp" : "WhatsApp") : a.source === "storefront" ? "Storefront" : "Dashboard";
const hhmm = (iso: string) => iso.slice(11, 16); // ISO strings carry the org offset, so this is local time

export function AppointmentsView({ rows, staff, services, week, today, hours }: {
  rows: ApptRow[]; staff: StaffOption[]; services: ServiceOption[]; week: Week; today: string; hours: { start: number; end: number };
}) {
  const [who, setWho] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const colorIdx = useMemo(() => new Map(staff.map((s, i) => [s.id, i % PALETTE.length])), [staff]);
  const color = (a: ApptRow) => a.staff && colorIdx.has(a.staff.id) ? PALETTE[colorIdx.get(a.staff.id)!] : NEUTRAL;
  const hasUnassigned = rows.some((r) => !r.staff);

  const shown = rows.filter((a) => who === "all" || (who === "none" ? !a.staff : a.staff?.id === who));
  const onGrid = shown.filter((a) => a.status !== "cancelled");
  const open = rows.find((r) => r.id === openId) ?? null;
  const HOURS = Array.from({ length: hours.end - hours.start }, (_, i) => hours.start + i);

  return (
    <div>
      <PageHeader title="Appointments" sub={`Week of ${week.label} · Lagos time (WAT)`}
        actions={<button onClick={() => setCreating(true)} className={btnPrimary}><Plus size={14} />New appointment</button>} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 text-xs">
          <Chip active={who === "all"} onClick={() => setWho("all")}>All</Chip>
          {staff.map((s) => (
            <Chip key={s.id} active={who === s.id} onClick={() => setWho(s.id)}>
              <span className={cn("size-2 rounded-full", DOT[colorIdx.get(s.id)!])} />{s.name}{!s.active && <span className="opacity-60">(inactive)</span>}
            </Chip>
          ))}
          {hasUnassigned && staff.length > 0 && <Chip active={who === "none"} onClick={() => setWho("none")}>Unassigned</Chip>}
        </div>
        <div className="flex gap-1">
          <Link href={`/dashboard/appointments?week=${week.prev}`} className={btn} aria-label="Previous week"><ChevronLeft size={14} /></Link>
          <Link href="/dashboard/appointments" className={cn(btn, week.isCurrent && "pointer-events-none opacity-50")}>Today</Link>
          <Link href={`/dashboard/appointments?week=${week.next}`} className={btn} aria-label="Next week"><ChevronRight size={14} /></Link>
        </div>
      </div>

      {/* Desktop week grid */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
        <div className="grid min-w-[760px] grid-cols-[56px_repeat(7,1fr)]">
          <div className="border-b border-border" />
          {week.days.map((d) => (
            <div key={d.date} className={cn("border-b border-l border-border px-2 py-2 text-xs font-medium", d.date === today && "bg-accent/5")}>
              {d.short} <span className={cn(d.date === today ? "rounded-full bg-accent px-1.5 py-0.5 text-accent-fg" : "text-muted")}>{d.num}</span>
            </div>
          ))}
          <div>{HOURS.map((h) => <div key={h} style={{ height: ROW }} className="-mt-px pr-2 pt-0.5 text-right text-[11px] text-muted">{String(h).padStart(2, "0")}:00</div>)}</div>
          {week.days.map((d, di) => (
            <div key={d.date} className={cn("relative border-l border-border", d.date === today && "bg-accent/5")}>
              {HOURS.map((h) => <div key={h} style={{ height: ROW }} className="border-b border-border/50" />)}
              {layoutDay(onGrid.filter((a) => a.dayIndex === di)).map(({ a, lane, lanes }) => {
                const top = ((a.startMin - hours.start * 60) / 60) * ROW + 1;
                const height = Math.max(22, ((a.endMin - a.startMin) / 60) * ROW - 3);
                return (
                  <button key={a.id} onClick={() => setOpenId(a.id)}
                    style={{ top, height, left: `calc(${(lane / lanes) * 100}% + 3px)`, width: `calc(${100 / lanes}% - 6px)` }}
                    className={cn("absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight hover:shadow-md", color(a), a.status !== "booked" && "opacity-60")}>
                    <div className="truncate font-medium">{a.customer.name || a.customer.phone}</div>
                    <div className="truncate text-muted">{hhmm(a.startsAt)} · {a.service.name}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile day-by-day */}
      <div className="space-y-3 md:hidden">
        {week.days.map((d, di) => {
          const day = shown.filter((a) => a.dayIndex === di);
          return (
            <div key={d.date} className="rounded-lg border border-border bg-surface">
              <div className={cn("border-b border-border px-3 py-2 text-xs font-medium", d.date === today && "text-accent")}>{d.long}{d.date === today && " · Today"}</div>
              {day.length === 0 ? <p className="px-3 py-3 text-xs text-muted">No appointments</p> : (
                <ul className="divide-y divide-border/60">
                  {day.map((a) => <ApptListItem key={a.id} a={a} dot={a.staff && colorIdx.has(a.staff.id) ? DOT[colorIdx.get(a.staff.id)!] : "bg-border"} onClick={() => setOpenId(a.id)} />)}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="mb-2 mt-6 hidden text-sm font-medium md:block">This week</h2>
      {shown.length === 0 ? (
        <div className="mt-4 md:mt-0">
          <EmptyState icon={<CalendarDays size={22} />} title="No appointments this week"
            sub={services.length ? "Bookings from WhatsApp, your storefront and the dashboard show up here." : "Add services in Products & Services so customers and the AI can book them."}
            action={services.length ? <button onClick={() => setCreating(true)} className={btnPrimary}><Plus size={14} />New appointment</button> : <Link href="/dashboard/catalog" className={btn}>Add services</Link>} />
        </div>
      ) : (
        <ul className="hidden divide-y divide-border/60 rounded-lg border border-border bg-surface md:block">
          {shown.map((a) => <ApptListItem key={a.id} a={a} showDate dot={a.staff && colorIdx.has(a.staff.id) ? DOT[colorIdx.get(a.staff.id)!] : "bg-border"} onClick={() => setOpenId(a.id)} />)}
        </ul>
      )}

      <ApptDrawer appt={open} staff={staff} today={today} onClose={() => setOpenId(null)} />
      {creating && <NewApptDialog services={services} staff={staff} today={today} onClose={() => setCreating(false)} />}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1", active ? "bg-border font-medium" : "text-muted hover:text-fg")}>{children}</button>;
}

function ApptListItem({ a, onClick, dot, showDate }: { a: ApptRow; onClick: () => void; dot: string; showDate?: boolean }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-3 text-left text-sm hover:bg-bg md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", dot)} />
          <span className="min-w-0"><span className="font-medium">{a.customer.name || a.customer.phone}</span> <span className="text-muted">· {a.service.name}{a.staff ? ` with ${a.staff.name}` : ""}</span></span>
        </div>
        <div className="flex items-center gap-3 text-xs"><span className="text-muted tabular-nums">{showDate ? `${a.dateLabel} · ` : ""}{a.timeLabel}</span><Badge>{STATUS_LABEL[a.status] ?? a.status}</Badge></div>
      </button>
    </li>
  );
}

/** Side-by-side lanes for overlapping appointments in a day column. */
function layoutDay(items: ApptRow[]) {
  const sorted = [...items].sort((x, y) => x.startMin - y.startMin || y.endMin - x.endMin);
  const out: { a: ApptRow; lane: number; lanes: number }[] = [];
  let cluster: { a: ApptRow; lane: number }[] = [], laneEnds: number[] = [], clusterEnd = -1;
  const flush = () => { for (const c of cluster) out.push({ ...c, lanes: laneEnds.length }); cluster = []; laneEnds = []; };
  for (const a of sorted) {
    if (a.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= a.startMin);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(a.endMin); } else laneEnds[lane] = a.endMin;
    cluster.push({ a, lane });
    clusterEnd = Math.max(clusterEnd, a.endMin);
  }
  flush();
  return out;
}

// ───────── Slot picker (uses the real availability API) ─────────

function SlotPicker({ serviceId, staffId, date, value, onChange, ignoreAppointmentId }: { serviceId: string; staffId: string; date: string; value: Slot | null; onChange: (s: Slot | null) => void; ignoreAppointmentId?: string }) {
  const [state, setState] = useState<{ loading: boolean; slots: Slot[]; error: string | null }>({ loading: false, slots: [], error: null });
  useEffect(() => {
    onChange(null);
    if (!serviceId || !date) { setState({ loading: false, slots: [], error: null }); return; }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const qs = new URLSearchParams({ serviceId, date, ...(staffId ? { staffId } : {}), ...(ignoreAppointmentId ? { ignore: ignoreAppointmentId } : {}) });
    fetch(`/api/appointments/availability?${qs}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        setState({ loading: false, slots: Array.isArray(j.slots) ? j.slots : [], error: j.error ?? (r.ok ? null : "Couldn't load available times") });
      })
      .catch((e) => { if (e?.name !== "AbortError") setState({ loading: false, slots: [], error: "Couldn't load available times. Check your connection." }); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, staffId, date]);

  if (!serviceId) return <p className="text-xs text-muted">Choose a service to see available times.</p>;
  if (state.loading) return <div className="flex items-center gap-2 text-xs text-muted"><Spinner size={12} />Checking availability…</div>;
  if (state.error) return <ErrorNote>{state.error}</ErrorNote>;
  if (!state.slots.length) return <InfoNote tone="warn">No free times on this day. Try another date{staffId ? " or staff member" : ""}.</InfoNote>;
  return (
    <div className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-5">
      {state.slots.map((s) => (
        <button type="button" key={s.start} onClick={() => onChange(s)}
          className={cn("rounded-md border px-2 py-1.5 text-xs tabular-nums", value?.start === s.start ? "border-accent bg-accent text-accent-fg" : "border-border hover:bg-bg")}>
          {hhmm(s.start)}
        </button>
      ))}
    </div>
  );
}

function NewApptDialog({ services, staff, today, onClose }: { services: ServiceOption[]; staff: StaffOption[]; today: string; onClose: () => void }) {
  const [customer, setCustomer] = useState<CustomerChoice | null>(null);
  const [serviceId, setServiceId] = useState(services.length === 1 ? services[0].id : "");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notes, setNotes] = useState("");
  const { pending, error, setError, run } = useAction();
  const eligible = staff.filter((s) => s.active && (s.serviceIds.length === 0 || s.serviceIds.includes(serviceId)));

  useEffect(() => { if (staffId && !eligible.some((s) => s.id === staffId)) setStaffId(""); }, [serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!customer) return setError("Choose or add a customer");
    if (customer.mode === "new" && (!customer.name.trim() || !customer.phone.trim())) return setError("Enter the new customer's name and phone");
    if (!serviceId) return setError("Choose a service");
    if (!slot) return setError("Pick a time");
    run(() => createAppointment({ customer: customerPayload(customer), serviceId, staffId: staffId || slot.staffId || null, startsAt: slot.start, notes: notes.trim() || undefined }), onClose);
  };

  const svc = services.find((s) => s.id === serviceId);
  return (
    <Modal open onClose={onClose} title="New appointment" wide
      footer={<>
        <button onClick={onClose} className={btn}>Cancel</button>
        <button onClick={submit} disabled={pending || !services.length} className={cn(btnPrimary, "disabled:opacity-50")}>{pending && <Spinner size={12} />}Book appointment</button>
      </>}>
      {services.length === 0 ? (
        <InfoNote tone="warn">You have no active services. <Link href="/dashboard/catalog" className="underline">Add a service</Link> first.</InfoNote>
      ) : (
        <div className="space-y-4">
          <Field label="Customer"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Service">
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputCls}>
                <option value="">Choose a service…</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMins ?? 60} min · {formatKobo(s.priceCents)}</option>)}
              </select>
            </Field>
            {staff.some((s) => s.active) && (
              <Field label="Staff">
                <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls} disabled={!serviceId}>
                  <option value="">Anyone available</option>
                  {eligible.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Date"><input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, "sm:w-56")} /></Field>
          <div>
            <span className="mb-1 block text-xs font-medium">Time</span>
            <SlotPicker serviceId={serviceId} staffId={staffId} date={date} value={slot} onChange={setSlot} />
            {slot && <p className="mt-2 text-xs text-muted">{svc?.name} at {hhmm(slot.start)}{slot.staffName ? ` with ${slot.staffName}` : ""}</p>}
          </div>
          <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} /></Field>
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}

function ApptDrawer({ appt, staff, today, onClose }: { appt: ApptRow | null; staff: StaffOption[]; today: string; onClose: () => void }) {
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(today);
  const [staffId, setStaffId] = useState("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const act = useAction();
  const resched = useAction();

  useEffect(() => { setRescheduling(false); setSlot(null); setDate(appt && appt.date >= today ? appt.date : today); setStaffId(appt?.staff?.id ?? ""); }, [appt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!appt) return <Drawer open={false} onClose={onClose} title=""><span /></Drawer>;
  const started = new Date(appt.startsAt).getTime() <= Date.now();
  const eligible = staff.filter((s) => s.active && (s.serviceIds.length === 0 || s.serviceIds.includes(appt.service.id)));
  const setStatus = (s: "completed" | "no_show" | "cancelled", msg?: string) => { if (msg && !confirm(msg)) return; act.run(() => updateAppointmentStatus(appt.id, s)); };

  return (
    <Drawer open onClose={onClose} title={appt.customer.name || appt.customer.phone} sub={`${appt.dateLabel} · ${appt.timeLabel}`}
      footer={appt.status === "booked" && !rescheduling ? <>
        <button onClick={() => setRescheduling(true)} className={btn}>Reschedule</button>
        {started && <button disabled={act.pending} onClick={() => setStatus("completed")} className={btnPrimary}>Mark completed</button>}
        {started && <button disabled={act.pending} onClick={() => setStatus("no_show", "Mark this appointment as a no-show?")} className={btn}>No-show</button>}
        <button disabled={act.pending} onClick={() => setStatus("cancelled", "Cancel this appointment? The customer won't be notified automatically.")} className={cn(btn, "ml-auto text-danger")}>Cancel</button>
        {act.pending && <Spinner size={12} />}
      </> : undefined}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge>{STATUS_LABEL[appt.status] ?? appt.status}</Badge><span className="text-xs text-muted">{sourceLabel(appt)}</span></div>
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2">
          <dt className="text-muted">Service</dt><dd>{appt.service.name} · {formatKobo(appt.service.priceCents)}</dd>
          <dt className="text-muted">When</dt><dd>{appt.dateLabel}, {appt.timeLabel} <span className="text-muted">({appt.mins} min)</span></dd>
          <dt className="text-muted">Staff</dt><dd>{appt.staff?.name ?? "Unassigned"}</dd>
          {appt.notes && <><dt className="text-muted">Notes</dt><dd className="whitespace-pre-wrap">{appt.notes}</dd></>}
        </dl>
        <Link href={`/dashboard/customers/${appt.customer.id}`} className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-bg">
          <span><span className="font-medium">{appt.customer.name || "Unnamed customer"}</span> <span className="text-muted">· {appt.customer.phone}</span></span>
          <ExternalLink size={13} className="text-muted" />
        </Link>
        {appt.status === "booked" && !started && <p className="text-xs text-muted">You can mark it completed or a no-show once the start time has passed.</p>}
        <ErrorNote>{act.error}</ErrorNote>

        {rescheduling && (
          <section className="space-y-3 rounded-md border border-border p-3">
            <h3 className="text-sm font-medium">Reschedule</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New date"><input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
              {eligible.length > 0 && (
                <Field label="Staff">
                  <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls}>
                    <option value="">Anyone available</option>
                    {eligible.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <SlotPicker serviceId={appt.service.id} staffId={staffId} date={date} value={slot} onChange={setSlot} ignoreAppointmentId={appt.id} />
            <ErrorNote>{resched.error}</ErrorNote>
            <div className="flex gap-2">
              <button onClick={() => setRescheduling(false)} className={btn}>Back</button>
              <button disabled={!slot || resched.pending} className={cn(btnPrimary, "disabled:opacity-50")}
                onClick={() => slot && resched.run(() => rescheduleAppointmentAction({ appointmentId: appt.id, startsAt: slot.start, staffId: staffId || slot.staffId || null }), onClose)}>
                {resched.pending && <Spinner size={12} />}Move to {slot ? hhmm(slot.start) : "…"}
              </button>
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}
