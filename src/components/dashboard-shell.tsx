"use client";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/workspace-switcher";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/modules/auth/actions";

type Item = { href: string; label: string; icon: string };

function NavList({ nav, onNavigate }: { nav: Item[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((n) => {
        const Icon = (Icons as any)[n.icon] ?? Icons.Circle;
        const active = n.href === "/dashboard" ? pathname === n.href : pathname.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} onClick={onNavigate}
            className={cn("flex items-center gap-2.5 rounded-md px-2 py-2 text-sm md:py-1.5", active ? "bg-bg font-medium text-fg" : "text-muted hover:bg-bg hover:text-fg")}>
            <Icon size={16} strokeWidth={1.75} /> {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserFooter({ email }: { email: string }) {
  return (
    <div className="mt-auto border-t border-border px-2 pt-3">
      <div className="truncate text-xs text-muted" title={email}>{email}</div>
      <form action={signOutAction}>
        <button className="mt-2 flex items-center gap-2 text-sm text-muted hover:text-fg"><Icons.LogOut size={15} />Sign out</button>
      </form>
    </div>
  );
}

export function DashboardShell({ orgName, orgId, workspaces, email, nav, children }: { orgName: string; orgId: string; workspaces: WorkspaceOption[]; email: string; nav: Item[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <div className="min-h-screen md:flex">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface p-3 md:flex">
        <WorkspaceSwitcher current={orgId} workspaces={workspaces} />
        <NavList nav={nav} />
        <UserFooter email={email} />
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-surface px-3 md:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="-ml-1 rounded-md p-2 hover:bg-bg"><Icons.Menu size={20} /></button>
        <span className="truncate text-sm font-semibold tracking-tight">{orgName}</span>
      </header>

      {/* mobile drawer */}
      <div className={cn("fixed inset-0 z-40 md:hidden", open ? "visible" : "invisible")} aria-hidden={!open}>
        <div onClick={() => setOpen(false)} className={cn("absolute inset-0 bg-black/40 transition-opacity", open ? "opacity-100" : "opacity-0")} />
        <aside className={cn("absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col overflow-y-auto bg-surface p-3 shadow-xl transition-transform", open ? "translate-x-0" : "-translate-x-full")}>
          <div className="mb-2 flex items-center justify-between px-2 py-2">
            <div className="min-w-0 flex-1"><WorkspaceSwitcher current={orgId} workspaces={workspaces} /></div>
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-md p-1.5 hover:bg-bg"><Icons.X size={18} /></button>
          </div>
          <NavList nav={nav} onNavigate={() => setOpen(false)} />
          <UserFooter email={email} />
        </aside>
      </div>

      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
