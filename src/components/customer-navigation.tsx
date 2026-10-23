"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Fence, Images, ReceiptText } from "lucide-react";
const links = [
  { href: "/portal", label: "Overview", icon: LayoutDashboard },
  { href: "/portal/horses", label: "Your horses", icon: Fence },
  { href: "/portal/files", label: "Photos & docs", icon: Images },
  { href: "/portal/billing", label: "Billing", icon: ReceiptText },
];
export function CustomerNavigation() {
  const path = usePathname();
  return (
    <nav className="customer-navigation" aria-label="Customer navigation">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={
            path === href || (href !== "/portal" && path.startsWith(href + "/"))
              ? "page"
              : undefined
          }
        >
          <Icon size={18} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
