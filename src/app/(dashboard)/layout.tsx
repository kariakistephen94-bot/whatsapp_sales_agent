import { redirect } from "next/navigation";
import { getTenantContext, HttpError } from "@/modules/tenancy/context";
import { visibleNav } from "@/modules/tenancy/nav";
import { from, must, run } from "@/server/db";
import { DashboardShell } from "@/components/dashboard-shell";
import { BrandProvider } from "@/components/brand/brand-context";
import { getIndustry } from "@/modules/industries/templates";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try { ctx = await getTenantContext(); }
  catch (e) { if (e instanceof HttpError && e.status === 401) redirect("/login"); throw e; }

  const org = await must<{ name: string; onboardingCompletedAt: string | null; industryTemplateKey: string | null; businessType: string | null; description: string | null }>(
    from("Organization").select("name, onboardingCompletedAt, industryTemplateKey, businessType, description").eq("id", ctx.organizationId).single(),
  );
  const workspaces = (await run<{ organizationId: string; role: string; organization: { name: string } }[]>(
    from("Membership").select("organizationId, role, organization:Organization!inner(name)").eq("userId", ctx.userId).order("createdAt", { ascending: true }).limit(50),
  )).map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role }));
  if (!org.onboardingCompletedAt) redirect("/onboarding");

  const nav = visibleNav(ctx.capabilities, ctx.role).map(({ href, label, icon }) => ({ href, label, icon }));
  const brand = { name: org.name, industryKey: org.industryTemplateKey, industryLabel: getIndustry(org.industryTemplateKey).label, businessType: org.businessType, description: org.description };
  return <BrandProvider brand={brand}><DashboardShell orgName={org.name} orgId={ctx.organizationId} workspaces={workspaces} email={ctx.email} nav={nav}>{children}</DashboardShell></BrandProvider>;
}
