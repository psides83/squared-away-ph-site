"use client";
import { signOut } from "@/app/auth-actions";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Fence,
  Wheat,
  BookOpen,
  Menu,
  Package,
  Plus,
} from "lucide-react";
import { ActionPanel } from "@/components/action-panel";
import { navigationLinks } from "@/components/navigation";
export function MobileNavigation() {
  const path = usePathname();
  const tabs = [
    { href: "/admin", label: "Home", icon: LayoutDashboard },
    { href: "/admin/horses", label: "Horses", icon: Fence },
    { href: "/admin/feeding", label: "Feed", icon: Wheat },
    { href: "/admin/log", label: "Log", icon: BookOpen },
  ];
  return (
    <nav className="mobile-tabbar" aria-label="Mobile navigation">
      {tabs.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={path === href ? "page" : undefined}
        >
          <Icon size={21} />
          <span>{label}</span>
        </Link>
      ))}
      <ActionPanel id="mobile-menu" label="More" dismissLabel="Close menu">
        <div
          className="record-form"
          onClickCapture={(e) => {
            if ((e.target as HTMLElement).closest("a"))
              e.currentTarget.closest("dialog")?.close();
          }}
        >
          <div className="mobile-quick-actions">
            <Link
              href="/admin/inventory#stock-entry"
              className="button secondary"
            >
              <Package size={18} />
              Buy stock
            </Link>
            <Link
              href="/admin/log?new=1#record-form"
              className="button secondary"
            >
              <Plus size={18} />
              Log training
            </Link>
          </div>
          <nav className="mobile-menu-grid" aria-label="All barn office pages">
            {navigationLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
              >
                <Icon size={20} />
                {label}
              </Link>
            ))}
          </nav>
          <form action={signOut}>
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </ActionPanel>
      <span className="sr-only">
        <Menu />
        Open more pages
      </span>
    </nav>
  );
}
