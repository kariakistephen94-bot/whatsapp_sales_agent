"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, UserError } from "@/modules/tenancy/context";
import { run } from "@/server/db";
import { savePaymentKeys, removePaymentKeys } from "./service";

const keys = z.object({ publicKey: z.string().trim().min(10).max(200), secretKey: z.string().trim().min(10).max(200) });

const audit = (ctx: { db: any; userId: string }, act: string) =>
  run(ctx.db.from("AuditLog").insert({ actorId: ctx.userId, action: act, entity: "payments", entityId: "paystack" })).catch(() => {});

/** Owner connects their own Paystack account. Both keys are checked with Paystack before anything is saved. */
export async function connectPaystack(input: { publicKey: string; secretKey: string }) {
  return action("OWNER", async (ctx) => {
    const p = keys.safeParse(input);
    if (!p.success) throw new UserError("Paste both your Paystack public key and secret key.");
    const err = await savePaymentKeys(ctx.organizationId, p.data.publicKey, p.data.secretKey).catch(() => "Couldn't reach Paystack to check the keys. Try again in a moment.");
    if (err) throw new UserError(err);
    await audit(ctx, "settings.payments_connected");
    revalidatePath("/dashboard/settings");
    return { connected: true };
  });
}

export async function disconnectPaystack() {
  return action("OWNER", async (ctx) => {
    await removePaymentKeys(ctx.organizationId);
    await audit(ctx, "settings.payments_disconnected");
    revalidatePath("/dashboard/settings");
    return { connected: false };
  });
}
