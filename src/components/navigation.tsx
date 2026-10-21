"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UsersRound,
  Fence,
  CalendarDays,
  ClipboardList,
} from "lucide-react";
const links = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/horses", label: "Horses", icon: Fence },
  { href: "/admin/customers", label: "Customers", icon: UsersRound },
  { href: "/admin/training", label: "Training stays", icon: ClipboardList },
  { href: "/admin/reminders", label: "Reminders", icon: CalendarDays },
];
export function Navigation() {
  const path = usePathname();
  return (
    <nav className="navigation" aria-label="Main navigation">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={path === href ? "page" : undefined}
          className={path === href ? "nav-item active" : "nav-item"}
        >
          <Icon size={19} />
          <span>{label}</span>
          {path === href && <span className="nav-dot" />}
        </Link>
      ))}
    </nav>
  );
}
