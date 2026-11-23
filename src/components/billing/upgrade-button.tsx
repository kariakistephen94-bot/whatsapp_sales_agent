"use client";
import { useState } from "react";
import { btnPrimary, btn } from "@/components/ui";

export function UpgradeButton({ planKey, label, primary }: { planKey: string; label: string; primary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planKey }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error || "Couldn't start checkout. Try again.");
      window.location.href = json.url;
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <div>
      <button onClick={go} disabled={busy} className={`${primary ? btnPrimary : btn} w-full justify-center`}>{busy ? "Redirecting to Paystack…" : label}</button>
      {err && <p className="mt-1.5 text-xs text-danger">{err}</p>}
    </div>
  );
}
