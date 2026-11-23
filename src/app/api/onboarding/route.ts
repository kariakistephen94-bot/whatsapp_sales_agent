import { z } from "zod";
import { count, from, must, run, type Organization, one } from "@/server/db";
import { withTenant, HttpError } from "@/modules/tenancy/context";
import { getIndustry } from "@/modules/industries/templates";
import { normalizeNgPhone } from "@/lib/locale";
import { parseHoursText, DEFAULT_HOURS } from "@/modules/appointments/hours";

const profile = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  country: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  website: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  address: z.string().max(300).optional(),
  timezone: z.string().max(60).default("Africa/Lagos"),
  currency: z.string().length(3).default("NGN"),
});

const category = z.object({ industry: z.string(), businessType: z.string().max(500).optional() });

const operations = z.object({ answers: z.record(z.union([z.string(), z.boolean()])) });

const knowledge = z.object({
  entries: z.array(z.object({
    type: z.enum(["faq", "policy", "pricelist", "url", "document"]),
    title: z.string().min(1).max(200),
    content: z.string().max(20000).optional(),
    url: z.string().url().optional(),
  })).max(50),
});

const agent = z.object({
  name: z.string().min(1).max(60),
  personality: z.string().max(60),
  tone: z.string().max(60),
  language: z.string().max(30),
  formality: z.string().max(30),
  responseLength: z.enum(["short", "medium", "long"]),
  greeting: z.string().max(500).optional(),
  salesStrategy: z.string().max(60).optional(),
  instructions: z.string().max(16000).optional(),
});

const storefront = z.object({
  name: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  published: z.boolean(),
});

const body = z.discriminatedUnion("step", [
  z.object({ step: z.literal(1), data: profile }),
  z.object({ step: z.literal(2), data: category }),
  z.object({ step: z.literal(3), data: operations }),
  z.object({ step: z.literal(4), data: knowledge }),
  z.object({ step: z.literal(5), data: agent }),
  z.object({ step: z.literal(6), data: z.object({}).passthrough() }), // WhatsApp: connected out-of-band
  z.object({ step: z.literal(7), data: storefront }),
  z.object({ step: z.literal(8), data: z.object({}).passthrough() }),
]);

/** "Name | price | minutes | stock" per line -> catalog rows. Price is in major units. */
function parseList(text: string) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).flatMap((line) => {
    const [name, price, extra, stock] = line.split("|").map((s) => s.trim());
    const raw = (price ?? "").toLowerCase();
    const p = Number(raw.replace(/[^0-9.]/g, "")) * (/\dk$/.test(raw.trim()) ? 1000 : 1); // accepts 5000, 5,000, ₦5,000, 5k
    if (!name || !Number.isFinite(p)) return [];
    return [{ name, priceCents: Math.round(p * 100), extra: Number(extra) || undefined, stock: stock !== undefined && stock !== "" ? Number(stock) : undefined }];
  });
}

export const GET = withTenant("ADMIN", async (ctx) => {
  const org = await must<Record<string, unknown>>(
    from("Organization")
      .select("*, agent:AiAgent(*), storefront:Storefront(*), whatsappConnections:WhatsappConnection(id, status, phoneNumber)")
      .eq("id", ctx.organizationId).single(),
  );
  const [items, sources] = await Promise.all([
    count(ctx.db.from("CatalogItem").select("*", { count: "exact", head: true })),
    count(ctx.db.from("KnowledgeSource").select("*", { count: "exact", head: true })),
  ]);
  return { org: { ...org, agent: one(org.agent), storefront: one(org.storefront) }, counts: { items, sources } };
});

export const POST = withTenant("ADMIN", async (ctx, req) => {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const i = parsed.error.issues.find((x) => x.path[0] === "data") ?? parsed.error.issues[0];
    const field = i?.path.filter((x) => x !== "data").join(" › ");
    throw new HttpError(400, field ? `Please check "${field}": ${i.message.toLowerCase()}.` : "Please check your answers and try again.");
  }
  const { step, data } = parsed.data;
  const orgId = ctx.organizationId;
  /** Update this org's row; throws if it doesn't exist (as Prisma's update did). */
  const updateOrg = (values: Record<string, unknown>) =>
    must(from("Organization").update(values).eq("id", orgId).select("id").single());
  const getOrg = () => must<Organization>(from("Organization").select("*").eq("id", orgId).single());

  switch (step) {
    case 1: {
      await updateOrg({ ...data, phone: data.phone ? normalizeNgPhone(data.phone) ?? data.phone : data.phone, email: data.email || null, socialLinks: data.website ? { website: data.website } : undefined });
      break;
    }
    case 2: {
      const t = getIndustry(data.industry);
      await updateOrg({ industry: t.label, industryTemplateKey: t.key, businessType: data.businessType, capabilities: t.capabilities });
      break;
    }
    case 3: {
      const org = await getOrg();
      const t = getIndustry(org.industryTemplateKey);
      const allowed = new Set(t.operationsFields.map((f) => f.key));
      const answers = Object.fromEntries(Object.entries(data.answers).filter(([k]) => allowed.has(k)));
      // Free-text hours ("Mon–Fri 9:00–18:00, Sat 10–16") become structured hours used for real availability.
      const hours = typeof answers.hours === "string" ? parseHoursText(answers.hours) : null;
      await updateOrg({ operations: answers, ...(hours ? { businessHours: hours } : {}) });

      // List-type answers become real catalog rows. Re-running the step adds new names and updates prices; it never deletes.
      const kindFor = (key: string, hasDuration: boolean) =>
        key === "menu" ? "MENU_ITEM"
        : ["services", "plans", "courses", "rooms"].includes(key) ? "SERVICE"
        : key === "catalog" && hasDuration && t.capabilities.includes("services") ? "SERVICE"
        : "PRODUCT";
      const rows = t.operationsFields.filter((f) => f.type === "list" && typeof answers[f.key] === "string" && !["stylists", "practitioners"].includes(f.key))
        .flatMap((f) => parseList(answers[f.key] as string).map((r) => ({ ...r, kind: kindFor(f.key, r.extra !== undefined) })));
      const existingItems = new Map((await run<{ id: string; name: string }[]>(ctx.db.from("CatalogItem").select("id, name"))).map((i) => [i.name.toLowerCase(), i.id]));
      for (const r of rows) {
        const data = {
          kind: r.kind, name: r.name, priceCents: r.priceCents, currency: org.currency,
          durationMins: r.kind === "SERVICE" ? r.extra ?? 60 : null,
          trackInventory: r.kind !== "SERVICE" && r.stock !== undefined, stock: r.kind !== "SERVICE" ? r.stock ?? null : null,
        };
        const id = existingItems.get(r.name.toLowerCase());
        if (id) await run(ctx.db.from("CatalogItem").update(data).eq("id", id));
        else await run(ctx.db.from("CatalogItem").insert(data));
      }

      // Staff lists become StaffMember rows (skipping names that already exist), working the business hours by default.
      const staffNames = t.operationsFields.filter((f) => ["stylists", "practitioners"].includes(f.key))
        .flatMap((f) => String(answers[f.key] ?? "").split("\n").map((n) => n.trim()).filter(Boolean));
      if (staffNames.length) {
        const existing = new Set((await run<{ name: string }[]>(ctx.db.from("StaffMember").select("name"))).map((x) => x.name));
        const fresh = [...new Set(staffNames)].filter((n) => !existing.has(n));
        if (fresh.length) await run(ctx.db.from("StaffMember").insert(fresh.map((name) => ({ name, workingHours: hours ?? DEFAULT_HOURS }))));
      }
      break;
    }
    case 4: {
      const have = new Map((await run<{ id: string; type: string; title: string }[]>(ctx.db.from("KnowledgeSource").select("id, type, title"))).map((k) => [`${k.type}|${k.title.trim().toLowerCase()}`, k.id]));
      for (const e of data.entries) {
        if (!e.content && !e.url) continue;
        const id = have.get(`${e.type}|${e.title.trim().toLowerCase()}`);
        const row = { type: e.type, title: e.title, content: e.content ?? null, url: e.url ?? null };
        if (id) await run(ctx.db.from("KnowledgeSource").update(row).eq("id", id)); // going Back and Continue again updates, never duplicates
        else await run(ctx.db.from("KnowledgeSource").insert(row));
      }
      break;
    }
    case 5: {
      await must(ctx.db.from("AiAgent").update(data).select("id").single());
      break;
    }
    case 7: {
      await must(ctx.db.from("Storefront").update(data).select("id").single());
      break;
    }
    case 8: {
      const org = await getOrg();
      if (!org.industryTemplateKey) throw new HttpError(400, "Choose a business category first");
      const { toolsForCapabilities } = await import("@/modules/industries/templates");
      await must(ctx.db.from("AiAgent").update({ active: true, enabledTools: toolsForCapabilities(org.capabilities ?? []) }).select("id").single());
      await updateOrg({ onboardingCompletedAt: new Date().toISOString(), onboardingStep: 8 });
      await run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: "onboarding.completed" }));
      return { ok: true, done: true };
    }
  }
  await updateOrg({ onboardingStep: Math.max(step + 1, 1) });
  return { ok: true };
});
