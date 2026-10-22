"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UsersRound,
  Fence,
  CalendarDays,
  ClipboardList,
  BookOpen,
  Settings,
  Receipt,
  Package,
  Wheat,
  CalendarCheck,
  FileText,
  ChartNoAxesCombined,
  Scale,
  Link2,
  UserRoundCheck,
  Send,
} from "lucide-react";
const links = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/horses", label: "Horses", icon: Fence },
  { href: "/admin/customers", label: "Customers", icon: UsersRound },
  { href: "/admin/training", label: "Training stays", icon: ClipboardList },
  { href: "/admin/calendar", label: "Billing calendar", icon: CalendarCheck },
  { href: "/admin/invoices", label: "Invoices", icon: FileText },
  { href: "/admin/reports", label: "Reports", icon: ChartNoAxesCombined },
  { href: "/admin/allocations", label: "Shared costs", icon: Scale },
  { href: "/admin/attribution", label: "Income & cost links", icon: Link2 },
  { href: "/admin/log", label: "Training log", icon: BookOpen },
  { href: "/admin/reminders", label: "Reminders", icon: CalendarDays },
  { href: "/admin/expenses", label: "Expenses", icon: Receipt },
  { href: "/admin/inventory", label: "Inventory", icon: Package },
  { href: "/admin/feeding", label: "Feeding", icon: Wheat },
  { href: "/admin/updates", label: "Customer updates", icon: Send },
  { href: "/admin/portal", label: "Portal access", icon: UserRoundCheck },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];
export function Navigation() {
  const path = usePathname();
  return (
    <nav className="navigation" aria-label="Main navigation">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            path === href || (href !== "/admin" && path.startsWith(`${href}/`))
              ? "page"
              : undefined
          }
          className={
            path === href || (href !== "/admin" && path.startsWith(`${href}/`))
              ? "nav-item active"
              : "nav-item"
          }
        >
          <Icon size={19} />
          <span>{label}</span>
          {path === href && <span className="nav-dot" />}
        </Link>
      ))}
    </nav>
  );
}
