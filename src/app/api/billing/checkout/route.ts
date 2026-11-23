import { z } from "zod";
import { withTenant } from "@/modules/tenancy/context";
import { startCheckout } from "@/modules/billing/service";
import { paystackConfigured } from "@/modules/billing/paystack";
import { rateLimit } from "@/server/rate-limit";

export const POST = withTenant("OWNER", async (ctx, req) => {
  if (!paystackConfigured()) return Response.json({ error: "Online payments aren't set up yet. Contact support." }, { status: 503 });
  const { planKey } = z.object({ planKey: z.string().min(1).max(40) }).parse(await req.json());
  if (!(await rateLimit(`checkout:${ctx.organizationId}`, 10, 3600))) return Response.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  try {
    return await startCheckout({ organizationId: ctx.organizationId, email: ctx.email, planKey });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
});
