import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/**
 * Creates (once) a confirmed Supabase Auth test user for local testing and saves the
 * credentials to test-account.local.json (git-ignored). Re-running reuses the saved account.
 */
const FILE = "test-account.local.json";
(async () => {
  if (existsSync(FILE)) { console.log("Test account already exists:", JSON.parse(readFileSync(FILE, "utf8")).email); return; }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const email = `owner.test+${randomBytes(3).toString("hex")}@example.com`;
  const password = `Test-${randomBytes(9).toString("base64url")}9!`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: "Test Owner", businessName: "Ada's Braids Lekki (TEST)" },
  });
  if (error) { console.error("Could not create test user:", error.message); process.exit(1); }
  writeFileSync(FILE, JSON.stringify({ email, password, userId: data.user.id, note: "Local test account. Delete in Supabase → Authentication → Users when done." }, null, 2));
  console.log("Created confirmed test user:", email, "(credentials saved to", FILE + ")");
})();
