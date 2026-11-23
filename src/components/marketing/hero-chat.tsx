"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarCheck, Check } from "lucide-react";
import { useEffect, useState } from "react";

type Step = { from: "them" | "ai"; text: string } | { from: "card" };
const STEPS: Step[] = [
  { from: "them", text: "Hi, do you do knotless braids? How much, and are you free this Saturday?" },
  { from: "ai", text: "Yes we do! Knotless braids are ₦45,000 and take about 2 hours. Saturday I have 10:00 am, 1:00 pm and 3:30 pm open. Which suits you?" },
  { from: "them", text: "1pm please 🙏" },
  { from: "ai", text: "Booked! Saturday 1:00 pm with Amara. I'll remind you the day before." },
  { from: "card" },
];

/** Plays the example chat message by message with a typing indicator, then loops. */
export function HeroChat() {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? STEPS.length : 0);
  const [typing, setTyping] = useState<"them" | "ai" | null>(null);

  useEffect(() => {
    if (reduce) return;
    let dead = false;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (!dead) {
        setShown(0); await wait(700);
        for (let i = 0; i < STEPS.length && !dead; i++) {
          const s = STEPS[i];
          if (s.from !== "card") { setTyping(s.from); await wait(s.from === "ai" ? 1300 : 850); }
          if (dead) return;
          setTyping(null); setShown(i + 1); await wait(s.from === "card" ? 0 : 600);
        }
        await wait(5000);
      }
    })();
    return () => { dead = true; };
  }, [reduce]);

  return (
    <div className="mx-auto w-full max-w-sm" aria-label="Example conversation">
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-xl shadow-black/5">
        <div className="mb-3 flex items-center gap-2 border-b border-border pb-3 text-sm font-medium">
          <span className="grid size-8 place-items-center rounded-full bg-accent/15 text-xs text-accent">A</span>
          <div className="leading-tight">Ada&apos;s Braids<div className="flex items-center gap-1 text-[11px] font-normal text-success"><span className="mk-pulse size-1.5 rounded-full bg-success" />AI assistant online</div></div>
        </div>
        <div className="min-h-[19rem] space-y-2 text-sm">
          <AnimatePresence initial={false}>
            {STEPS.slice(0, shown).map((s, i) => s.from === "card" ? (
              <motion.div key={i} initial={{ opacity: 0, scale: 0.92, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs">
                <span className="grid size-7 place-items-center rounded-full bg-accent text-accent-fg"><CalendarCheck size={14} /></span>
                <span><b className="block text-sm font-medium">Booking confirmed</b>Sat · 1:00 pm · Knotless braids · ₦45,000</span>
                <Check size={14} className="ml-auto text-success" />
              </motion.div>
            ) : (
              <motion.p key={i} initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.3 }}
                className={s.from === "ai" ? "ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-accent px-3 py-2 text-accent-fg" : "max-w-[85%] rounded-2xl rounded-tl-sm bg-bg px-3 py-2"}>{s.text}</motion.p>
            ))}
          </AnimatePresence>
          {typing && (
            <div className={`flex w-14 gap-1 rounded-2xl px-3 py-3 ${typing === "ai" ? "ml-auto bg-accent/80" : "bg-bg"}`} aria-hidden>
              {[0, 1, 2].map((d) => <span key={d} className={`mk-dot size-1.5 rounded-full ${typing === "ai" ? "bg-accent-fg" : "bg-muted"}`} style={{ animationDelay: `${d * 0.15}s` }} />)}
            </div>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted">An example of a chat the assistant handles</p>
      </div>
    </div>
  );
}
