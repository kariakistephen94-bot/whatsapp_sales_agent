"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { btn, btnPrimary, inputCls } from "@/components/ui";
import { connectPaystack, disconnectPaystack } from "@/modules/payments/actions";

export function PaymentsCard({ connected, mode, publicKey, webhookUrl, canEdit }: { connected: boolean; mode?: "live" | "test"; publicKey?: string; webhookUrl: string; canEdit: boolean }) {
  const [pk, setPk] = useState("");
  const [sk, setSk] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    setMsg(null);
    const r = await connectPaystack({ publicKey: pk, secretKey: sk });
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setPk(""); setSk(""); setMsg({ ok: true, text: "Connected. Your AI agent can now send payment links." });
  });
  const remove = () => {
    if (!confirm("Disconnect Paystack? The AI will stop sending payment links.")) return;
    start(async () => { const r = await disconnectPaystack(); setMsg(r.ok ? { ok: true, text: "Disconnected." } : { ok: false, text: r.error }); });
  };

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-muted">Customers pay you directly through your own Paystack account (card, bank transfer or USSD). When an order is placed on WhatsApp, the AI sends them a secure payment link, and the order is marked paid automatically once Paystack confirms it.</p>
      {connected ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-success/30 bg-success/10 px-3 py-2">
          <CheckCircle2 size={16} className="text-success" />
          <span>Paystack connected · <b>{mode === "live" ? "Live" : "Test"} mode</b> · <code className="text-xs">{publicKey?.slice(0, 12)}…</code></span>
          {mode === "test" && <span className="text-xs text-muted">Test mode: no real money moves. Switch to your live keys when you're ready.</span>}
          {canEdit && <button className={`${btn} ml-auto`} onClick={remove} disabled={pending}>Disconnect</button>}
        </div>
      ) : null}
      {canEdit ? (
        <div className="space-y-2">
          <div className="text-xs font-medium">{connected ? "Replace keys" : "Connect your Paystack account"}</div>
          <label className="block"><span className="mb-1 block text-xs text-muted">Public key</span><input className={inputCls} value={pk} onChange={(e) => setPk(e.target.value)} placeholder="pk_live_…" autoComplete="off" spellCheck={false} /></label>
          <label className="block"><span className="mb-1 block text-xs text-muted">Secret key <span className="text-muted">(needed to create payment links and confirm payments; stored encrypted and never shown again)</span></span><input type="password" className={inputCls} value={sk} onChange={(e) => setSk(e.target.value)} placeholder="sk_live_…" autoComplete="off" spellCheck={false} /></label>
          <p className="text-[11px] text-muted">Find both in Paystack → Settings → API Keys &amp; Webhooks. Use two keys of the same mode.</p>
          <div className="flex items-center gap-3">
            <button className={btnPrimary} onClick={save} disabled={pending || !pk.trim() || !sk.trim()}>{pending && <Loader2 size={14} className="animate-spin" />}{connected ? "Save new keys" : "Connect Paystack"}</button>
            {msg && <span className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
          </div>
        </div>
      ) : <p className="text-xs text-muted">Only the workspace owner can change payment settings.</p>}
      <div className="rounded-md border border-border bg-bg px-3 py-2 text-xs text-muted">
        <b className="text-fg">Recommended:</b> in Paystack → Settings → API Keys &amp; Webhooks, set the <b>Webhook URL</b> to <code className="break-all text-fg">{webhookUrl}</code>. Payments are also checked automatically every couple of minutes, so nothing is lost without it.
      </div>
    </div>
  );
}
