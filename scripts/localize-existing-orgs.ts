import "dotenv/config";
import { from, run } from "@/server/db";

// One-off: orgs created before the Nigeria defaults still hold UTC/USD. Move only untouched defaults.
(async () => {
  const r = await run<{ id: string }[]>(
    from("Organization").update({ timezone: "Africa/Lagos", currency: "NGN", country: "Nigeria" })
      .eq("timezone", "UTC").eq("currency", "USD").select("id"),
  );
  console.log("updated orgs:", r.length);
  process.exit(0);
})();
