"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGES, LOCALE, NG_CITIES, normalizeNgPhone } from "@/lib/locale";
import { ConnectionPanel } from "@/components/whatsapp/connection-panel";
import { Playground } from "@/components/agent/playground";
import { WriteWithAi } from "@/components/agent/write-with-ai";
import { BrandProvider } from "@/components/brand/brand-context";

type Field = { key: string; label: string; type: string; hint?: string };
type Industry = { key: string; label: string; operationsFields: Field[]; terms: { items: string } };

const STEPS = ["Business", "Category", "Operations", "Knowledge", "AI agent", "WhatsApp", "Storefront", "Launch"];
const input = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40";
const PERSONALITIES = ["Friendly and conversational", "Professional and corporate", "Premium and luxury", "Persuasive sales assistant", "Warm and welcoming"];

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium">{children}</span>{hint && <span className="mb-1 block text-xs text-muted">{hint}</span>}</label>;
}

export type WizardInitial = { profile: Record<string, any>; industry: string; businessType: string; answers: Record<string, string | boolean>; faqs: { title: string; content: string }[]; urls: string; agent: Record<string, any>; store: Record<string, any> };

export function Wizard({ businessName, startStep, industries, aiReady, initial }: { businessName: string; startStep: number; industries: Industry[]; aiReady: boolean; initial?: WizardInitial }) {
  const [step, setStep] = useState(startStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [profile, setProfile] = useState({ name: businessName, description: "", country: LOCALE.country, city: "", website: "", email: "", phone: "", address: "", timezone: LOCALE.timezone, currency: LOCALE.currency, ...(initial?.profile ?? {}) });
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [businessType, setBusinessType] = useState(initial?.businessType ?? "");
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(initial?.answers ?? {});
  const [faqs, setFaqs] = useState(initial?.faqs?.length ? initial.faqs : [{ title: "", content: "" }]);
  const [urls, setUrls] = useState(initial?.urls ?? "");
  const [agent, setAgent] = useState({ name: "Ava", personality: PERSONALITIES[0], tone: "warm", language: "English", formality: "neutral", responseLength: "medium", greeting: "", salesStrategy: "consultative", instructions: "", ...(initial?.agent ?? {}) });
  const [store, setStore] = useState({ name: businessName, description: "", brandColor: "#0f766e", published: false, ...(initial?.store ?? {}) });

  const ind = industries.find((i) => i.key === industry);

  async function save(s: number, data: unknown, next = s + 1) {
    setBusy(true); setError("");
    const r = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step: s, data }) });
    setBusy(false);
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? "Could not save. Check your inputs."); return false; }
    if (s === 8) { window.location.href = "/dashboard"; return true; }
    setStep(next); return true;
  }

  const submit = () => {
    switch (step) {
      case 1: {
        if (profile.phone && !normalizeNgPhone(profile.phone)) return setError("Enter a valid phone number, e.g. 0803 123 4567");
        return save(1, { ...profile, phone: profile.phone ? normalizeNgPhone(profile.phone) ?? profile.phone : "", email: profile.email || undefined });
      }
      case 2: return industry ? save(2, { industry, businessType: businessType || undefined }) : setError("Pick a category");
      case 3: return save(3, { answers });
      case 4: return save(4, { entries: [
        ...faqs.filter((f) => f.title && f.content).map((f) => ({ type: "faq" as const, ...f })),
        ...urls.split("\n").map((u) => u.trim()).filter(Boolean).map((url) => ({ type: "url" as const, title: url, url })),
      ] });
      case 5: return save(5, agent);
      case 6: return save(6, {});
      case 7: return save(7, store);
      case 8: return save(8, {});
    }
  };

  return (
    <BrandProvider brand={{ name: profile.name, industryKey: industry || null, industryLabel: ind?.label, businessType, description: profile.description }}>
    <div className="mx-auto max-w-2xl px-4 py-10">
      <ol className="mb-8 flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-1.5">
            <div className={cn("h-1 rounded-full transition-colors", i + 1 <= step ? "bg-accent" : "bg-border")} />
            <span className={cn("hidden text-[11px] sm:block", i + 1 === step ? "text-fg" : "text-muted")}>{s}</span>
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="space-y-4">
          {step === 1 && (<>
            <Header title="Tell us about your business" sub="This helps your AI agent represent you accurately." />
            <div><Label>Business name</Label><input className={input} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></div>
            <div><Label>Description</Label><textarea className={input} rows={3} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} />
              <div className="mt-2"><WriteWithAi kind="description" current={profile.description} onApply={(t) => setProfile((p) => ({ ...p, description: t }))} context={{ name: profile.name, city: profile.city, address: profile.address, website: profile.website }} /></div></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Country</Label><input className={cn(input, "text-muted")} value={LOCALE.country} readOnly /></div>
              <div><Label>City</Label><input list="ng-cities" placeholder="Lagos" className={input} value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} /><datalist id="ng-cities">{NG_CITIES.map((c) => <option key={c} value={c} />)}</datalist></div>
              <div><Label>Business email</Label><input type="email" className={input} value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></div>
              <div><Label>Business phone</Label><input type="tel" placeholder="0803 123 4567" className={input} value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></div>
              <div><Label>Currency</Label><input className={cn(input, "text-muted")} value="Nigerian Naira (₦)" readOnly /></div>
              <div><Label>Time zone</Label><input className={cn(input, "text-muted")} value="Lagos (WAT, UTC+1)" readOnly /></div>
            </div>
            <div><Label>Address</Label><input className={input} value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></div>
            <div><Label>Website or social link</Label><input className={input} value={profile.website} onChange={(e) => setProfile({ ...profile, website: e.target.value })} /></div>
          </>)}

          {step === 2 && (<>
            <Header title="What kind of business is it?" sub="We'll tailor the dashboard, questions and AI to your industry." />
            <div className="grid gap-2 sm:grid-cols-2">
              {industries.map((i) => (
                <button key={i.key} type="button" onClick={() => setIndustry(i.key)}
                  className={cn("flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors", industry === i.key ? "border-accent bg-accent/5" : "border-border bg-surface hover:border-muted")}>
                  {i.label}{industry === i.key && <Check size={15} className="text-accent" />}
                </button>
              ))}
            </div>
            {industry === "other" && <div><Label>Describe your business</Label><textarea className={input} rows={3} value={businessType} onChange={(e) => setBusinessType(e.target.value)} /><div className="mt-2"><WriteWithAi kind="field" current={businessType} onApply={(t) => setBusinessType(t)} context={{ fieldType: "textarea", fieldKey: "businessType", fieldLabel: "Describe your business", purpose: "A short plain description of what this business sells or does, who for and where.", maxChars: "400" }} /></div></div>}
          </>)}

          {step === 3 && ind && (<>
            <Header title={`Set up your ${ind.terms.items.toLowerCase()}`} sub="Only what's relevant to your business. The AI will only quote what you enter here." />
            {ind.operationsFields.map((f) => (
              <div key={f.key}>
                <Label hint={f.hint ?? (f.type === "list" ? (ind.terms.items.match(/service|class|course|room/i) ? "One per line: Name | price in ₦ | minutes, e.g. Knotless braids | 45000 | 240" : "One per line: Name | price in ₦ | stock, e.g. Ankara dress | 18500 | 12") : f.type === "hours" ? "e.g. Mon–Fri 9:00–18:00, Sat 10:00–16:00" : undefined)}>{f.label}</Label>
                {f.type === "toggle" ? (
                  <input type="checkbox" checked={!!answers[f.key]} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.checked })} />
                ) : f.type === "text" || f.type === "number" ? (
                  <input className={input} value={(answers[f.key] as string) ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />
                ) : (
                  <textarea className={cn(input, "font-mono text-xs")} rows={f.type === "list" ? 5 : 3} value={(answers[f.key] as string) ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />
                )}
                {(f.type === "list" || f.type === "hours" || f.type === "textarea") && (
                  <div className="mt-2"><WriteWithAi kind="field" current={(answers[f.key] as string) ?? ""} onApply={(t) => setAnswers((a) => ({ ...a, [f.key]: t }))}
                    context={{ fieldKey: f.key, fieldLabel: f.label, fieldType: f.type, fieldHint: f.hint ?? "" }} /></div>
                )}
              </div>
            ))}
          </>)}

          {step === 4 && (<>
            <Header title="Teach your agent" sub="Verified information only. The agent will not invent prices, stock, availability or policies." />
            {faqs.map((f, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                <input className={input} placeholder="Question or topic" value={f.title} onChange={(e) => setFaqs(faqs.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                <textarea className={input} rows={Math.min(8, Math.max(2, Math.ceil(f.content.length / 80)))} placeholder="Answer" value={f.content} onChange={(e) => setFaqs(faqs.map((x, j) => j === i ? { ...x, content: e.target.value } : x))} />
                {faqs.length > 1 && <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            ))}
            <WriteWithAi kind="field" current={faqs.filter((f) => f.title && f.content).map((f) => `Q: ${f.title}\nA: ${f.content}`).join("\n\n")}
              onApply={(t) => {
                const parsed = t.split(/\n\s*\n/).map((b) => b.match(/^Q:\s*(.+?)\s*\n+A:\s*([\s\S]+)$/i)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ title: m[1], content: m[2] }));
                setFaqs(parsed.length ? parsed : [{ title: "", content: "" }]);
              }}
              context={{ fieldKey: "faqs", fieldLabel: "Frequently asked questions", fieldType: "faq_list", maxChars: "12000", related: `Business: ${profile.name}; industry: ${ind?.label ?? ""}; city: ${profile.city}` }} />
            <button type="button" className="text-sm text-accent" onClick={() => setFaqs([...faqs, { title: "", content: "" }])}>+ Add FAQ / policy</button>
            <div><Label hint="One per line">Website URLs</Label><textarea className={input} rows={2} value={urls} onChange={(e) => setUrls(e.target.value)} /></div>
            <p className="text-xs text-muted">Document and image uploads arrive with the knowledge-base module; you can skip this step now and add more later.</p>
          </>)}

          {step === 5 && (<>
            <Header title="Shape your AI agent" sub="You can change all of this later in AI Agent settings." />
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Agent name</Label><input className={input} value={agent.name} onChange={(e) => setAgent({ ...agent, name: e.target.value })} /></div>
              <div><Label>Language</Label><select className={input} value={agent.language} onChange={(e) => setAgent({ ...agent, language: e.target.value })}>{LANGUAGES.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><Label>Formality</Label><select className={input} value={agent.formality} onChange={(e) => setAgent({ ...agent, formality: e.target.value })}>{["casual", "neutral", "formal"].map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><Label>Response length</Label><select className={input} value={agent.responseLength} onChange={(e) => setAgent({ ...agent, responseLength: e.target.value })}>{["short", "medium", "long"].map((x) => <option key={x}>{x}</option>)}</select></div>
            </div>
            <div><Label>Personality</Label><select className={input} value={agent.personality} onChange={(e) => setAgent({ ...agent, personality: e.target.value })}>{PERSONALITIES.map((x) => <option key={x}>{x}</option>)}</select></div>
            <div><Label>Greeting message</Label><textarea className={input} rows={2} value={agent.greeting} onChange={(e) => setAgent({ ...agent, greeting: e.target.value })} /><div className="mt-2"><WriteWithAi kind="field" current={agent.greeting} onApply={(t) => setAgent((a) => ({ ...a, greeting: t }))} context={{ fieldType: "textarea", fieldKey: "greeting", fieldLabel: "Greeting message", purpose: "A warm one or two sentence WhatsApp greeting for a brand new customer, in the voice of the assistant named in related, mentioning the business by name and inviting them to ask. At most one emoji.", maxChars: "300", related: `Assistant name: ${agent.name}; tone: ${agent.personality}; business: ${profile.name}` }} /></div></div>
            <div><Label hint="Anything the agent should always or never do">Business instructions</Label><textarea className={input} rows={3} value={agent.instructions} onChange={(e) => setAgent({ ...agent, instructions: e.target.value })} /><div className="mt-2"><WriteWithAi current={agent.instructions} onApply={(t) => setAgent((a) => ({ ...a, instructions: t }))} /></div></div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Test your agent</span>
                <button type="button" disabled={busy} onClick={() => save(5, agent, 5)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-bg disabled:opacity-60">{busy ? "Saving…" : "Save & test"}</button>
              </div>
              <p className="text-xs text-muted">Chat as a customer. It uses your saved settings and the prices you entered; nothing is booked or ordered in test mode.</p>
              <Playground aiReady={aiReady} agentName={agent.name} dirty={false} />
            </div>
          </>)}

          {step === 6 && (<>
            <Header title="Connect WhatsApp" sub="Scan a QR code with the WhatsApp app on the business phone." />
            <ConnectionPanel />
            <p className="text-xs text-muted">Needs the background worker running (<code>npm run worker</code>). You can also skip and connect later in Settings.</p>
          </>)}

          {step === 7 && (<>
            <Header title="Your storefront" sub="A branded mini-site at /store/your-business." />
            <div><Label>Store name</Label><input className={input} value={store.name} onChange={(e) => setStore({ ...store, name: e.target.value })} /></div>
            <div><Label>Description</Label><textarea className={input} rows={3} value={store.description} onChange={(e) => setStore({ ...store, description: e.target.value })} />
              <div className="mt-2"><WriteWithAi kind="description" current={store.description} onApply={(t) => setStore((s) => ({ ...s, description: t }))} context={{ name: store.name || profile.name, city: profile.city }} /></div></div>
            <div className="flex items-center gap-3"><Label>Brand color</Label><input type="color" value={store.brandColor} onChange={(e) => setStore({ ...store, brandColor: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={store.published} onChange={(e) => setStore({ ...store, published: e.target.checked })} /> Publish storefront now</label>
          </>)}

          {step === 8 && (<>
            <Header title="You're ready to launch" sub="Review your setup, then enter your dashboard." />
            <ul className="space-y-2 text-sm">
              {["Business profile", "Industry & capabilities", "Operations", "Knowledge base", "AI agent configured", "Storefront"].map((x) => (
                <li key={x} className="flex items-center gap-2"><Check size={15} className="text-success" />{x}</li>
              ))}
              <li className="flex items-center gap-2 text-muted"><span className="inline-block size-[15px] rounded-full border border-border" />WhatsApp connection (optional, can be done later)</li>
            </ul>
          </>)}
        </motion.div>
      </AnimatePresence>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      <div className="mt-8 flex items-center justify-between">
        <button type="button" disabled={step === 1} onClick={() => setStep(step - 1)} className="flex items-center gap-1 text-sm text-muted disabled:invisible"><ChevronLeft size={15} />Back</button>
        <button type="button" disabled={busy} onClick={submit} className="rounded-md bg-accent px-4 py-2 text-sm text-accent-fg disabled:opacity-60">
          {busy ? "Saving…" : step === 8 ? "Enter dashboard" : step === 6 ? "Continue without connecting" : "Continue"}
        </button>
      </div>
    </div>
    </BrandProvider>
  );
}

function Header({ title, sub }: { title: string; sub: string }) {
  return <div className="mb-2"><h1 className="text-xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted">{sub}</p></div>;
}
