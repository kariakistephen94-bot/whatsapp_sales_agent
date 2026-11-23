# Architecture

Multi-tenant AI WhatsApp sales & CRM platform. Next.js (App Router) + Supabase (supabase-js) (database, Auth, Storage, job queue) + OpenAI.

## Module layout

```
src/
  app/
    (marketing)/ (auth)/ onboarding/ (dashboard)/ admin/ store/[slug]/
    api/                      # route handlers; every handler resolves a TenantContext first
  modules/
    auth/                     # sessions, password hashing, RBAC guards
    tenancy/                  # TenantContext, tenant-scoped Supabase access, plan limits
    industries/               # industry templates -> capabilities, onboarding fields, AI tools, KPIs
    onboarding/               # step engine driven by industry templates
    ai/                       # agent engine, prompt builder, tool registry, guardrails
    whatsapp/                 # WhatsAppProvider interface + baileys adapter + cloud-api adapter
    conversations/ crm/ catalog/ orders/ appointments/ automations/
    storefront/ analytics/ billing/ admin/
  workers/                    # DB-backed job consumers: WhatsApp control, outbound, AI replies, reminders, follow-ups + hourly care sweep
  server/                     # logger, DB job queue, rate limit, audit, idempotency
```

## Key decisions

- **Tenant isolation**: all queries go through `tenant(orgId)` (src/server/db.ts, which filters every read/update/delete
  by `organizationId` and stamps it on every insert). Org is derived server-side from the session membership,
  never from a URL/body id.
- **WhatsApp**: `WhatsAppProvider` interface (`connect`, `sendText`, `onMessage`, `onStatus`, `disconnect`).
  Baileys is one adapter; Cloud API another. Baileys sockets run in the worker process, not Next.js;
  creds are encrypted at rest. QR/status pushed to the UI via SSE.
- **Inbound pipeline**: socket/webhook -> dedupe on `(organizationId, externalId)` -> queue ->
  worker upserts customer by phone -> if `conversation.handler = HUMAN` the AI is skipped -> else agent run.
- **AI engine**: system prompt = industry template + agent config + verified knowledge + customer memory.
  Tools are filtered by org capabilities. Tools perform real DB operations in transactions; the model
  can only report success from a tool result. Prices/stock/availability come only from tools.
- **Human takeover**: `Conversation.handler`; a send lock (compare-and-set on handler) prevents AI/human collisions.
- **Reminders**: scheduled delayed jobs in the `Job` table; `ReminderLog (appointmentId, kind)` unique => no duplicates.
  Times stored UTC, rendered in the org timezone (luxon).
- **Compliance**: opt-out keywords (STOP), `Customer.optedOut` checked before any outbound automation, frequency caps.
- **Attribution**: `Order.conversationId` + `createdByAi` mark AI-attributed sales; "after conversation" sales
  are reported separately.
- **Payments**: orders are never marked PAID without a payment record/gateway confirmation.

- **Customer relationships**: `app_refresh_relationships` (SQL, supabase/007) derives for each customer the visit count,
  usual gap, expected next visit and a state: lead, cold_lead, active, due (0.8–1.25× the usual gap), at_risk (<2.5×), lapsed.
  The worker's hourly care sweep queues one staggered job per customer who is due a nudge; the job re-checks everything
  (opt-out, replied since, converted, human handling, sending hours, subscription) before sending an AI-written
  (or template) message through the normal outbound choke point. The AI's system prompt includes the same history.
- **Billing**: Paystack hosted checkout → `BillingTransaction` (pending) → webhook (HMAC-SHA512 verified) and return page
  both re-verify with Paystack and call `app_activate_plan`, which locks the transaction row so activation is exactly-once.
  `serviceState()` gates the AI and all automated messages; the worker marks lapsed subscriptions expired.
- **Super-admin**: `/admin`, guarded by `User.isSuperAdmin` read from the database on each request.

## Build phases (all complete for v1)

1. Foundation: schema, auth, tenancy, design system, app shell *(schema done)*
2. Onboarding + industry templates
3. Catalog, CRM, orders, appointments
4. WhatsApp adapter + inbox + realtime
5. AI engine + tools + playground
6. Automations + reminders workers
7. Storefront
8. Analytics, dashboard customization, super-admin, billing

## Database: Supabase

- Supabase is the only data store, reached through supabase-js with the service role key (`src/server/db.ts`). No Prisma, no connection string.
- Row types live in `src/server/db-types.ts` (hand-maintained alongside the SQL files). Atomic operations are `app_*` Postgres functions called via `rpc`.
- Schema changes are plain SQL files in `supabase/` (001, 002, …), run by hand in the Supabase SQL Editor.
  Never edit an old file: every change is a new numbered file.
- Tenant isolation stays in the app layer (`tenant()`). Because the server uses the service role key (bypasses RLS),
  `supabase/002_security_rls.sql` turns on RLS with no policies so the public Data API (anon key) cannot touch any table.
- Uploads (logos, covers, documents) will use Supabase Storage via the server-side service role key.
- Long-lived Baileys sockets and the job worker need a persistent host (not serverless) alongside Supabase.
