import Link from "next/link";
export type OwnershipEvent = {
  id: string;
  event: "baseline" | "added" | "removed" | "relationship_changed";
  customer_name: string;
  previous_relationship: string | null;
  relationship: string | null;
  recorded_at: string;
  actor_id: string | null;
};
const labels = {
  baseline: "Linked when tracking began",
  added: "Customer linked",
  removed: "Customer unlinked",
  relationship_changed: "Relationship changed",
};
export function OwnershipHistory({
  horseId,
  current,
  events,
  count,
  page,
  error,
}: {
  horseId: string;
  current: { customer_id: string; name: string; relationship: string }[];
  events: OwnershipEvent[];
  count: number;
  page: number;
  error?: boolean;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Ownership history</h2>
        <Link
          className="text-button"
          href={`/admin/horses?edit=${horseId}#record-form`}
        >
          Edit links
        </Link>
      </div>
      <div className="record-form stack">
        <h3>Currently linked</h3>
        {error ? (
          <p className="notice error">
            Customer links or history could not load. Check the
            ownership-history migration and refresh.
          </p>
        ) : (
          <>
            {current.length ? (
              current.map((c) => (
                <p key={c.customer_id}>
                  <Link
                    className="text-link"
                    href={`/admin/customers/${c.customer_id}`}
                  >
                    {c.name}
                  </Link>{" "}
                  · {c.relationship}
                </p>
              ))
            ) : (
              <p className="muted">No customers currently linked.</p>
            )}
            <p className="muted">
              Billing responsibility and portal access are managed separately.
            </p>
            <h3>Recorded changes</h3>
            <details>
              <summary>How history works</summary>
              <p className="muted">
                Dates show when changes were recorded, rather than a legal sale
                date. Existing links start with a baseline when tracking begins;
                earlier ownership is unknown. Names are retained as recorded at
                the time. Each training stay keeps its original billing
                customer. Portal horse access must be granted or revoked
                manually.
              </p>
              <p className="muted">
                History prevents deleting this horse. Correct its customer links
                using Edit links; past changes remain visible.
              </p>
            </details>
            {events.length ? (
              events.map((e) => (
                <article key={e.id}>
                  <strong>
                    {labels[e.event]} · {e.customer_name}
                  </strong>
                  <p>
                    {e.event === "relationship_changed"
                      ? `${e.previous_relationship} → ${e.relationship}`
                      : (e.relationship ?? e.previous_relationship)}
                  </p>
                  <p className="muted">
                    <time dateTime={e.recorded_at}>
                      {new Intl.DateTimeFormat("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "America/Chicago",
                      }).format(new Date(e.recorded_at))}
                    </time>{" "}
                    (Central)
                    {e.event === "baseline"
                      ? " · Starting record"
                      : e.actor_id
                        ? " · Recorded by a signed-in account"
                        : " · Recorded through database administration"}
                  </p>
                </article>
              ))
            ) : (
              <p className="muted">No recorded changes on this page.</p>
            )}
            <div className="row-actions">
              {page > 1 && (
                <Link
                  className="text-button"
                  href={`/admin/horses/${horseId}?ownership_page=${page - 1}#horse-ownership`}
                >
                  Previous
                </Link>
              )}
              <span className="muted">
                Page {page} · {count} records
              </span>
              {page * 25 < count && (
                <Link
                  className="text-button"
                  href={`/admin/horses/${horseId}?ownership_page=${page + 1}#horse-ownership`}
                >
                  Next
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
