import { from, tenant, run, maybe, must, type Organization, type AiAgent } from "@/server/db";
import { completeText } from "@/modules/ai/engine";
import { toolsForCapabilities, getIndustry } from "@/modules/industries/templates";
import { asHours, describeHours, DEFAULT_HOURS } from "@/modules/appointments/hours";
import { parseHoursText } from "@/modules/appointments/hours";
import { PATTERN_SECTIONS, REFERENCE_PROMPT } from "./pattern";

export type QA = { question: string; answer: string };
export type Question = { id: string; question: string; hint?: string };
export type WriterResult = { status: "questions"; questions: Question[] } | { status: "ready"; text: string; note?: string };

export const MAX_INSTRUCTIONS = 16000;

const SYSTEM = `You write the "business instructions" for an AI sales assistant that chats with customers on WhatsApp for ONE specific business. The assistant's runtime already supplies date/time, customer profile, history and tool results, so you write only the behavioural rulebook.

${PATTERN_SECTIONS}

REFERENCE EXAMPLE (a different business, a solar installer). Copy its STRUCTURE, section names, strictness, hard numbers and style of examples. NEVER copy its facts: names, products, location, goal, prices or tools belong to that business only. Where the reference contradicts itself or repeats itself, resolve it once and do not repeat.
<reference>
${REFERENCE_PROMPT}
</reference>

HOW TO DECIDE WHAT TO DO
You answer with a single JSON object, one of:
  {"status":"questions","questions":[{"id":"q1","question":"...","hint":"short example answer"}]}
  {"status":"ready","text":"<the finished instructions>"}

Ask the business owner questions ONLY when something essential to a good rulebook is missing AND cannot be taken from the business profile, tools, hours, knowledge titles, existing instructions or the owner's brief. Examples of essential gaps: what single outcome the assistant should drive (a booking, an order, a visit, a quote request); whether the business wants the assistant to quote prices or send people to a call; where the business is based and where it serves; which languages customers use (e.g. Pidgin); what to do about delivery/payment/returns when the answer changes how the assistant must behave; any hard "never say/never do" rules; who to hand over to and when.
Rules for questions:
- At most 5, each one short, plain and answerable in a sentence, written to the business owner (not the customer), with a short example answer in "hint".
- Never ask something already answered by the context, by the owner's brief or by earlier answers. Never ask for facts only to fill space.
- If the context is already enough, do not ask: write.
- If "force_write" is true or earlier answers exist, you MUST return status "ready". Where something is still unknown, leave it out and say the team can confirm; never invent prices, stock, coverage, warranties, delivery, financing or hours.
Writing rules:
- Use only the real tool names listed in "tools". Do not mention tools that are not listed. If appointment tools are not listed, there is no booking workflow.
- Write in second person to the assistant ("You are ..."). Use the assistant's name. Keep the business's real name and facts exactly as given.
- Keep the whole text under ${MAX_INSTRUCTIONS - 2000} characters. Plain text with the section headings in capitals, like the reference. No markdown fences.
- If "current_instructions" is provided, treat it as the owner's existing rules: keep every rule and fact that is still valid, restructure into the pattern, and apply the owner's new brief on top.`;

async function businessContext(organizationId: string) {
  const t = tenant(organizationId);
  const [org, agent, knowledge, items] = await Promise.all([
    must<Organization>(from("Organization").select("*").eq("id", organizationId).single()),
    maybe<AiAgent>(t.from("AiAgent").select("*").maybeSingle()),
    run<{ title: string; type: string }[]>(t.from("KnowledgeSource").select("title, type").eq("verified", true).limit(40)),
    run<{ name: string; kind: string; priceCents: number }[]>(t.from("CatalogItem").select("name, kind, priceCents").eq("active", true).limit(25)),
  ]);
  const ops = (org.operations ?? {}) as Record<string, unknown>;
  return {
    business_name: org.name, industry: getIndustry(org.industryTemplateKey).label, offers: org.businessType, description: org.description,
    city: org.city, country: org.country, timezone: org.timezone, currency: "NGN (Naira)",
    business_hours: describeHours(asHours(org.businessHours) ?? DEFAULT_HOURS),
    setup_answers: Object.fromEntries(Object.entries(ops).filter(([, v]) => typeof v === "string" && v).slice(0, 12)),
    assistant: agent ? { name: agent.name, language: agent.language, tone: agent.tone, formality: agent.formality, sales_strategy: agent.salesStrategy } : null,
    tools: toolsForCapabilities(org.capabilities),
    knowledge_titles: knowledge.map((k) => `${k.type}: ${k.title}`),
    catalogue_sample: items.map((i) => `${i.name} (${i.kind.toLowerCase()})`),
    current_instructions: agent?.instructions ?? null,
  };
}

/** Round 1: may return questions for the owner. After answers (or force_write) it always returns the finished text. */
export async function writeInstructions(input: { organizationId: string; brief: string; answers: QA[]; forceWrite: boolean }): Promise<WriterResult> {
  const ctx = await businessContext(input.organizationId);
  const mustWrite = input.forceWrite || input.answers.length > 0;
  const user = JSON.stringify({ business: ctx, owner_brief: input.brief, owner_answers: input.answers, force_write: mustWrite });
  const r = await completeText(SYSTEM, user, { json: true, maxTokens: 6000, temperature: 0.4 });

  let parsed: { status?: string; questions?: unknown; text?: unknown };
  try { parsed = JSON.parse(r.text); } catch { throw new Error("The AI returned something unreadable. Please try again."); }

  if (parsed.status === "questions" && !mustWrite && Array.isArray(parsed.questions)) {
    const questions = parsed.questions.slice(0, 5).map((q: any, i) => ({ id: String(q?.id ?? `q${i + 1}`), question: String(q?.question ?? "").slice(0, 300), hint: q?.hint ? String(q.hint).slice(0, 160) : undefined })).filter((q) => q.question.length > 3);
    if (questions.length) return { status: "questions", questions };
  }
  const text = typeof parsed.text === "string" ? parsed.text.replace(/^```\w*\n?|```$/g, "").trim() : "";
  if (text.length < 200) throw new Error("The AI couldn't write the instructions this time. Add a bit more detail to your description and try again.");
  return { status: "ready", text: text.slice(0, MAX_INSTRUCTIONS) };
}

const DESCRIPTION_SYSTEM = `You write the short "About the business" description of ONE business. It is shown to customers and given to the business's AI assistant as background, so it must be accurate and plain.

Write 2 to 4 sentences, under 450 characters, in plain, warm, professional English (third person or "we", consistently). Cover only what the owner has told you or the context shows: what they sell or do, who for, where, and one real point of difference if given. No hype ("best", "number one", "unmatched"), no invented facts (years in business, awards, prices, delivery, certifications, locations), no emojis, no hashtags, no dashes used as punctuation.

You answer with a single JSON object, one of:
  {"status":"questions","questions":[{"id":"q1","question":"...","hint":"short example answer"}]}
  {"status":"ready","text":"<the description>"}

Ask the owner questions ONLY when you cannot tell what the business actually sells or does (for example the name is a brand like "GraceFragnace" and nothing else says what it is). Ask at most 3 short questions, in plain words, such as what they sell, who their customers are, where they operate, and what makes them different. Never ask what the context or brief already answers. If "force_write" is true or owner_answers exist, you MUST return status "ready" using only what is known (a shorter description is fine).`;

export async function writeDescription(input: { organizationId: string; brief: string; answers: QA[]; forceWrite: boolean; context: Record<string, string> }): Promise<WriterResult> {
  const org = await must<Organization>(from("Organization").select("*").eq("id", input.organizationId).single());
  const mustWrite = input.forceWrite || input.answers.length > 0;
  const known = {
    business_name: input.context.name || org.name, industry: org.industryTemplateKey ? getIndustry(org.industryTemplateKey).label : null, offers: org.businessType,
    city: input.context.city || org.city, address: input.context.address || org.address, website: input.context.website || org.website,
    country: org.country, current_description: input.context.current || org.description || null,
  };
  const r = await completeText(DESCRIPTION_SYSTEM, JSON.stringify({ business: known, owner_brief: input.brief, owner_answers: input.answers, force_write: mustWrite }), { json: true, maxTokens: 500, temperature: 0.5 });
  let parsed: { status?: string; questions?: unknown; text?: unknown };
  try { parsed = JSON.parse(r.text); } catch { throw new Error("The AI returned something unreadable. Please try again."); }
  if (parsed.status === "questions" && !mustWrite && Array.isArray(parsed.questions)) {
    const questions = parsed.questions.slice(0, 3).map((q: any, i) => ({ id: String(q?.id ?? `q${i + 1}`), question: String(q?.question ?? "").slice(0, 300), hint: q?.hint ? String(q.hint).slice(0, 160) : undefined })).filter((q) => q.question.length > 3);
    if (questions.length) return { status: "questions", questions };
  }
  const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (text.length < 30) throw new Error("The AI couldn't write a description this time. Tell it a little about what you sell and try again.");
  return { status: "ready", text: text.slice(0, 900) };
}

const FIELD_SYSTEM = `You help a business owner fill in ONE field of their setup form. The owner talks to you the way they would talk to ChatGPT: "give me 10 services a regular skincare brand offers", "add 3 more", "make the prices cheaper", "we open weekdays 8 to 5", or messy notes with real details. Do what they ask. They should never have to explain what format you need; you know the format.

TWO MODES
1. GENERATE: the owner asks you to come up with, suggest, create, list or add items (or just names a kind of business). Invent a realistic, useful set tailored to the business (its name, industry, city and anything already in the field). For prices and durations use realistic, typical Nigerian market values in Naira and sensible minutes or stock numbers. These are DRAFT starting points the owner will review. Honour the quantity they ask for. Do not ask questions in this mode; just produce a good draft.
2. FORMAT: the owner gives real details (names, prices, hours). Use exactly what they gave; do not change their numbers. If something the format needs is missing and cannot be reasonably drafted (for example a price they did not give for an item they described themselves), you may ask.

You answer with a single JSON object, one of:
  {"status":"ready","text":"<the field content>","note":"<one short sentence for the owner, or empty>"}
  {"status":"questions","questions":[{"id":"q1","question":"...","hint":"short example answer"}]}
The "note" is where you tell the owner what to double check, for example "These prices are typical estimates in Naira. Please edit them to match what you really charge." Always include such a note when you invented prices, hours or amounts. In FORMAT mode leave it empty.

FORMAT by field type (the app parses these exactly, so follow them strictly):
- "list" for products, services, menu items, rooms, classes: one item per line as "Name | price | extra". price is whole Naira as digits only (45k becomes 45000, ₦5,000 becomes 5000). extra is minutes for services/classes/rooms/treatments, or stock quantity for physical products (omit the last part if unknown). Example: "Knotless braids | 45000 | 240" or "Ankara dress | 18500 | 12". No bullets, no numbering, no headings, no currency signs.
- "list" for staff names (stylists, practitioners): one name per line, nothing else.
- "faq_list": a set of customer questions with answers, as blocks separated by one blank line, each block exactly two lines: "Q: <the question a customer would ask>" then "A: <the answer>". Answers are short and factual (1 to 3 sentences). Typical topics: delivery, payment, returns/refunds, opening hours, location, how to order or book, warranty or authenticity. In GENERATE mode draft sensible answers for this kind of business and say in the note that the owner must check every answer, because the AI assistant will quote these to customers. Use exact numbers only if the owner gave them; otherwise write the answer without specific amounts, days or fees (for example "Delivery is available. The team will confirm the fee for your area.").
- "entry": ONE knowledge entry the assistant will quote, as exactly two parts: a line "Title: <short question or topic>" then "Content: <the answer or facts, clear and factual, one fact or rule per line if several>". If the owner already gave a title (see related), repeat it unchanged. Draft only what the owner asked for; no invented specific prices, fees or days unless given.
- "hours": a comma separated line like "Mon-Fri 9:00-18:00, Sat 10:00-16:00". Three-letter day names, 24 hour or am/pm times, hyphens. Leave out closed days.
- "textarea" or "text": plain text that does what "purpose" says, within "max_chars" characters (default 1 to 3 sentences). Use the owner's own meaning. If "placeholders" are listed, use them exactly as written in braces where they fit (for example {name}) and use no others. If "related" is given, it describes the thing being written about; stay consistent with it. No hype, no invented facts.

HARD RULES
- Never overwrite real details the owner gave with your own guesses. Invented values are allowed only in GENERATE mode, and then the note must say so.
- Never invent business facts the owner did not ask you to draft: an address, phone number, awards, years in business.
- Ask questions rarely, at most 3, only in FORMAT mode when something essential is missing. If the prompt is vague (for example "services"), do not ask: draft something sensible for this business instead.
- If "force_write" is true or owner_answers exist, you MUST return status "ready".
- The owner's instruction in "owner_prompt" decides what to do with "current_content": "add 3 more" means keep everything and append; "make prices cheaper" means rewrite the numbers; with no such instruction, keep the existing content and add to it. Never output duplicates.`;

function cleanField(kind: string, key: string, text: string, maxChars = 1000): string | null {
  if (kind === "entry") {
    const m = text.replace(/^```\w*\n?|```$/g, "").trim().match(/^Title:\s*(.+?)\s*\n+Content:\s*([\s\S]+)$/i);
    return m ? `Title: ${m[1].trim()}\nContent: ${m[2].trim()}`.slice(0, maxChars + 200) : null;
  }
  if (kind === "faq_list") {
    const blocks = text.replace(/^```\w*\n?|```$/g, "").split(/\n\s*\n/).map((b) => b.trim()).map((b) => b.match(/^Q:\s*(.+?)\s*\n+A:\s*([\s\S]+)$/i)).filter((m): m is RegExpMatchArray => !!m).map((m) => `Q: ${m[1].trim()}\nA: ${m[2].trim().replace(/\n+/g, " ")}`);
    return blocks.length ? blocks.join("\n\n").slice(0, 12000) : null;
  }
  const lines = text.replace(/^```\w*\n?|```$/g, "").split("\n").map((l) => l.replace(/^[-*•\d.)\s]+(?=\S.*\|)/, "").trim()).filter(Boolean);
  if (kind === "hours") { const t = lines.join(", "); return parseHoursText(t) ? t : null; }
  if (kind === "list" && !["stylists", "practitioners"].includes(key)) {
    const ok = lines.filter((l) => { const [n, p] = l.split("|").map((x) => x.trim()); return n && p && Number.isFinite(Number(p.toLowerCase().replace(/[^0-9.]/g, ""))) && /\d/.test(p); });
    return ok.length ? ok.join("\n") : null;
  }
  return lines.length ? lines.join(kind === "list" || maxChars > 600 ? "\n" : " ").slice(0, maxChars) : null;
}

export async function writeField(input: { organizationId: string; brief: string; answers: QA[]; forceWrite: boolean; context: Record<string, string> }): Promise<WriterResult> {
  const c = input.context;
  const org = await must<Organization>(from("Organization").select("name, industryTemplateKey, businessType, city").eq("id", input.organizationId).single());
  const mustWrite = input.forceWrite || input.answers.length > 0;
  const user = JSON.stringify({
    field: { key: c.fieldKey, label: c.fieldLabel, type: c.fieldType, hint: c.fieldHint || null, purpose: c.purpose || null, max_chars: Number(c.maxChars) || 1000, placeholders: c.placeholders ? c.placeholders.split(",") : [], related: c.related || null },
    business: { name: org.name, industry: org.industryTemplateKey ? getIndustry(org.industryTemplateKey).label : null, offers: org.businessType, city: org.city },
    current_content: c.current || "", owner_prompt: input.brief, owner_answers: input.answers, force_write: mustWrite,
  });
  const r = await completeText(FIELD_SYSTEM, user, { json: true, maxTokens: 1800, temperature: 0.6 });
  let parsed: { status?: string; questions?: unknown; text?: unknown; note?: unknown };
  try { parsed = JSON.parse(r.text); } catch { throw new Error("The AI returned something unreadable. Please try again."); }
  if (parsed.status === "questions" && !mustWrite && Array.isArray(parsed.questions)) {
    const questions = parsed.questions.slice(0, 3).map((q: any, i) => ({ id: String(q?.id ?? `q${i + 1}`), question: String(q?.question ?? "").slice(0, 300), hint: q?.hint ? String(q.hint).slice(0, 160) : undefined })).filter((q) => q.question.length > 3);
    if (questions.length) return { status: "questions", questions };
  }
  const text = typeof parsed.text === "string" ? cleanField(c.fieldType, c.fieldKey, parsed.text, Number(c.maxChars) || 1000) : null;
  if (!text) throw new Error("I couldn't build that from what you wrote. Add the missing details (like prices) and try again.");
  const note = typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim().slice(0, 240) : undefined;
  return { status: "ready", text, note };
}
