"use client";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CountUp } from "./motion";

const PILLS = [
  { label: "Active", n: 42, cls: "bg-success/10 text-success" },
  { label: "Due to return", n: 9, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  { label: "At risk", n: 6, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  { label: "Lapsed", n: 14, cls: "bg-danger/10 text-danger" },
];
const MSG = "Hi Ngozi, it's been about 5 weeks since your last braids appointment at Ada's Braids. Would you like me to find you a slot this weekend? 😊";

/** Relationship stats count up, a customer's visit rhythm draws itself, then the check-in message types out. */
export function CareDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  const [typed, setTyped] = useState(reduce ? MSG.length : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    let i = 0; let id: ReturnType<typeof setInterval>;
    const start = setTimeout(() => { id = setInterval(() => { i += 2; setTyped(Math.min(i, MSG.length)); if (i >= MSG.length) clearInterval(id); }, 28); }, 1800);
    return () => { clearTimeout(start); clearInterval(id); };
  }, [inView, reduce]);

  // visits: weeks since first visit; today is the "due" marker
  const visits = [8, 27, 47, 66];
  return (
    <div ref={ref} className="rounded-xl border border-border bg-bg p-5 text-sm shadow-lg shadow-black/5">
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {PILLS.map((p) => <span key={p.label} className={`rounded-full px-2.5 py-1 ${p.cls}`}>{p.label} <CountUp to={p.n} className="font-semibold tabular-nums" /></span>)}
      </div>
      <div className="mb-4 rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted"><span>Ngozi · usually back every ~5 weeks</span><span className="text-amber-600 dark:text-amber-400">due now</span></div>
        <div className="relative h-8">
          <motion.div className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-border" initial={{ width: 0 }} animate={inView ? { width: "100%" } : {}} transition={{ duration: 1.2 }} />
          {visits.map((v, i) => <motion.span key={v} className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${v}%` }} initial={{ scale: 0 }} animate={inView ? { scale: 1 } : {}} transition={{ delay: 0.3 + i * 0.25, type: "spring", stiffness: 400, damping: 16 }} />)}
          <motion.span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-500 bg-surface" style={{ left: "92%" }} initial={{ scale: 0 }} animate={inView ? { scale: [0, 1.4, 1] } : {}} transition={{ delay: 1.4, duration: 0.5 }}><span className="mk-ping absolute inset-0 rounded-full bg-amber-500/50" /></motion.span>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted"><span>First visit</span><span>Expected back</span></div>
      </div>
      <p className="min-h-[4.5rem] max-w-[92%] rounded-2xl rounded-tl-sm bg-surface px-3 py-2">{MSG.slice(0, typed)}{typed < MSG.length && <span className="mk-caret" />}</p>
      <p className="mt-3 text-center text-[11px] text-muted">An example of a check-in message</p>
    </div>
  );
}
