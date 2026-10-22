import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { money, dateLabel } from "@/lib/format";
import { PageHeading } from "@/components/ui";
export default async function CustomerHome() {
  const { db } = await requireCustomer();
  const [profile, horses, invoices, updates] = await Promise.all([
    db.rpc("portal_profile"),
    db.rpc("portal_horses"),
    db.rpc("portal_invoices", { p_page: 1 }),
    db.rpc("portal_updates", { p_page: 1 }),
  ]);
  if ([profile, horses, invoices, updates].some((r) => r.error))
    return (
      <p role="alert" className="notice error">
        Your portal couldn’t load. Please try again or contact Squared Away.
      </p>
    );
  return (
    <>
      <PageHeading
        eyebrow="YOUR HORSES. YOUR NEXT CHAPTER."
        title={`Welcome, ${profile.data?.name ?? "back"}.`}
        description="Follow the work, catch up on your horses, and keep billing in one place."
      />
      <div className="stats-grid">
        {[
          {
            label: "HORSES SHARED WITH YOU",
            value: horses.data?.length ?? 0,
            href: "/portal/horses",
          },
          {
            label: "OUTSTANDING",
            value: money(Number(invoices.data?.outstanding_cents ?? 0)),
            href: "/portal/billing",
          },
          {
            label: "OVERDUE",
            value: money(Number(invoices.data?.overdue_cents ?? 0)),
            href: "/portal/billing",
          },
        ].map((c) => (
          <Link className="stat-card" key={c.label} href={c.href}>
            <div className="stat-top">{c.label}</div>
            <strong>{c.value}</strong>
          </Link>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Latest from the barn</h2>
          <Link className="text-link" href="/portal/horses">
            All updates
          </Link>
        </div>
        {updates.data?.rows
          ?.slice(0, 5)
          .map(
            (u: {
              id: string;
              title: string;
              horse_name: string;
              update_date: string;
              body: string;
            }) => (
              <article className="log-entry" key={u.id}>
                <p className="eyebrow">
                  {u.horse_name} · {dateLabel(u.update_date)}
                </p>
                <h3>{u.title}</h3>
                <p className="preserve-lines">{u.body}</p>
              </article>
            ),
          )}
        {!updates.data?.rows?.length && (
          <p className="record-form muted">
            Your trainer’s published updates will appear here once horse access
            is shared with you.
          </p>
        )}
      </section>
      {profile.data?.contact &&
        (profile.data.contact.phone || profile.data.contact.email) && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Stay in touch</h2>
            </div>
            <div className="record-form row-actions">
              {profile.data.contact.phone && (
                <a
                  className="text-link"
                  href={`tel:${String(profile.data.contact.phone).replace(/[^\d+]/g, "")}`}
                >
                  {profile.data.contact.phone}
                </a>
              )}
              {profile.data.contact.email && (
                <a
                  className="text-link"
                  href={`mailto:${profile.data.contact.email}`}
                >
                  {profile.data.contact.email}
                </a>
              )}
            </div>
          </section>
        )}
    </>
  );
}
