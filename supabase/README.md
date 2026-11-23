# Supabase SQL

Run these in **Supabase → SQL Editor**, in number order. Each file runs once.

- Paste the whole file and click **Run**.
- When a new file appears (`004_…`, `005_…`), run only that one.
- Old files are never changed. Every database change is a new file.
- Keep a note of the last number you ran.

| File | What it does | Re-runnable |
|---|---|---|
| `001_schema.sql` | All tables, indexes and links (fresh project only) | No |
| `002_security_rls.sql` | Locks app tables away from the public Data API | Yes |
| `003_seed_plans.sql` | Subscription plans and their limits | Yes |
| `004_functions.sql` | Functions the app calls (bookings, orders, jobs, analytics…) | Yes |
| `005_list_column_defaults.sql` | List columns default to empty lists (fixes the Storefront page crash) | Yes |
| `006_team_whatsapp.sql` | Team WhatsApp numbers, hand-off alerts, WhatsApp invite links | Yes |
| `007_relationships_billing.sql` | Customer relationship tracking, Paystack payments, "Keep in touch" automation for existing workspaces | Yes |
