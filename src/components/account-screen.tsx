import Link from "next/link";
import { Brand } from "@/components/brand";
import { LockKeyhole } from "lucide-react";
export function AccountScreen({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="account-page">
      <section className="account-card">
        <Brand />
        <span className="icon-tile">
          <LockKeyhole size={22} />
        </span>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
        {children}
        <Link className="text-link" href="/login">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
