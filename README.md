# WhatsApp AI Sales

Multi-tenant AI WhatsApp sales agent + CRM for Nigerian businesses. Next.js 15, Supabase (database + Auth + Storage, via supabase-js), OpenAI, Baileys.

Supabase is the only backing service: no Redis, no Prisma, no database connection string. The server talks to Supabase over its API with the service role key. Background jobs, rate limits and the worker heartbeat are tables in Supabase.

## 1. Configure

Copy values into `.env` (never commit it):

| Key | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API (server only) |
| `OPENAI_API_KEY` | platform.openai.com |
| `WHATSAPP_SESSION_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `APP_URL` | the public address of the app (payment return links) |
| `PAYSTACK_SECRET_KEY` | paystack.com → Settings → API Keys (use `sk_test_…` while testing) |

Supabase dashboard → Authentication → URL Configuration:
- Site URL: `http://localhost:3000` (your domain in production)
- Redirect URLs: `http://localhost:3000/auth/callback`

## 2. Set up the database

Open Supabase → **SQL Editor**, and run each file in `supabase/` **in number order**, once each:

| File | What it does |
|---|---|
| `001_schema.sql` | Creates every table, index and link |
| `002_security_rls.sql` | Blocks the public Data API from reading app tables (re-run after any file that adds tables) |
| `003_seed_plans.sql` | Adds the subscription plans |
| `004_functions.sql` | All-or-nothing operations (bookings, orders, workspace setup, job queue, analytics), callable only with the service role key |
| `005_list_column_defaults.sql` | Empty lists instead of NULL (fixes a Storefront crash) |
| `006_team_whatsapp.sql` | Team WhatsApp numbers, hand-off alerts, WhatsApp invite links |
| `007_relationships_billing.sql` | Customer relationship tracking (due / at risk / lapsed), Paystack payments, "Keep in touch" automation |

Every later database change arrives as a new numbered file (`004_…sql`, `005_…sql`). Run only the new ones. Old files are never edited.

Then:

```bash
npm install
```

## 3. Run

```bash
npm run dev:all               # web app (:3000) + background worker
```

Checks: `npm run typecheck`, `npm run test:unit` (pure logic, no network), `npm run test:backend` (real database; creates and deletes throwaway workspaces).

Going live: see [DEPLOY.md](DEPLOY.md).

The worker owns WhatsApp sockets, AI replies, reminders and follow-ups. Without it, WhatsApp can't connect and nothing is sent.

## How things fit

- **Auth**: Supabase Auth (email + password, email confirmation, password reset, team invites). App-side `User` row mirrors the auth user; workspace is created on first sign-in.
- **Tenant isolation**: every query goes through `tenant(orgId)` in `src/server/db.ts`; the org comes from the verified session, never from the request. Supabase's public Data API is blocked by RLS (`supabase/002_security_rls.sql`).
- **AI agent**: `src/modules/ai` — prompt from business profile + verified knowledge + customer memory; tools hit real services (availability, booking, orders). Orders are always created UNPAID.
- **WhatsApp**: `src/modules/whatsapp` — provider interface, Baileys adapter (unofficial; use a secondary number), inbound pipeline with dedupe + STOP opt-out, single outbound choke point with the AI/human handler lock.

- **Keeping customers**: `src/modules/relationships`. The worker recomputes every customer's rhythm hourly (usual gap between orders/visits → *active, due, at risk, lapsed*). With the "Keep in touch with customers" automation on, the AI sends a short personalised check-in to customers who are due or drifting: max 3 per quiet spell, inside the owner's sending hours, daily cap, staggered, never to opted-out customers or anyone who replied recently, and the first one always explains STOP. The AI also sees this history when the customer replies.
- **Billing**: `src/modules/billing`. Plans are paid for 30 days at a time through Paystack checkout. The webhook and the return page both verify with Paystack and call one idempotent database function. Trial/plan expiry (+3 days grace) pauses the AI and automations. Owners manage it at `/dashboard/billing`.
- **Platform admin**: `/admin` (404 for everyone else). Grant yourself access with `npm run make-admin -- you@example.com` after signing in once. Shows revenue, workspaces, payments and system health; can suspend, comp a plan or extend a period.

Dev helpers: `npm run wa:smoke`, `npm run wa:inbound-test`.

Test login: `npx tsx --tsconfig tsconfig.json scripts/create-test-account.ts` creates a confirmed test user once and saves it to `test-account.local.json` (git-ignored).

## WhatsApp gateway (`gateway/`)

WhatsApp is connected through a small self-hosted gateway (Baileys 7) instead of inside the app, so the linked-device
session is managed by one stable, separately restartable service. The app sends through its HTTP API and receives
customer messages and delivery receipts on two webhooks (`/api/webhooks/gateway`, `/api/webhooks/gateway-status`).

```bash
npm run gateway:install   # once
npm run gateway           # keep this running (port 3100)
npm run worker            # the app's job worker
```

Settings live in `gateway/.env` (the gateway) and `.env` (`WHATSAPP_PROVIDER=gateway`, `GATEWAY_URL`, `GATEWAY_API_KEY`,
`GATEWAY_WEBHOOK_SECRET`, `GATEWAY_STATUS_SECRET`; the secrets must match the gateway's `WEBHOOK_SECRET` / `STATUS_WEBHOOK_SECRET`).
In production the webhook URLs must be HTTPS. One gateway serves many numbers: each WhatsApp connection in the app is its own
session (`/sessions/<connection id>/…`) with its own saved login under `gateway/sessions/<id>/`. Keep `gateway/sessions/` private.
