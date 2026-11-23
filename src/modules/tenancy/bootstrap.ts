import { rpc, type Organization } from "@/server/db";
import { slugify } from "@/lib/utils";
import { automationTemplates } from "@/modules/automations/templates";

/**
 * Creates a workspace (org + owner membership + agent + storefront + trial + automations) for a new user.
 * Runs on first sign-in, not at sign-up, so it works whether or not email confirmation is enabled.
 * All rows are written atomically by app_create_organization, which also picks a free slug (base, base-2, ...).
 */
export async function createOrganizationForUser(userId: string, businessName: string) {
  const base = slugify(businessName) || "business";
  return rpc<Organization>("app_create_organization", {
    p_user_id: userId,
    p_name: businessName,
    p_base_slug: base,
    p_automations: automationTemplates.map((t) => ({ key: t.key, name: t.name, trigger: t.trigger, config: t.config, enabled: t.enabledByDefault })),
  });
}
