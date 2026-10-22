import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { dateLabel } from "@/lib/format";
import { PageHeading } from "@/components/ui";
export default async function CustomerHorses({
  searchParams,
}: {
  searchParams: Promise<{ horse?: string; page?: string }>;
}) {
  const query = await searchParams;
  const { db } = await requireCustomer();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(query.page) || 1)),
  );
  const horse =
    query.horse && /^[0-9a-f-]{36}$/i.test(query.horse) ? query.horse : null;
  const [horses, updates] = await Promise.all([
    db.rpc("portal_horses"),
    db.rpc("portal_updates", { p_horse: horse, p_page: page }),
  ]);
  if (horses.error || updates.error)
    return (
      <p role="alert" className="notice error">
        Horse updates couldn’t load. Try again or contact your trainer.
      </p>
    );
  const href = (next: number) =>
    `/portal/horses?page=${next}${horse ? `&horse=${horse}` : ""}`;
  return (
    <>
      <PageHeading
        eyebrow="THE HORSE COMES FIRST"
        title="Your horses & updates"
        description="Published progress shared with you by Squared Away."
      />
      <div className="customer-horse-grid">
        {horses.data?.map(
          (h: {
            id: string;
            barn_name: string;
            registered_name: string | null;
            sex: string;
            breed: string | null;
            birth_year: number | null;
          }) => (
            <Link
              className="panel customer-horse-card"
              href={`/portal/horses?horse=${h.id}`}
              key={h.id}
            >
              <span className="horse-initial">{h.barn_name.slice(0, 1)}</span>
              <h2>{h.barn_name}</h2>
              {h.registered_name && <p>{h.registered_name}</p>}
              <p className="muted">
                {[h.birth_year, h.sex === "unknown" ? null : h.sex, h.breed]
                  .filter(Boolean)
                  .join(" · ") || "Horse profile"}
              </p>
              <span className="text-link">View published updates</span>
            </Link>
          ),
        )}
      </div>
      {!horses.data?.length && (
        <p className="notice">
          No horses have been shared with this account yet. Your trainer manages
          horse access separately from billing.
        </p>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>{horse ? "Horse updates" : "All shared updates"}</h2>
          {horse && (
            <Link className="text-link" href="/portal/horses">
              Show all horses
            </Link>
          )}
        </div>
        {updates.data?.rows?.map(
          (u: {
            id: string;
            horse_name: string;
            title: string;
            body: string;
            update_date: string;
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
            No published updates are available in this view yet.
          </p>
        )}
        <nav className="log-pagination" aria-label="Horse update pages">
          {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}
          <span>Page {page}</span>
          {page * 25 < Number(updates.data?.total ?? 0) ? (
            <Link href={href(page + 1)}>Next</Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}
