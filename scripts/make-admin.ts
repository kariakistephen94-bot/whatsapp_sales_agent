import "dotenv/config";
import { from, run } from "@/server/db";

/** Usage: npm run make-admin -- someone@example.com   (they must have signed in to the app at least once) */
(async () => {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) { console.error("Usage: npm run make-admin -- <email>"); process.exit(1); }
  const rows = await run<{ id: string }[]>(from("User").update({ isSuperAdmin: true }).eq("email", email).select("id"));
  if (!rows.length) { console.error(`No user with email ${email}. Sign in to the app once with that address first, then re-run.`); process.exit(1); }
  console.log(`${email} is now a platform admin. Open /admin.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
