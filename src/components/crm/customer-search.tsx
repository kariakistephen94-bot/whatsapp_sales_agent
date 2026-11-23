"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Debounced search box that writes ?q= to the URL (keeps the active segment, resets paging). */
export function CustomerSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(initial);
  const [pending, start] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => {
      const u = new URLSearchParams(params.toString());
      if (q.trim()) u.set("q", q.trim()); else u.delete("q");
      u.delete("page");
      const s = u.toString();
      start(() => router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="relative w-full max-w-xs">
      <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className={cn(inputCls, "pl-8")} />
      {pending && <Loader2 size={14} className="absolute right-2.5 top-2.5 animate-spin text-muted" />}
    </div>
  );
}
