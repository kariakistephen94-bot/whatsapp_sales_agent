-- 003 · Subscription plans (prices in kobo: 1_500_000 = ₦15,000)
-- New workspaces start on "trial". Safe to re-run: existing plans get updated names, prices and limits.

INSERT INTO "Plan" (id, key, name, "priceCents", currency, limits, features, active) VALUES
  (gen_random_uuid()::text, 'trial', 'Free trial', 0, 'NGN', '{"whatsappConnections": 1, "aiMessagesMonthly": 300, "conversationsMonthly": 100, "teamMembers": 2, "products": 50, "automations": 3, "customers": 200}'::jsonb, ARRAY[]::text[], true),
  (gen_random_uuid()::text, 'starter', 'Starter', 1500000, 'NGN', '{"whatsappConnections": 1, "aiMessagesMonthly": 2000, "conversationsMonthly": 500, "teamMembers": 3, "products": 200, "automations": 5, "customers": 1000}'::jsonb, ARRAY[]::text[], true),
  (gen_random_uuid()::text, 'professional', 'Professional', 4000000, 'NGN', '{"whatsappConnections": 2, "aiMessagesMonthly": 10000, "conversationsMonthly": 2500, "teamMembers": 10, "products": 1000, "automations": 15, "customers": 10000}'::jsonb, ARRAY[]::text[], true),
  (gen_random_uuid()::text, 'business', 'Business', 10000000, 'NGN', '{"whatsappConnections": 5, "aiMessagesMonthly": 50000, "conversationsMonthly": 10000, "teamMembers": 30, "products": 5000, "automations": 50, "customers": 50000}'::jsonb, ARRAY[]::text[], true),
  (gen_random_uuid()::text, 'enterprise', 'Enterprise', 0, 'NGN', '{"whatsappConnections": -1, "aiMessagesMonthly": -1, "conversationsMonthly": -1, "teamMembers": -1, "products": -1, "automations": -1, "customers": -1}'::jsonb, ARRAY[]::text[], true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, "priceCents" = EXCLUDED."priceCents", limits = EXCLUDED.limits;
