import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money } from "@/lib/format";
export type CombinedServiceReportData = {
  services: {
    service: string;
    gross_cents: number;
    adjustment_cents: number;
    draft_cents: number;
    cost_cents: number;
  }[];
  totals: {
    gross_cents: number;
    adjustment_cents: number;
    net_cents: number;
    draft_cents: number;
    cost_cents: number;
    difference_cents: number | null;
    margin_percent: number | null;
  };
  review: {
    needs_review: boolean;
    unallocated_cost_count: number;
    unsupported_revenue_count: number;
    unresolved_adjustment_count: number;
    invalid_assignment_count: number;
    feed_horse_review_count: number;
    unsupported_feed_count: number;
    feed_correction_count: number;
    feed_adjustment_count: number;
  };
  other_cost_cents: number;
  unallocated_cost_cents: number;
  unassigned_feed_cost_cents: number;
};
const labels: Record<string, string> = {
  feed: "Feed",
  board: "Board",
  training: "Training",
};
export function CombinedServiceReport({
  report: r,
}: {
  report: CombinedServiceReportData | null;
}) {
  if (!r)
    return (
      <p className="notice error" role="alert">
        Combined service results could not load. Check the latest migration and
        refresh.
      </p>
    );
  const blocked = r.review.needs_review;
  return (
    <div className="stack">
      <p className="muted">
        Feed, board and training together for the selected service dates. This
        shows recorded service margins, separate from payments and cash flow.
      </p>
      <HelpPanel title="What is included in these results?">
        <p>
          Finalized service revenue includes supported generated charges, saved
          or reviewed package portions and manually allocated invoice
          adjustments. Each package portion is counted once. Draft charges are
          separate. Payments, customer credits applied as payment and purchase
          cash dates do not determine service revenue.
        </p>
        <p>
          Feed costs use recorded consumption at saved weighted inventory
          values, including feed without a horse assignment. Board and training
          costs use reviewed service allocations and their covered dates,
          including portions not yet assigned to a horse or stay. Feed purchases
          are excluded from those expense costs to avoid counting both purchased
          stock and consumption. Waste and other costs are outside the
          three-service total.
        </p>
        <p>
          Reviewed other costs are shown separately and are not deducted from
          this service margin. Other revenue, reimbursements, taxes and missing
          entries are not a complete business-profit calculation. Costs can
          include unpaid bills. Corrections can restate prior dates. The
          combined difference and margin are withheld when related records need
          review; the component amounts remain visible for reconciliation.
          Review counts can overlap and are not a count of unique invoices.
        </p>
      </HelpPanel>
      {blocked && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Review before comparing margins</h2>
          </div>
          <div className="record-form stack">
            <p>
              Amounts below show supported records. The combined difference and
              margin need review.
            </p>
            <ul>
              {[
                [
                  "Costs without current service splits",
                  r.review.unallocated_cost_count,
                ],
                [
                  "Board/training revenue lines needing dates or splits",
                  r.review.unsupported_revenue_count,
                ],
                [
                  "Board/training adjustments needing allocation",
                  r.review.unresolved_adjustment_count,
                ],
                [
                  "Horse/stay cost assignments needing review",
                  r.review.invalid_assignment_count,
                ],
                [
                  "Horses with incomplete feed comparisons",
                  r.review.feed_horse_review_count,
                ],
                [
                  "Finalized feed lines needing service dates",
                  r.review.unsupported_feed_count,
                ],
                [
                  "Invoices with feed cost corrections",
                  r.review.feed_correction_count,
                ],
                [
                  "Feed adjustments needing supported allocations",
                  r.review.feed_adjustment_count,
                ],
              ]
                .filter(([, n]) => Number(n) > 0)
                .map(([label, n]) => (
                  <li key={String(label)}>
                    {label}: {n}
                  </li>
                ))}
            </ul>
            <div className="row-actions">
              <Link
                className="button secondary"
                href="#service-margins-business"
              >
                Review service records
              </Link>
              <Link className="button secondary" href="#feed-comparison-horses">
                Review feed records
              </Link>
            </div>
          </div>
        </section>
      )}
      <section
        className="panel record-form"
        aria-label="Combined service summary"
      >
        <dl className="feed-comparison-metrics">
          {[
            ["Net service revenue", money(r.totals.net_cents)],
            ["Recorded service costs", money(r.totals.cost_cents)],
            [
              "Recorded difference",
              r.totals.difference_cents === null
                ? "Needs review"
                : money(r.totals.difference_cents),
            ],
            [
              "Service margin",
              r.totals.margin_percent === null
                ? "—"
                : `${Number(r.totals.margin_percent).toFixed(1)}%`,
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Services at a glance</h2>
        </div>
        <div className="record-form stack">
          {r.services.map((s) => (
            <div className="stack" key={s.service}>
              <h3>{labels[s.service] ?? s.service}</h3>
              <dl className="feed-comparison-metrics">
                {[
                  ["Gross finalized revenue", money(s.gross_cents)],
                  ["Revenue adjustments", money(s.adjustment_cents)],
                  [
                    "Net service revenue",
                    money(s.gross_cents + s.adjustment_cents),
                  ],
                  ["Recorded costs", money(s.cost_cents)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted">On drafts: {money(s.draft_cents)}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Reconciliation & other costs</h2>
        </div>
        <div className="record-form stack">
          <p>
            Finalized gross service revenue {money(r.totals.gross_cents)} +
            signed revenue adjustments {money(r.totals.adjustment_cents)} = net
            service revenue {money(r.totals.net_cents)}. Recorded service costs
            total {money(r.totals.cost_cents)}.
          </p>
          <p>
            Draft service revenue:{" "}
            <strong>{money(r.totals.draft_cents)}</strong>, outside finalized
            results.
          </p>
          <p>
            Reviewed other costs: <strong>{money(r.other_cost_cents)}</strong>,
            outside the three-service costs above.
          </p>
          {r.unallocated_cost_cents > 0 && (
            <p className="notice">
              Unreviewed eligible costs:{" "}
              <strong>{money(r.unallocated_cost_cents)}</strong>. These have not
              been assigned to a service and are excluded from the supported
              totals.
            </p>
          )}
          {r.unassigned_feed_cost_cents !== 0 && (
            <p className="notice">
              Feed costs without a horse:{" "}
              <strong>{money(r.unassigned_feed_cost_cents)}</strong>. These are
              already included in recorded service costs above.
            </p>
          )}
          <p className="muted">
            Unassigned board/training portions remain included at business
            level. Horse and stay reports show those portions separately;
            assigning them does not add a second business cost.
          </p>
        </div>
      </section>
    </div>
  );
}
