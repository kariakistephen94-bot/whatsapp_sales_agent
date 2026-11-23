"use client";
import { useState } from "react";
import { Mail, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import type { Role } from "@/server/db";
import { Avatar, Badge, Table, Td, Th, btn, btnPrimary, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { changeMemberRole, inviteMember, removeMember, revokeInvitation, updateMemberContact, type InviteOutcome, type WhatsappOutcome } from "@/modules/team/actions";
import { ErrorNote, Field, InfoNote, Modal, Spinner, useAction } from "@/components/commerce/shared";

export interface MemberRow { id: string; name: string | null; email: string; role: Role; isSelf: boolean; joined: string; phone: string | null; notifyHandoffs: boolean }
export interface InviteRow { id: string; email: string; role: Role; sent: string; phone: string | null }

const prettyPhone = (p: string | null) => p ? p.replace(/^\+234(\d{3})(\d{3})(\d{4})$/, "0$1 $2 $3") : null;

const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff" };
const OUTCOME: Record<InviteOutcome, { tone: "success" | "info" | "warn"; text: (e: string) => string }> = {
  sent: { tone: "success", text: (e) => `Invitation emailed to ${e}.` },
  existing_user: { tone: "info", text: (e) => `${e} already has an account. They'll get access next time they sign in.` },
  not_configured: { tone: "warn", text: (e) => `Invitation saved, but email sending isn't set up yet (Supabase admin key missing). ${e} will get access when they sign up or sign in with this email.` },
  failed: { tone: "warn", text: (e) => `Invitation saved, but the email couldn't be sent. ${e} will still get access when they sign up or sign in with this email.` },
};

export function MembersSection({ members, invites, limit, whatsappConnected, canManage }: { members: MemberRow[]; invites: InviteRow[]; limit: number; whatsappConnected: boolean; canManage: boolean }) {
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "warn"; text: string } | null>(null);
  const used = members.length + invites.length;
  const full = limit !== -1 && used >= limit;
  const missing = members.filter((m) => !m.phone);
  const [editing, setEditing] = useState<MemberRow | null>(null);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Members <span className="font-normal text-muted">· {used}{limit !== -1 ? ` of ${limit}` : ""} seats used</span></h2>
        {canManage && <button onClick={() => { setNotice(null); setInviting(true); }} disabled={full} className={cn(btnPrimary, "disabled:opacity-50")} title={full ? "Seat limit reached" : undefined}><Plus size={14} />Invite member</button>}
      </div>
      {canManage && full && <div className="mb-3"><InfoNote tone="warn">You've used all {limit} seats on your plan. Upgrade or revoke a pending invitation to invite someone new.</InfoNote></div>}
      {missing.length > 0 && <div className="mb-3"><InfoNote tone="warn">Everything happens on WhatsApp: add a WhatsApp number for {missing.length === 1 ? (missing[0].isSelf ? "yourself" : missing[0].name || missing[0].email) : `${missing.length} members`} so they get hand-off alerts when a customer needs a person.</InfoNote></div>}
      {canManage && !whatsappConnected && <div className="mb-3"><InfoNote tone="info">Connect your business WhatsApp in Settings so invites and hand-off alerts can be sent to your team.</InfoNote></div>}
      {notice && <div className="mb-3"><InfoNote tone={notice.tone}>{notice.text}</InfoNote></div>}

      <Table>
        <thead><tr><Th>Member</Th><Th>WhatsApp</Th><Th>Role</Th><Th>Joined</Th><Th /></tr></thead>
        <tbody>
          {members.map((m) => <MemberRowView key={m.id} m={m} canEdit={canManage || m.isSelf} onEdit={() => setEditing(m)} />)}
          {invites.map((i) => <InviteRowView key={i.id} i={i} />)}
        </tbody>
      </Table>

      {inviting && <InviteDialog onClose={() => setInviting(false)} onDone={(o, w, email) => {
        setInviting(false);
        const wa = w === "queued" ? " A join link is on its way to their WhatsApp." : " Their WhatsApp invite will be sent once your business WhatsApp is connected; until then they can use the email.";
        setNotice({ tone: OUTCOME[o].tone, text: OUTCOME[o].text(email) + wa });
      }} />}
      {editing && <ContactDialog m={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function MemberRowView({ m, canEdit, onEdit }: { m: MemberRow; canEdit: boolean; onEdit: () => void }) {
  const { pending, error, run } = useAction();
  const locked = m.role === "OWNER" || m.isSelf;
  return (
    <tr>
      <Td>
        <div className="flex items-center gap-3">
          <Avatar name={m.name || m.email} />
          <span className="min-w-0"><span className="block font-medium">{m.name || m.email.split("@")[0]}{m.isSelf && <span className="ml-1 text-xs font-normal text-muted">(you)</span>}</span><span className="text-xs text-muted">{m.email}</span></span>
        </div>
      </Td>
      <Td label="WhatsApp">
        {m.phone ? (
          <span className="inline-flex items-center gap-1.5"><MessageCircle size={13} className="text-success" />{prettyPhone(m.phone)}{!m.notifyHandoffs && <Badge>Alerts off</Badge>}</span>
        ) : <Badge tone="amber">Missing</Badge>}
        {canEdit && <button onClick={onEdit} className="ml-2 align-middle text-muted hover:text-fg" aria-label={`Edit WhatsApp number for ${m.email}`}><Pencil size={12} /></button>}
      </Td>
      <Td label="Role">
        {locked ? <Badge tone={m.role === "OWNER" ? "blue" : "gray"}>{ROLE_LABEL[m.role]}</Badge> : (
          <div className="flex items-center gap-2">
            <select value={m.role} disabled={pending} onChange={(e) => run(() => changeMemberRole(m.id, e.target.value as "ADMIN" | "STAFF"))} className={cn(inputCls, "w-auto py-1 text-xs")}>
              <option value="ADMIN">Admin</option><option value="STAFF">Staff</option>
            </select>
            {pending && <Spinner size={12} />}
          </div>
        )}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </Td>
      <Td label="Joined" className="text-muted">{m.joined}</Td>
      <Td label="Actions" right>
        {!locked && (
          <button disabled={pending} onClick={() => confirm(`Remove ${m.name || m.email} from the workspace? They'll lose access immediately.`) && run(() => removeMember(m.id))}
            className={cn(btn, "px-2 text-danger")} aria-label={`Remove ${m.email}`}><Trash2 size={13} /></button>
        )}
      </Td>
    </tr>
  );
}

function InviteRowView({ i }: { i: InviteRow }) {
  const { pending, error, run } = useAction();
  return (
    <tr className="bg-bg/40">
      <Td>
        <div className="flex items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted"><Mail size={13} /></span>
          <span className="min-w-0"><span className="block font-medium">{i.email}</span><span className="text-xs text-muted">Invited {i.sent}</span></span>
        </div>
      </Td>
      <Td label="WhatsApp">{i.phone ? prettyPhone(i.phone) : <span className="text-muted">—</span>}</Td>
      <Td label="Role"><span className="inline-flex items-center gap-2">{ROLE_LABEL[i.role]} <Badge>Invited</Badge></span></Td>
      <Td label="Joined" className="text-muted">Pending</Td>
      <Td label="Actions" right>
        <button disabled={pending} onClick={() => confirm(`Revoke the invitation for ${i.email}?`) && run(() => revokeInvitation(i.id))} className={btn}>
          {pending && <Spinner size={12} />}Revoke
        </button>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </Td>
    </tr>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: (o: InviteOutcome, w: WhatsappOutcome, email: string) => void }) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"ADMIN" | "STAFF">("STAFF");
  const { pending, error, setError, run } = useAction();
  const submit = () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setError("Enter a valid email address");
    if (phone.replace(/\D/g, "").length < 10) return setError("Enter their WhatsApp number");
    run(() => inviteMember({ email: e, phone, role }), (d) => onDone(d.outcome, d.whatsapp, e));
  };
  return (
    <Modal open onClose={onClose} title="Invite a team member"
      footer={<><button onClick={onClose} className={btn}>Cancel</button><button onClick={submit} disabled={pending} className={cn(btnPrimary, "disabled:opacity-50")}>{pending && <Spinner size={12} />}Send invite</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <Field label="WhatsApp number" hint="We send their join link and hand-off alerts here."><input autoFocus type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" className={inputCls} /></Field>
        <Field label="Email" hint="They sign in with this email."><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" className={inputCls} /></Field>
        <Field label="Role" hint={role === "ADMIN" ? "Admins can manage the team, catalog, AI agent, automations and settings." : "Staff handle conversations, customers, orders and appointments."}>
          <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "STAFF")} className={inputCls}>
            <option value="STAFF">Staff</option><option value="ADMIN">Admin</option>
          </select>
        </Field>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}

function ContactDialog({ m, onClose }: { m: MemberRow; onClose: () => void }) {
  const [phone, setPhone] = useState(prettyPhone(m.phone) ?? "");
  const [notify, setNotify] = useState(m.notifyHandoffs);
  const { pending, error, setError, run } = useAction();
  const submit = () => {
    if (phone.replace(/\D/g, "").length < 10) return setError("Enter a valid WhatsApp number");
    run(() => updateMemberContact(m.id, { phone, notifyHandoffs: notify }), () => onClose());
  };
  return (
    <Modal open onClose={onClose} title={m.isSelf ? "Your WhatsApp number" : `WhatsApp number for ${m.name || m.email}`}
      footer={<><button onClick={onClose} className={btn}>Cancel</button><button onClick={submit} disabled={pending} className={cn(btnPrimary, "disabled:opacity-50")}>{pending && <Spinner size={12} />}Save</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
        <Field label="WhatsApp number"><input autoFocus type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />Send me a WhatsApp alert when a customer needs a person</label>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}
