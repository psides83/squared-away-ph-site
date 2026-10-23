import Link from "next/link";
import { careKinds } from "@/lib/horse-care";
import { dateLabel } from "@/lib/format";
export type CustomerCare = {
  id: string;
  horse_name: string;
  care_date: string;
  kind: keyof typeof careKinds;
  title: string;
  provider: string | null;
  notes: string;
};
export function CustomerCareRecords({
  rows,
  total,
  page,
  horse,
  error,
}: {
  rows: CustomerCare[];
  total: number;
  page: number;
  horse: string | null;
  error: boolean;
}) {
  const href = (p: number) =>
    `/portal/horses?care_page=${p}${horse ? `&horse=${horse}` : ""}#customer-horses-care`;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{horse ? "Horse care" : "All shared care"}</h2>
      </div>
      {error ? (
        <p className="notice error">
          Shared care records could not load. Try again or contact your trainer.
        </p>
      ) : (
        <>
          {rows.map((row) => (
            <article className="log-entry" key={row.id}>
              <p className="eyebrow">
                {row.horse_name} · {dateLabel(row.care_date)} ·{" "}
                {careKinds[row.kind]}
              </p>
              <h3>{row.title}</h3>
              {row.provider && (
                <p className="muted">Provider: {row.provider}</p>
              )}
              <p className="preserve-lines">{row.notes}</p>
            </article>
          ))}
          {!rows.length && (
            <p>No care records have been shared in this view yet.</p>
          )}
          <nav className="log-pagination" aria-label="Shared care pages">
            {page > 1 ? (
              <Link className="button secondary" href={href(page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>Page {page}</span>
            {page * 25 < total ? (
              <Link className="button secondary" href={href(page + 1)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </section>
  );
}
