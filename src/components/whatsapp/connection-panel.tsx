"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Smartphone, Wifi, WifiOff } from "lucide-react";

type Conn = { id: string; status: string; phoneNumber: string | null; lastSeenAt: string | null; lastError: string | null; qrDataUrl: string | null };

const btn = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-50";

export function ConnectionPanel() {
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [activity, setActivity] = useState({ in24h: 0, out24h: 0 });
  const [error, setError] = useState("");
  const [workerOnline, setWorkerOnline] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch("/api/whatsapp", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setConns(j.connections); setActivity(j.activity); setWorkerOnline(j.workerOnline);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 2500); // QR rotates ~every 20s; poll keeps it fresh
    return () => clearInterval(t);
  }, [load]);

  async function create() {
    setError("");
    const r = await fetch("/api/whatsapp", { method: "POST" });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "Could not start");
    load();
  }
  async function act(id: string, action: "reconnect" | "disconnect" | "logout") {
    await fetch(`/api/whatsapp/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    load();
  }

  if (!conns) return <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="animate-spin" size={14} />Loading…</div>;

  return (
    <div className="space-y-4">
      {!workerOnline && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          The background worker isn't running, so WhatsApp can't connect. Start it with <code className="rounded bg-bg px-1">npm run worker</code> (or <code className="rounded bg-bg px-1">npm run dev:all</code>).
        </div>
      )}
      {conns.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-6">
          <Smartphone className="mb-3 text-muted" size={20} />
          <p className="text-sm">No WhatsApp number connected yet.</p>
          <button className={`${btn} mt-3`} onClick={create}>Connect WhatsApp</button>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      {conns.map((c) => (
        <div key={c.id} className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              {c.status === "connected" ? <Wifi size={16} className="text-success" /> : <WifiOff size={16} className="text-muted" />}
              {c.status === "connected" ? `Connected${c.phoneNumber ? ` · ${c.phoneNumber}` : ""}` : c.status === "qr" ? "Waiting for scan" : c.status === "connecting" ? "Connecting…" : "Disconnected"}
            </div>
            <div className="flex gap-2">
              {c.status !== "connected" && <button className={btn} onClick={() => act(c.id, "reconnect")}>Reconnect</button>}
              {c.status === "connected" && <button className={btn} onClick={() => act(c.id, "disconnect")}>Pause</button>}
              <button className={btn} onClick={() => confirm("Disconnect and remove this WhatsApp session?") && act(c.id, "logout")}>Disconnect</button>
            </div>
          </div>

          {c.status === "qr" && c.qrDataUrl && (
            <div className="mt-5 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.qrDataUrl} alt="WhatsApp QR code" className="size-[220px] rounded-md border border-border bg-white p-2" />
              <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted">
                <li>Open WhatsApp on the business phone.</li>
                <li>Tap <b className="text-fg">Settings → Linked devices → Link a device</b>.</li>
                <li>Scan this code. It refreshes automatically.</li>
              </ol>
            </div>
          )}
          {c.lastError && c.status !== "connected" && <p className="mt-3 text-xs text-danger">{c.lastError}</p>}
          {c.status === "connected" && (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div><dt className="text-xs text-muted">Received (24h)</dt><dd className="tabular-nums">{activity.in24h}</dd></div>
              <div><dt className="text-xs text-muted">Sent (24h)</dt><dd className="tabular-nums">{activity.out24h}</dd></div>
              <div><dt className="text-xs text-muted">Last seen</dt><dd>{c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleTimeString() : "—"}</dd></div>
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}
