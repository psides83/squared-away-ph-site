import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
export type StayFeedReportData = {
  rows: {
    stay_id: string;
    horse_id: string;
    name: string;
    customer_name: string;
    arrival_date: string;
    departure_date: string | null;
    cost_cents: number;
    issued_cents: number;
    draft_cents: number;
    package_cents: number;
    adjustment_cents: number;
    feeding_lines: number;
    feeding_days: number;
    review_count: number;
    package_review: boolean;
  }[];
  count: number;
  totals: {
    cost_cents: number;
    issued_cents: number;
    draft_cents: number;
    package_cents: number;
    adjustment_cents: number;
  };
  unassigned_cost_cents: number;
  unassigned_revenue_cents: number;
  unassigned_draft_cents: number;
  review_count: number;
  review: {
    invoice_id: string;
    invoice_number: number | null;
    reason: string;
  }[];
};
export function StayFeedReport({
  report: r,
  from,
  to,
  page,
}: {
  report: StayFeedReportData | null;
  from: string;
  to: string;
  page: number;
}) {
  if (!r)
    return (
      <p className="notice error" role="alert">
        Stay feed margins could not load. Check the latest migration and
        refresh.
      </p>
    );
  const pageUrl = (n: number) =>
    `/admin/reports?${new URLSearchParams({ from, to, stay_feed_page: String(n) })}#feed-comparison-stays`;
  return (
    <div className="stack">
      <p className="muted">
        Recorded feeding costs and finalized feed revenue for each training
        visit, using the selected service dates. Draft charges are separate.
      </p>
      <HelpPanel title="How feed is assigned to a stay">
        <p>
          Feed, hay and supplement consumption belongs to the horse’s stay
          containing its feeding date, including arrival and departure. Feeding
          outside a stay remains unassigned. Stay dates cannot overlap. Changing
          an unbilled stay’s dates can change this assignment.
        </p>
        <p>
          Revenue follows its saved invoice service sources or reviewed manual
          stay assignment. A horse-only charge is never assigned to a stay just
          because its dates overlap. Monthly, actual-cost, package and reviewed
          manual feed charges use the same exact-cent allocations as the horse
          comparison. Adjustments follow those original service dates. Costs use
          current saved weighted inventory values; corrections restate earlier
          periods. Fractional cost cents are distributed across stay and
          unassigned portions so each horse’s selected-period total reconciles.
        </p>
        <p>
          These are recorded feed margins, not cash profit or proof that every
          feeding has been entered. Purchases and waste are excluded. Missing
          feeding or unresolved finalized charges withhold that stay’s
          difference and margin. Included feed without a supported package split
          also needs review. The current billing customer identifies the stay;
          invoice revenue retains its saved sources.
        </p>
      </HelpPanel>
      <div className="stats-grid">
        {[
          ["Stay feed costs", r.totals.cost_cents],
          ["Stay net feed revenue", r.totals.issued_cents],
          ["Stay draft feed", r.totals.draft_cents],
        ].map(([label, value]) => (
          <div className="stat-card" key={String(label)}>
            <div className="stat-top">{label}</div>
            <strong className="stat-value">{money(Number(value))}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Outside stay totals</h2>
        </div>
        <div className="record-form stack">
          <p>
            Recorded feeding without a stay:{" "}
            <strong>{money(r.unassigned_cost_cents)}</strong>. Supported
            finalized feed revenue without a stay:{" "}
            <strong>{money(r.unassigned_revenue_cents)}</strong>. Draft revenue
            without a stay: {money(r.unassigned_draft_cents)}.
          </p>
          <p className="muted">
            Stay totals above include all matching stays, across every page.
            Adding these outside amounts reconciles to supported feed activity;
            unresolved charges below are excluded.
          </p>
        </div>
      </section>
      {r.review_count > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Feed records needing review</h2>
            <span className="count-badge">{r.review_count}</span>
          </div>
          <div className="record-form stack">
            {r.review.map((x, i) => (
              <div key={`${x.invoice_id}-${i}`}>
                <Link
                  className="text-link"
                  href={`/admin/invoices/${x.invoice_id}#invoice-reporting`}
                >
                  {x.invoice_number
                    ? `Invoice #${x.invoice_number}`
                    : "Invoice"}
                </Link>
                <p className="muted">{x.reason}</p>
              </div>
            ))}
            {r.review_count > 25 && (
              <p className="muted">
                Showing the first 25 review items. Narrow the dates or review
                invoices for more.
              </p>
            )}
          </div>
        </section>
      )}
      {!r.rows.length && (
        <p className="notice">
          No stay-attributed feeding or feed charges for this page and date
          range.
        </p>
      )}
      {r.rows.map((s) => {
        const net = s.issued_cents;
        const blocked =
          s.review_count > 0 || s.package_review || s.feeding_lines === 0;
        return (
          <section className="panel" key={s.stay_id}>
            <div className="panel-heading">
              <div>
                <h2>{s.name}</h2>
                <p className="muted form-hint">
                  {s.customer_name} · {dateLabel(s.arrival_date)} –{" "}
                  {s.departure_date ? dateLabel(s.departure_date) : "Open stay"}
                </p>
              </div>
              <Link
                className="button secondary"
                href={`/admin/training/${s.stay_id}`}
              >
                Training stay
              </Link>
            </div>
            <div className="record-form stack">
              {blocked && (
                <p className="notice">
                  {s.package_review
                    ? "Included feed needs a supported package split for these dates."
                    : s.review_count > 0
                      ? "Review this stay’s feed charges before comparing its margin."
                      : "No feeding recorded for these selected dates. Record actual feeding before judging the margin."}
                </p>
              )}
              <dl className="feed-comparison-metrics">
                {[
                  ["Recorded feed cost", money(s.cost_cents)],
                  ["Net feed revenue", money(net)],
                  [
                    "Recorded difference",
                    blocked ? "Needs review" : money(net - s.cost_cents),
                  ],
                  [
                    "Feed margin",
                    !blocked && net > 0
                      ? `${(((net - s.cost_cents) * 100) / net).toFixed(1)}%`
                      : "—",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="row-actions">
                <span className="tag">
                  {s.feeding_lines} product lines · {s.feeding_days} feeding
                  dates
                </span>
                <span className="tag">
                  Package feed: {money(s.package_cents)}
                </span>
                <span className="tag">
                  Feed adjustments: {money(s.adjustment_cents)}
                </span>
                <span className="tag">Draft feed: {money(s.draft_cents)}</span>
              </div>
            </div>
          </section>
        );
      })}
      <div className="row-actions">
        {page > 1 && (
          <Link className="button secondary" href={pageUrl(page - 1)}>
            Previous
          </Link>
        )}
        {page * 25 < r.count && (
          <Link className="button secondary" href={pageUrl(page + 1)}>
            Next
          </Link>
        )}
        <span className="muted">
          {r.count} {r.count === 1 ? "stay" : "stays"} in the period or with
          recorded activity
        </span>
      </div>
    </div>
  );
}
