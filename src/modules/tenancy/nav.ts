import type { Role } from "@/server/db";

export interface NavItem {
  href: string; label: string; icon: string;
  /** shown only if the org has at least one of these capabilities (omit = always) */
  requires?: string[];
  minRole?: Role;
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
  { href: "/dashboard/conversations", label: "Conversations", icon: "MessageSquare" },
  { href: "/dashboard/customers", label: "Customers", icon: "Users" },
  { href: "/dashboard/catalog", label: "Products & Services", icon: "Package", requires: ["products", "services", "menu"] },
  { href: "/dashboard/orders", label: "Orders", icon: "ShoppingBag", requires: ["orders"] },
  { href: "/dashboard/appointments", label: "Appointments", icon: "CalendarDays", requires: ["appointments", "reservations"] },
  { href: "/dashboard/storefront", label: "Storefront", icon: "Store" },
  { href: "/dashboard/agent", label: "AI Agent", icon: "Bot", minRole: "ADMIN" },
  { href: "/dashboard/automations", label: "Automations", icon: "Workflow", minRole: "ADMIN" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "BarChart3" },
  { href: "/dashboard/team", label: "Team", icon: "UserCog", minRole: "STAFF" },
  { href: "/dashboard/billing", label: "Billing", icon: "CreditCard", minRole: "ADMIN" },
  { href: "/dashboard/settings", label: "Settings", icon: "Settings", minRole: "ADMIN" },
];

const RANK: Record<Role, number> = { STAFF: 1, ADMIN: 2, OWNER: 3 };

export function visibleNav(caps: string[], role: Role) {
  return NAV.filter(
    (n) => (!n.requires || n.requires.some((c) => caps.includes(c))) && (!n.minRole || RANK[role] >= RANK[n.minRole]),
  );
}
