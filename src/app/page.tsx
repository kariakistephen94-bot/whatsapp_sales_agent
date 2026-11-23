import Link from "next/link";
import type { Metadata } from "next";
import { CalendarCheck, HeartHandshake, MessageCircle, ShoppingBag, Store, UserCog, Users, BarChart3, Check, ShieldCheck, ArrowRight } from "lucide-react";
import { from, run, type Plan } from "@/server/db";
import { formatKobo } from "@/lib/locale";
import { Reveal, Stagger, Item, Glow, ScrollBar, Marquee } from "@/components/marketing/motion";
import { HeroChat } from "@/components/marketing/hero-chat";
import { CareDemo } from "@/components/marketing/care-demo";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "WhatsApp AI Sales — an AI that sells, books and follows up for you on WhatsApp",
  description: "Stop losing sales to slow replies. Your AI assistant answers customers, takes orders, books appointments and wins back regulars on your own WhatsApp number. Free for 14 days.",
};

const FALLBACK_PLANS = [
  { key: "starter", name: "Starter", priceCents: 1_500_000, limits: { aiMessagesMonthly: 2000, customers: 1000, teamMembers: 3, whatsappConnections: 1 } },
  { key: "professional", name: "Professional", priceCents: 4_000_000, limits: { aiMessagesMonthly: 10000, customers: 10000, teamMembers: 10, whatsappConnections: 2 } },
  { key: "business", name: "Business", priceCents: 10_000_000, limits: { aiMessagesMonthly: 50000, customers: 50000, teamMembers: 30, whatsappConnections: 5 } },
];
type PlanLite = { key: string; name: string; priceCents: number; limits: Record<string, number> };

async function loadPlans(): Promise<PlanLite[]> {
  try {
    const rows = await run<Plan[]>(from("Plan").select("*").eq("active", true).gt("priceCents", 0).order("priceCents", { ascending: true }));
    return rows.length ? rows.map((p) => ({ key: p.key, name: p.name, priceCents: p.priceCents, limits: p.limits as Record<string, number> })) : FALLBACK_PLANS;
  } catch { return FALLBACK_PLANS; }
}

const FEATURES = [
  { icon: MessageCircle, title: "Replies in seconds, any hour", body: "Answers on your own WhatsApp number in English, Pidgin, Yoruba, Igbo or Hausa, using only the prices and facts you've given it." },
  { icon: ShoppingBag, title: "Takes orders without guessing", body: "Prices, stock and delivery come straight from your catalogue. Orders stay unpaid until you confirm payment, so your books stay honest." },
  { icon: CalendarCheck, title: "Books real appointments", body: "Checks your staff's actual hours and existing bookings, so no double-bookings and no no-shows without a reminder." },
  { icon: UserCog, title: "Take over in one tap", body: "Step into any chat whenever you like. The AI goes quiet, and your team gets a WhatsApp alert when a customer needs a person." },
  { icon: Users, title: "A CRM that fills itself", body: "Every customer gets a profile with orders, visits, preferences and notes, built from the conversation. No data entry." },
  { icon: Store, title: "A free storefront link", body: "Share one link where customers browse, order or book. It runs on the same catalogue and calendar as your chats." },
];

const INDUSTRIES = ["Salons & braiding", "Skincare & cosmetics", "Solar & electronics", "Restaurants & cakes", "Fashion & tailoring", "Clinics & pharmacies", "Fitness & coaching", "Real estate", "Auto & logistics", "Schools & tutors", "Events & photography", "Phones & gadgets"];

const FAQ = [
  ["Which WhatsApp number do I use?", "Any number. Scan a QR code, the same way you'd link WhatsApp Web. We recommend a dedicated business number so your personal chats stay private."],
  ["Can it quote the wrong price?", "No. It can't quote a price it hasn't been given. Prices, stock and availability are looked up from your catalogue and calendar every time, and when it isn't sure it hands the chat to you instead of guessing."],
  ["What if a customer wants a real person?", "The AI hands over straight away and alerts you on WhatsApp. It stays silent until you hand the chat back."],
  ["How does it bring old customers back?", "It learns how often each customer usually buys or books. When someone is due, drifting or gone quiet, it sends one short, friendly message in your voice. A few tries at most, only in your chosen hours, and never to anyone who replied STOP."],
  ["How do I pay, and can I cancel?", "Plans run for 30 days and are paid with Paystack by card, bank transfer or USSD. No contract: if you don't renew, the AI and automations simply pause."],
  ["Is my customers' data safe?", "Every business's data is isolated from every other business, WhatsApp sessions are encrypted at rest, and you can export or delete any customer's data at any time."],
];

const STATS = [["< 10s", "typical first reply"], ["24/7", "answering, even at 2 am"], ["10 min", "to set up"], ["0", "invented prices"]];

export default async function Home() {
  const plans = await loadPlans();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight"><span className="grid size-6 place-items-center rounded-md bg-accent text-accent-fg"><MessageCircle size={14} /></span>WhatsApp AI Sales</Link>
          <nav className="ml-auto hidden gap-6 text-sm text-muted sm:flex"><a href="#features" className="transition-colors hover:text-fg">Features</a><a href="#care" className="transition-colors hover:text-fg">Win-backs</a><a href="#pricing" className="transition-colors hover:text-fg">Pricing</a><a href="#faq" className="transition-colors hover:text-fg">FAQ</a></nav>
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <Link href="/login" className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-fg">Sign in</Link>
            <Link href="/register" className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-fg transition hover:opacity-90 active:scale-95">Start free</Link>
          </div>
        </div>
        <ScrollBar />
      </header>

      <main>
        <section className="relative">
          <Glow />
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:pt-20">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <Reveal>
                <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted"><span className="size-1.5 rounded-full bg-success" />Built for Nigerian businesses · 14 days free</p>
                <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.4rem]">Every WhatsApp message answered. <span className="text-accent">Every customer brought back.</span></h1>
                <p className="mt-5 max-w-xl text-lg text-muted">Your AI assistant replies in seconds, takes orders, books appointments and follows up with regulars, all from your own WhatsApp number, with you always in control.</p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href="/register" className="group inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg shadow-lg shadow-accent/20 transition hover:opacity-90 active:scale-95">Start free for 14 days<ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></Link>
                  <a href="#how" className="rounded-md border border-border bg-surface px-5 py-2.5 text-sm transition hover:border-accent/50">See how it works</a>
                </div>
                <p className="mt-3 text-xs text-muted">No card needed. Live on WhatsApp in about 10 minutes.</p>
              </Reveal>
              <Reveal delay={0.15} y={28}><HeroChat /></Reveal>
            </div>
            <Reveal delay={0.2}>
              <dl className="mt-14 grid grid-cols-2 gap-4 border-t border-border pt-8 sm:grid-cols-4">
                {STATS.map(([v, l]) => <div key={l}><dt className="text-2xl font-semibold tracking-tight text-accent">{v}</dt><dd className="text-sm text-muted">{l}</dd></div>)}
              </dl>
            </Reveal>
          </div>
        </section>

        <section className="border-y border-border bg-surface py-5">
          <p className="mb-3 text-center text-xs uppercase tracking-widest text-muted">Made for businesses that sell on WhatsApp</p>
          <Marquee items={INDUSTRIES} />
        </section>

        <section id="how" className="mx-auto max-w-6xl px-4 py-16">
          <Reveal><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Live in three steps</h2><p className="mt-2 text-muted">No developers, no new number, no new app for your customers.</p></Reveal>
          <Stagger className="relative mt-10 grid gap-8 sm:grid-cols-3">
            <div aria-hidden className="absolute left-[16%] right-[16%] top-4 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent sm:block" />
            {[["1", "Connect your number", "Scan one QR code from your dashboard. It's the same as linking WhatsApp Web."], ["2", "Teach it your business", "Add your products or services, prices, hours and policies. Or just describe them and let AI write it for you."], ["3", "Switch it on", "Test in the playground, then go live. The assistant starts replying and you can watch every chat."]].map(([n, t, b]) => (
              <Item key={n} className="relative"><div className="mb-3 grid size-9 place-items-center rounded-full border border-accent/30 bg-bg text-sm font-semibold text-accent">{n}</div><h3 className="font-medium">{t}</h3><p className="mt-1.5 text-sm text-muted">{b}</p></Item>
            ))}
          </Stagger>
        </section>

        <section id="features" className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <Reveal><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your sales team, without the payroll</h2>
            <p className="mt-2 max-w-2xl text-muted">The assistant, your calendar, your catalogue and your customer list work together, so nothing falls through the cracks.</p></Reveal>
            <Stagger className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" gap={0.07}>
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <Item key={title}><div className="group h-full rounded-lg border border-border bg-bg p-5 transition duration-300 hover:-translate-y-1 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/5"><span className="grid size-9 place-items-center rounded-md bg-accent/10 text-accent transition-transform duration-300 group-hover:scale-110"><Icon size={18} /></span><h3 className="mt-3 font-medium">{title}</h3><p className="mt-1.5 text-sm text-muted">{body}</p></div></Item>
              ))}
            </Stagger>
          </div>
        </section>

        <section id="care" className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <Reveal>
              <HeartHandshake size={20} className="text-accent" />
              <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Most sales are lost after the first visit. Not anymore.</h2>
              <p className="mt-3 text-muted">The assistant learns how often each customer buys or books, and notices the moment someone is due back, drifting away or gone quiet. Then it reaches out for you.</p>
              <ul className="mt-5 space-y-2.5 text-sm">
                {["Learns each customer's rhythm from their orders and bookings", "Messages when they're due, based on what they usually get", "Gives up after a few tries, and never contacts anyone who said STOP", "Sends only in your chosen hours, spaced out so it never feels like a blast", "Shows every customer's status in your CRM: active, due, at risk or lapsed"].map((t) => (
                  <li key={t} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-success" />{t}</li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.12}><CareDemo /></Reveal>
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <Stagger className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:grid-cols-3">
            {[[BarChart3, "Know what's working", "Revenue, AI-handled sales, busiest hours and response times, with one-click export."], [ShieldCheck, "You stay in charge", "Test in a sandbox, take over any chat, or switch the AI off whenever you like. Opt-out is built in."], [UserCog, "Made for teams", "Invite staff by WhatsApp, assign chats and customers, and get hand-off alerts on your phone."]].map(([Icon, t, b]) => {
              const I = Icon as typeof BarChart3;
              return <Item key={t as string}><div className="h-full rounded-lg border border-border bg-bg p-5 transition duration-300 hover:-translate-y-1 hover:border-accent/50"><I size={18} className="text-accent" /><h3 className="mt-3 font-medium">{t as string}</h3><p className="mt-1.5 text-sm text-muted">{b as string}</p></div></Item>;
            })}
          </Stagger>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl px-4 py-16">
          <Reveal><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Pays for itself with one extra booking</h2><p className="mt-2 text-muted">Simple monthly pricing in Naira. Try everything free for 14 days. Cancel any time.</p></Reveal>
          <Stagger className="mt-8 grid gap-4 md:grid-cols-3">
            {plans.slice(0, 3).map((p, i) => (
              <Item key={p.key} className="h-full"><div className={`relative flex h-full flex-col rounded-lg border bg-surface p-5 transition duration-300 hover:-translate-y-1 ${i === 1 ? "border-accent shadow-lg shadow-accent/10" : "border-border hover:border-accent/50"}`}>
                <div className="flex items-center justify-between"><h3 className="font-medium">{p.name}</h3>{i === 1 && <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-fg">Most popular</span>}</div>
                <div className="mt-3"><span className="text-3xl font-semibold tabular-nums">{formatKobo(p.priceCents)}</span><span className="text-sm text-muted"> / month</span></div>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {[`${(p.limits.aiMessagesMonthly ?? 0).toLocaleString("en-NG")} AI replies a month`, `${(p.limits.customers ?? 0).toLocaleString("en-NG")} customers`, `${p.limits.teamMembers} team members`, `${p.limits.whatsappConnections} WhatsApp number${p.limits.whatsappConnections === 1 ? "" : "s"}`, "Orders, bookings, CRM & storefront", "Reminders & customer win-backs"].map((t) => (
                    <li key={t} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-success" />{t}</li>
                  ))}
                </ul>
                <Link href="/register" className={`mt-5 rounded-md px-4 py-2 text-center text-sm transition active:scale-95 ${i === 1 ? "bg-accent text-accent-fg hover:opacity-90" : "border border-border hover:border-accent/50"}`}>Start free trial</Link>
              </div></Item>
            ))}
          </Stagger>
          <p className="mt-4 text-xs text-muted">Several branches or a larger team? Ask us about Enterprise.</p>
        </section>

        <section id="faq" className="border-t border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-16">
            <Reveal><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Questions, answered</h2></Reveal>
            <Reveal delay={0.1} className="mt-6 divide-y divide-border rounded-lg border border-border bg-bg">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium marker:hidden">{q}<span aria-hidden className="text-lg leading-none text-muted transition-transform duration-200 group-open:rotate-45">+</span></summary><p className="mt-2 text-sm text-muted">{a}</p></details>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="relative overflow-hidden">
          <Glow />
          <Reveal className="mx-auto max-w-3xl px-4 py-20 text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">The next message is a customer. Be there.</h2>
            <p className="mt-3 text-muted">Set it up this afternoon. See your first AI-booked appointment tonight.</p>
            <Link href="/register" className="group mt-7 inline-flex items-center gap-2 rounded-md bg-accent px-6 py-3 text-sm font-medium text-accent-fg shadow-lg shadow-accent/20 transition hover:opacity-90 active:scale-95">Start free for 14 days<ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></Link>
            <p className="mt-3 text-xs text-muted">No card needed.</p>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted">
          <span>© {new Date().getFullYear()} WhatsApp AI Sales</span>
          <span className="flex gap-4"><Link href="/login" className="hover:text-fg">Sign in</Link><Link href="/register" className="hover:text-fg">Register</Link></span>
        </div>
      </footer>
    </div>
  );
}
