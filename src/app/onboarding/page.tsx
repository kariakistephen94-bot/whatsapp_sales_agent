import { redirect } from "next/navigation";
import { getTenantContext, HttpError } from "@/modules/tenancy/context";
import { from, must, maybe, run, one } from "@/server/db";
import { INDUSTRIES } from "@/modules/industries/templates";
import { Wizard } from "@/components/onboarding/wizard";
import { aiConfigured } from "@/modules/ai/engine";

export default async function OnboardingPage() {
  let ctx;
  try { ctx = await getTenantContext("ADMIN"); }
  catch (e) { if (e instanceof HttpError && e.status === 401) redirect("/login"); throw e; }
  const org = await must<Record<string, any>>(
    from("Organization").select("name, description, country, city, website, email, phone, address, industryTemplateKey, businessType, operations, onboardingCompletedAt, onboardingStep, agent:AiAgent(*), storefront:Storefront(*)").eq("id", ctx.organizationId).single(),
  );
  if (org.onboardingCompletedAt) redirect("/dashboard");

  const knowledge = await run<{ type: string; title: string; content: string | null; url: string | null }[]>(ctx.db.from("KnowledgeSource").select("type, title, content, url").in("type", ["faq", "url"]).order("createdAt", { ascending: true }).limit(60));
  const agent = one(org.agent) as Record<string, any> | null;
  const store = one(org.storefront) as Record<string, any> | null;
  const pick = (o: Record<string, any> | null, keys: string[]) => Object.fromEntries(keys.filter((k) => o && o[k] != null && o[k] !== "").map((k) => [k, o![k]]));
  // What the owner already saved, so resuming (or coming back) never overwrites it with blanks.
  const initial = {
    profile: pick(org, ["name", "description", "country", "city", "website", "email", "phone", "address"]),
    industry: org.industryTemplateKey ?? "",
    businessType: org.businessType ?? "",
    answers: (org.operations ?? {}) as Record<string, string | boolean>,
    faqs: knowledge.filter((k) => k.type === "faq" && k.content).map((k) => ({ title: k.title, content: k.content! })),
    urls: knowledge.filter((k) => k.type === "url" && k.url).map((k) => k.url!).join("\n"),
    agent: pick(agent, ["name", "personality", "tone", "language", "formality", "responseLength", "greeting", "salesStrategy", "instructions"]),
    store: pick(store, ["name", "description", "brandColor", "published"]),
  };
  const industries = Object.values(INDUSTRIES).map((i) => ({ key: i.key, label: i.label, operationsFields: i.operationsFields, terms: i.terms }));
  return <Wizard businessName={org.name} startStep={Math.min(org.onboardingStep, 8)} industries={industries} aiReady={aiConfigured()} initial={initial} />;
}

export const dynamic = "force-dynamic";
