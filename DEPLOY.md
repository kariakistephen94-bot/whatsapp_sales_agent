# Going live

The app is two processes that share one Supabase project:

| Process | What it does | Needs |
|---|---|---|
| **web** | Dashboard, public storefront, API, payment webhook | Any host that runs Node |
| **worker** | Holds the WhatsApp connections, sends AI replies, reminders, customer follow-ups, expires subscriptions | A host that **stays running** (not serverless). Run exactly **one**. |

The simplest setup is one small VPS (1 vCPU / 2 GB is enough to start) running both with Docker Compose.

## 1. Supabase (once)
1. Run `supabase/001…007_*.sql` in the SQL Editor, in order (see `supabase/README.md`).
2. Authentication → URL Configuration: set **Site URL** to `https://YOUR-DOMAIN` and add `https://YOUR-DOMAIN/auth/callback` to Redirect URLs.
3. Authentication → Providers → Email: keep "Confirm email" on, and configure a real SMTP sender (Project Settings → Auth → SMTP). The built-in sender is rate-limited and only for testing.

## 2. Paystack (once)
1. Dashboard → Settings → API Keys: copy the **secret key** (`sk_live_…`; use `sk_test_…` first).
2. Settings → API Keys & Webhooks: set the **Webhook URL** to `https://YOUR-DOMAIN/api/webhooks/paystack`.
3. Test with a Paystack test card, then switch to the live key.

## 3. Server
```bash
git clone <your repo> && cd whatsapp-ai-sales-saas
cp .env.example .env        # fill in every value; set APP_URL=https://YOUR-DOMAIN and DOMAIN=YOUR-DOMAIN
docker compose up -d --build
```
Point your domain's DNS A record at the server first; Caddy gets the HTTPS certificate automatically.

Check: `https://YOUR-DOMAIN/api/health` → `{"ok":true,"db":true,"worker":true}`.

## 4. First admin
Register in the app once, then on the server:
```bash
docker compose exec web npm run make-admin -- you@example.com
```
Open `/admin`.

## Operating notes
- **Updates**: `git pull && docker compose up -d --build` (the worker restarts and re-attaches every WhatsApp session; sessions live encrypted in Supabase, not on the server's disk).
- **Logs**: `docker compose logs -f worker`.
- **Backups**: turn on Supabase's daily backups (Project Settings → Database → Backups). Back up `WHATSAPP_SESSION_ENCRYPTION_KEY`: without it, saved WhatsApp sessions can't be decrypted and every business must re-scan its QR code.
- **Scaling**: the web service can run several copies; the worker must stay at one.
- **Baileys is unofficial**: it links like WhatsApp Web. Tell customers to use a dedicated business number, keep message volume human-like (the customer-care automation already caps and staggers sends), and expect WhatsApp to occasionally ask for a re-scan.
- **Health monitoring**: point an uptime monitor at `/api/health` and alert when `ok` is false. `/admin/system` shows queue backlog and disconnected numbers.
