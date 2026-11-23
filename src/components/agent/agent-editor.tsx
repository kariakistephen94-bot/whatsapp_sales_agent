"use client";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Badge, Card, PageHeader, btnPrimary, inputCls } from "@/components/ui";
import { cn } from "@/lib/utils";
import { LANGUAGES } from "@/lib/locale";
import { saveAgent } from "@/modules/agent/actions";
import { KnowledgeManager, type KnowledgeRow } from "./knowledge-manager";
import { Playground } from "./playground";
import { WriteWithAi } from "./write-with-ai";

export interface AgentForm {
  name: string; language: string; personality: string; tone: string;
  formality: "casual" | "neutral" | "formal"; responseLength: "short" | "medium" | "long";
  greeting: string; instructions: string; salesStrategy: string; escalationNotes: string;
  active: boolean; model: string; enabledTools: string[];
}

const PERSONALITIES = ["friendly", "Friendly and conversational", "Professional and corporate", "Premium and luxury", "Persuasive sales assistant", "Warm and welcoming"];
const TONES = ["warm", "upbeat", "calm", "confident", "playful", "respectful"];
const STRATEGIES = ["Consultative", "Persuasive", "Informational only", "Upsell gently"];
const TABS = ["Personality", "Knowledge", "Tools", "Behaviour"] as const;

const withCurrent = (list: string[], v: string) => (v && !list.includes(v) ? [v, ...list] : list);

function Field({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function AgentEditor({ initial, tools, knowledge, aiReady, orgName }: {
  initial: AgentForm; tools: { key: string; description: string }[]; knowledge: KnowledgeRow[]; aiReady: boolean; orgName: string;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Personality");
  const [f, setF] = useState<AgentForm>(initial);
  const [saved, setSaved] = useState<AgentForm>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const set = <K extends keyof AgentForm>(k: K, v: AgentForm[K]) => { setF((p) => ({ ...p, [k]: v })); setMsg(null); };

  const save = (next: AgentForm = f) => start(async () => {
    const r = await saveAgent(next);
    if (r.ok) { setSaved(next); setMsg({ ok: true, text: "Saved" }); }
    else setMsg({ ok: false, text: r.error });
  });

  const toggleTool = (k: string) => {
    if (k === "escalate_to_human") return;
    set("enabledTools", f.enabledTools.includes(k) ? f.enabledTools.filter((t) => t !== k) : [...f.enabledTools, k]);
  };

  return (
    <div>
      <PageHeader title="AI Agent" sub="Configure, test and inspect your agent."
        actions={<>
          {saved.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Paused</Badge>}
          {msg && <span className={cn("text-xs", msg.ok ? "text-success" : "text-danger")}>{msg.text}</span>}
          <button className={btnPrimary} disabled={pending || !dirty} onClick={() => save()} style={{ opacity: pending || !dirty ? 0.6 : 1 }}>
            {pending && <Loader2 size={14} className="animate-spin" />}Save changes
          </button>
        </>} />

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0">
          <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === t ? "border-accent font-medium" : "border-transparent text-muted")}>{t}</button>
            ))}
          </div>

          {tab === "Personality" && (
            <Card><div className="grid gap-3 text-sm sm:grid-cols-2">
              <Field label="Agent name"><input className={inputCls} value={f.name} maxLength={60} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Main language" hint="The agent switches to Pidgin, Yoruba, Igbo or Hausa if the customer writes in it.">
                <select className={inputCls} value={f.language} onChange={(e) => set("language", e.target.value)}>{LANGUAGES.map((x) => <option key={x}>{x}</option>)}</select>
              </Field>
              <Field label="Personality"><select className={inputCls} value={f.personality} onChange={(e) => set("personality", e.target.value)}>{withCurrent(PERSONALITIES, f.personality).map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Tone"><select className={inputCls} value={f.tone} onChange={(e) => set("tone", e.target.value)}>{withCurrent(TONES, f.tone).map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Formality"><select className={inputCls} value={f.formality} onChange={(e) => set("formality", e.target.value as AgentForm["formality"])}>{["casual", "neutral", "formal"].map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Response length"><select className={inputCls} value={f.responseLength} onChange={(e) => set("responseLength", e.target.value as AgentForm["responseLength"])}>{["short", "medium", "long"].map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Greeting for new customers" className="sm:col-span-2"><textarea rows={2} maxLength={500} className={inputCls} value={f.greeting} placeholder={`Hi! I'm ${f.name || "Ava"} from ${orgName} 👋 How can I help you today?`} onChange={(e) => set("greeting", e.target.value)} /><div className="mt-2"><WriteWithAi kind="field" current={f.greeting} onApply={(t) => set("greeting", t)} context={{ fieldType: "textarea", fieldKey: "greeting", fieldLabel: "Greeting for new customers", purpose: "A warm one or two sentence WhatsApp greeting for a brand new customer, in the voice of the assistant named in related, mentioning the business by name and inviting them to ask. At most one emoji.", maxChars: "300", related: `Assistant name: ${f.name}; tone: ${f.tone}; business: ${orgName}` }} /></div></Field>
              <Field label="Business instructions" className="sm:col-span-2" hint="Rules the agent must follow, e.g. “Always mention our 12-hour cancellation policy when booking.”">
                <textarea rows={8} maxLength={16000} className={inputCls} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} />
              </Field>
              <div className="sm:col-span-2"><WriteWithAi current={f.instructions} onApply={(t) => set("instructions", t)} /></div>
            </div></Card>
          )}

          {tab === "Knowledge" && <KnowledgeManager rows={knowledge} />}

          {tab === "Tools" && (
            <Card title="Tools the agent can use" action={<span className="text-xs text-muted">Based on your business capabilities</span>}>
              <ul className="divide-y divide-border/60 text-sm">
                {tools.map((t) => {
                  const on = t.key === "escalate_to_human" || f.enabledTools.includes(t.key);
                  return (
                    <li key={t.key} className="flex items-start justify-between gap-4 py-2.5">
                      <div className="min-w-0"><code className="text-xs">{t.key}</code><div className="mt-0.5 text-xs text-muted">{t.description}</div>
                        {t.key === "escalate_to_human" && <div className="mt-0.5 text-[11px] text-muted">Always on — the agent must always be able to hand off to your team.</div>}</div>
                      <Toggle on={on} disabled={t.key === "escalate_to_human"} onClick={() => toggleTool(t.key)} />
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted">Prices, stock and availability always come from these tools — the agent never makes them up. In the playground, booking and ordering tools are simulated.</p>
            </Card>
          )}

          {tab === "Behaviour" && (
            <Card><div className="space-y-4 text-sm">
              <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
                <div><div className="font-medium">Agent active</div><div className="text-xs text-muted">When paused, the AI won’t reply on WhatsApp — messages wait for your team in Conversations.</div></div>
                <Toggle on={f.active} onClick={() => set("active", !f.active)} />
              </div>
              <Field label="Sales strategy"><select className={inputCls} value={f.salesStrategy || "Consultative"} onChange={(e) => set("salesStrategy", e.target.value)}>{withCurrent(STRATEGIES, f.salesStrategy).map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="Escalate to a human when…" hint="Saved with your escalation rules. The agent always escalates complaints, refunds and requests for a person.">
                <textarea rows={3} maxLength={2000} className={inputCls} value={f.escalationNotes} placeholder="Customer is upset or asks for a manager; bulk orders above ₦500,000; anything not covered by verified knowledge." onChange={(e) => set("escalationNotes", e.target.value)} /><div className="mt-2"><WriteWithAi kind="field" current={f.escalationNotes} onApply={(t) => set("escalationNotes", t)} context={{ fieldType: "textarea", fieldKey: "escalation", fieldLabel: "Escalate to a human when", purpose: "A short list, in one or two sentences separated by semicolons, of the situations when the assistant should hand the chat to a person (for example upset customers, large orders, things not covered by verified knowledge). Use only situations the owner mentions.", maxChars: "500" }} /></div>
              </Field>
              <Field label="Model override (optional)" hint="Leave empty to use the platform default model.">
                <input className={inputCls} value={f.model} maxLength={80} placeholder="e.g. gpt-4o-mini" onChange={(e) => set("model", e.target.value)} />
              </Field>
            </div></Card>
          )}
        </div>

        <Playground aiReady={aiReady} agentName={saved.name} dirty={dirty} />
      </div>
    </div>
  );
}

export function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onClick}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60", on ? "bg-accent" : "bg-border")}>
      <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}
