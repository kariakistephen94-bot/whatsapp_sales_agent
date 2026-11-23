"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { action, UserError } from "@/modules/tenancy/context";
import { run, maybe, type Automation } from "@/server/db";

export async function setAutomationEnabled(id: string, enabled: boolean) {
  return action("ADMIN", async (ctx) => {
    const r = await run<{ id: string }[]>(ctx.db.from("Automation").update({ enabled: z.boolean().parse(enabled) }).eq("id", z.string().min(1).parse(id)).select("id"));
    if (!r.length) throw new UserError("Automation not found");
    revalidatePath("/dashboard/automations");
    return true;
  });
}

const UpdateInput = z.object({
  template: z.string().max(1000),
  // Signed minutes relative to the trigger: negative = before (reminders), positive = after.
  offsetMinutes: z.number().int().min(-14 * 24 * 60).max(30 * 24 * 60).optional(),
});

export async function updateAutomation(id: string, input: z.input<typeof UpdateInput>) {
  return action("ADMIN", async (ctx) => {
    const d = UpdateInput.parse(input);
    const auto = await maybe<Automation>(ctx.db.from("Automation").select("*").eq("id", z.string().min(1).parse(id)).maybeSingle());
    if (!auto) throw new UserError("Automation not found");
    const config = { ...((auto.config as Record<string, unknown>) ?? {}) };

    if (auto.key !== "welcome") {
      if (!d.template.trim()) throw new UserError("The message can't be empty");
      config.template = d.template.trim();
    }
    if (typeof config.offsetMinutes === "number" && d.offsetMinutes !== undefined) {
      if (auto.trigger === "appointment_reminder" && d.offsetMinutes >= 0) throw new UserError("Reminders must be sent before the appointment");
      if (auto.trigger !== "appointment_reminder" && d.offsetMinutes <= 0) throw new UserError("The delay must be greater than zero");
      config.offsetMinutes = d.offsetMinutes;
    }
    await run(ctx.db.from("Automation").update({ config }).eq("id", auto.id));
    revalidatePath("/dashboard/automations");
    return true;
  });
}

const CareInput = z.object({
  template: z.string().trim().min(5).max(600),
  aiPersonalize: z.boolean(),
  defaultCycleDays: z.number().int().min(7).max(180),
  maxNudges: z.number().int().min(1).max(5),
  dailyCap: z.number().int().min(1).max(200),
  sendFromHour: z.number().int().min(0).max(23),
  sendToHour: z.number().int().min(1).max(24),
});

/** Settings for the "Keep in touch with customers" automation (stored in Automation.config). */
export async function updateCustomerCare(id: string, input: z.input<typeof CareInput>) {
  return action("ADMIN", async (ctx) => {
    const d = CareInput.parse(input);
    if (d.sendToHour <= d.sendFromHour) throw new UserError("The sending window must end after it starts");
    const auto = await maybe<Automation>(ctx.db.from("Automation").select("*").eq("id", z.string().min(1).parse(id)).eq("key", "customer_care").maybeSingle());
    if (!auto) throw new UserError("Automation not found");
    await run(ctx.db.from("Automation").update({ config: { ...((auto.config as Record<string, unknown>) ?? {}), ...d } }).eq("id", auto.id));
    revalidatePath("/dashboard/automations");
    return true;
  });
}
