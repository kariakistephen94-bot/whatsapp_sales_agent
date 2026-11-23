"use client";
import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus, UserRound } from "lucide-react";
import { hoursProblem, type WeeklyHours } from "@/modules/appointments/hours";
import { HoursEditor } from "@/components/hours-editor";
import { Avatar, Badge, btn, btnPrimary, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { deleteStaffMember, saveStaffMember, setStaffActive } from "@/modules/team/actions";
import { EmptyState, ErrorNote, Field, InfoNote, Modal, Spinner, Toggle, useAction } from "@/components/commerce/shared";

export interface StaffRow { id: string; name: string; role: string | null; active: boolean; serviceIds: string[]; hours: WeeklyHours; hoursText: string; bookedThisWeek: number }
type Service = { id: string; name: string; active: boolean };

export function StaffSection({ staff, services, defaultHours }: { staff: StaffRow[]; services: Service[]; defaultHours: WeeklyHours }) {
  const [editing, setEditing] = useState<StaffRow | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const names = new Map(services.map((s) => [s.id, s.name]));

  return (
    <section className="mt-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Bookable staff</h2>
          <p className="text-xs text-muted">People customers can book. Their hours and services decide what times the AI offers.</p>
        </div>
        <button onClick={() => { setNotice(null); setEditing("new"); }} className={btn}><Plus size={14} />Add staff</button>
      </div>
      {notice && <div className="mb-3"><InfoNote>{notice}</InfoNote></div>}

      {staff.length === 0 ? (
        <EmptyState icon={<UserRound size={22} />} title="No bookable staff yet"
          sub="Without staff, bookings use your business hours and one appointment at a time. Add staff to take parallel bookings."
          action={<button onClick={() => setEditing("new")} className={btnPrimary}><Plus size={14} />Add staff</button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {staff.map((s) => <StaffCard key={s.id} s={s} names={names} onEdit={() => { setNotice(null); setEditing(s); }} />)}
        </div>
      )}

      {editing && (
        <StaffDialog staff={editing === "new" ? null : editing} services={services} defaultHours={defaultHours} onClose={() => setEditing(null)}
          onDeleted={(deactivated, name) => setNotice(deactivated ? `${name} has appointment history, so they were deactivated instead of deleted.` : `${name} was removed.`)} />
      )}
    </section>
  );
}

function StaffCard({ s, names, onEdit }: { s: StaffRow; names: Map<string, string>; onEdit: () => void }) {
  const { pending, error, run } = useAction();
  const svc = s.serviceIds.map((id) => names.get(id)).filter(Boolean) as string[];
  return (
    <div className={cn("rounded-lg border border-border bg-surface p-4", !s.active && "opacity-70")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={s.name} />
          <div className="min-w-0"><div className="truncate text-sm font-medium">{s.name}</div><div className="truncate text-xs text-muted">{s.role || "Staff"}</div></div>
        </div>
        <button onClick={onEdit} className={cn(btn, "px-2")} aria-label={`Edit ${s.name}`}><Pencil size={13} /></button>
      </div>
      <dl className="mt-4 space-y-2 text-xs">
        <div><dt className="text-muted">Hours</dt><dd>{s.hoursText}</dd></div>
        <div><dt className="text-muted">Services</dt><dd>{s.serviceIds.length === 0 ? "All services" : svc.length ? svc.join(", ") : "None (services were removed)"}</dd></div>
        <div><dt className="text-muted">Booked this week</dt><dd>{s.bookedThisWeek}</dd></div>
      </dl>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="flex items-center gap-2">{s.active ? <Badge>Active</Badge> : <Badge tone="gray">Inactive</Badge>}{pending && <Spinner size={12} />}</span>
        <Toggle checked={s.active} disabled={pending} onChange={(v) => run(() => setStaffActive(s.id, v))} label={`${s.active ? "Deactivate" : "Activate"} ${s.name}`} />
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

function StaffDialog({ staff, services, defaultHours, onClose, onDeleted }: {
  staff: StaffRow | null; services: Service[]; defaultHours: WeeklyHours; onClose: () => void; onDeleted: (deactivated: boolean, name: string) => void;
}) {
  const [name, setName] = useState(staff?.name ?? "");
  const [role, setRole] = useState(staff?.role ?? "");
  const [allServices, setAllServices] = useState(staff ? staff.serviceIds.length === 0 : true);
  const [serviceIds, setServiceIds] = useState<string[]>(staff?.serviceIds.filter((id) => services.some((s) => s.id === id)) ?? []);
  const [hours, setHours] = useState<WeeklyHours>(staff?.hours ?? defaultHours);
  const [active, setActive] = useState(staff?.active ?? true);
  const save = useAction();
  const del = useAction();

  const toggleService = (id: string) => setServiceIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const invalidHours = hoursProblem(hours);

  const submit = () => {
    if (name.trim().length < 2) return save.setError("Enter the staff member's name");
    if (invalidHours) return save.setError(`Fix the working hours. ${invalidHours}`);
    if (!allServices && serviceIds.length === 0) return save.setError("Pick at least one service, or choose “All services”");
    save.run(() => saveStaffMember({ id: staff?.id, name: name.trim(), role: role.trim() || undefined, serviceIds: allServices ? [] : serviceIds, workingHours: hours, active }), onClose);
  };
  const remove = () => {
    if (!staff) return;
    if (!confirm(`Remove ${staff.name}? If they have past or upcoming appointments they'll be deactivated instead, so booking history stays intact.`)) return;
    del.run(() => deleteStaffMember(staff.id), (d) => { onDeleted(d.deactivated, staff.name); onClose(); });
  };

  return (
    <Modal open onClose={onClose} title={staff ? `Edit ${staff.name}` : "Add bookable staff"} wide
      footer={<>
        {staff && <button onClick={remove} disabled={del.pending} className={cn(btn, "mr-auto text-danger")}>{del.pending && <Spinner size={12} />}Remove</button>}
        <button onClick={onClose} className={btn}>Cancel</button>
        <button onClick={submit} disabled={save.pending} className={cn(btnPrimary, "disabled:opacity-50")}>{save.pending && <Spinner size={12} />}{staff ? "Save changes" : "Add staff"}</button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Amaka" /></Field>
          <Field label="Role / title"><input value={role} onChange={(e) => setRole(e.target.value)} className={inputCls} placeholder="e.g. Senior stylist" /></Field>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium">Services</span>
          {services.length === 0 ? (
            <InfoNote>No services yet. <Link href="/dashboard/catalog" className="underline">Add services</Link> to assign them; until then this person can take any booking.</InfoNote>
          ) : (
            <div className="rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allServices} onChange={(e) => setAllServices(e.target.checked)} />All services</label>
              {!allServices && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {services.map((s) => (
                    <button type="button" key={s.id} onClick={() => toggleService(s.id)}
                      className={cn("rounded-full border px-2.5 py-1 text-xs", serviceIds.includes(s.id) ? "border-accent bg-accent/10" : "border-border text-muted hover:text-fg", !s.active && "italic")}>
                      {s.name}{!s.active && " (inactive)"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium">Working hours <span className="font-normal text-muted">· Lagos time</span></span>
          <HoursEditor value={hours} onChange={setHours} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
          <div><div className="text-sm font-medium">Accepting bookings</div><div className="text-xs text-muted">Inactive staff aren't offered to customers or the AI.</div></div>
          <Toggle checked={active} onChange={setActive} label="Active" />
        </div>
        <ErrorNote>{save.error ?? del.error}</ErrorNote>
      </div>
    </Modal>
  );
}
