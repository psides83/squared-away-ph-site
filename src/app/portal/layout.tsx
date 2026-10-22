import { InstallApp } from "@/components/install-app";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { Brand } from "@/components/brand";
import { signOut } from "@/app/auth-actions";
import { LogOut } from "lucide-react";
export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireCustomer();
  return (
    <div className="customer-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="customer-header">
        <Link href="/portal" aria-label="Customer portal home">
          <Brand />
        </Link>
        <nav aria-label="Customer navigation">
          <Link href="/portal">Overview</Link>
          <Link href="/portal/horses">Your horses</Link>
          <Link href="/portal/billing">Billing</Link>
        </nav>
        <form action={signOut}>
          <button className="text-button">
            <LogOut size={16} /> Sign out
          </button>
        </form>
      </header>
      <main id="main" className="customer-main">
        <InstallApp />
        {children}
      </main>
      <footer className="customer-footer">
        SQUARED AWAY PERFORMANCE HORSES · GRANBURY, TEXAS
        <small>Private customer access · {user.email}</small>
      </footer>
    </div>
  );
}
