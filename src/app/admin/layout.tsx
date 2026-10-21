import { requireAdmin } from "@/lib/auth";
import { Brand } from "@/components/brand";
import { Navigation } from "@/components/navigation";
import { signOut } from "@/app/auth-actions";
import { LogOut, MapPin } from "lucide-react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireAdmin();
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>
        <p className="nav-label">YOUR BARN OFFICE</p>
        <Navigation />
        <div className="sidebar-bottom">
          <div className="location">
            <MapPin size={15} />
            <span>Granbury, Texas</span>
          </div>
          <p>
            Built around the work.
            <br />
            Made for the horseman.
          </p>
          <span className="sidebar-rule" />
          <form action={signOut}>
            <button className="signout">
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            <span className="status-dot" /> PRIVATE WORKSPACE
          </span>
          <div className="account">
            <span>Business owner</span>
            <span className="avatar" title={user.email}>
              SA
            </span>
          </div>
        </header>
        <main id="main" className="main-content">
          {children}
        </main>
        <footer className="app-footer">
          <span>SQUARED AWAY PERFORMANCE HORSES</span>
          <span>Keep good records. Make good horses.</span>
        </footer>
      </div>
    </div>
  );
}
