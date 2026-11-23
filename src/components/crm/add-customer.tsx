"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { btn, btnPrimary, inputCls } from "@/components/ui";
import { normalizeNgPhone } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { createCustomer } from "@/modules/customers/actions";

export function AddCustomer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const normalized = phone.trim() ? normalizeNgPhone(phone) : null;

  const submit = (fd: FormData) => {
    setError(null);
    const input = { name: String(fd.get("name") ?? ""), phone: String(fd.get("phone") ?? ""), email: String(fd.get("email") ?? ""), notes: String(fd.get("notes") ?? "") };
    if (!normalizeNgPhone(input.phone)) { setError("Enter a valid phone number, e.g. 0803 123 4567 or +234 803 123 4567"); return; }
    start(async () => {
      const r = await createCustomer(input).catch(() => ({ ok: false as const, error: "Couldn't save. Please try again." }));
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
      setPhone("");
      router.push(`/dashboard/customers/${r.data.id}`);
    });
  };

  return (
    <>
      <button className={btnPrimary} onClick={() => { setOpen(true); setError(null); }}><Plus size={14} />Add customer</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-customer-title" className="w-full max-w-md rounded-t-xl border border-border bg-surface p-5 shadow-xl sm:rounded-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="add-customer-title" className="text-sm font-semibold">Add customer</h2>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-fg" aria-label="Close"><X size={16} /></button>
            </div>
            <form action={submit} className="space-y-3">
              <label className="block text-xs text-muted">Name<input name="name" required maxLength={120} autoFocus className={cn(inputCls, "mt-1")} placeholder="Ada Okafor" /></label>
              <label className="block text-xs text-muted">
                WhatsApp phone
                <input name="phone" required inputMode="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} className={cn(inputCls, "mt-1")} placeholder="0803 123 4567" />
                {phone.trim() && <span className={cn("mt-1 block text-[11px]", normalized ? "text-muted" : "text-danger")}>{normalized ? `Saved as ${normalized}` : "Not a valid phone number yet"}</span>}
              </label>
              <label className="block text-xs text-muted">Email <span className="opacity-70">(optional)</span><input name="email" type="email" maxLength={200} className={cn(inputCls, "mt-1")} /></label>
              <label className="block text-xs text-muted">Notes <span className="opacity-70">(optional)</span><textarea name="notes" rows={3} maxLength={2000} className={cn(inputCls, "mt-1")} /></label>
              {error && <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className={btn} onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" disabled={pending} className={cn(btnPrimary, "disabled:opacity-50")}>{pending && <Loader2 size={14} className="animate-spin" />}Save customer</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
