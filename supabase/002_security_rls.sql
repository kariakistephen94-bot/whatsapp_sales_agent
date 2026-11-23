-- 002 · Block Supabase's public Data API from touching app tables
-- The app reaches the database only from the server (Prisma, using DATABASE_URL), which bypasses RLS.
-- Turning RLS on with NO policies means the anon/authenticated keys in the browser can't read
-- or write any table, so one business's data can never leak to another through the public API.
-- Safe to re-run. Run it again after any file that adds new tables.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
