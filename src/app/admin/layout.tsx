import Link from "next/link";
import { requireSuperAdmin } from "@/modules/admin/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform admin", robots: { index: false, follow: false } };

const LINKS = [["/admin", "Overview"], ["/admin/workspaces", "Workspaces"], ["/admin/payments", "Payments"], ["/admin/system", "System"]] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const a = await requireSuperAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-sm font-semibold tracking-tight">Platform admin</span>
          <nav className="flex flex-wrap gap-4 text-sm">{LINKS.map(([h, l]) => <Link key={h} href={h} className="text-muted hover:text-fg">{l}</Link>)}</nav>
          <span className="ml-auto flex items-center gap-4 text-xs text-muted">{a.email}<Link href="/dashboard" className="hover:text-fg">Back to app</Link></span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
