import Link from "next/link";
import { Fence, FileText } from "lucide-react";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import { serviceLabels } from "@/lib/billing-days";
export type FeedComparison = {
  totals: {
    cost_cents: number;
    issued_cents: number;
    draft_cents: number;
    unbilled_actual_cents: number;
    package_cents: number;
    adjustment_cents: number;
  };
  horses: {
    horse_id: string;
    name: string;
    cost_cents: number;
    issued_cents: number;
    draft_cents: number;
    difference_cents: number;
    margin_percent: number | null;
    feeding_lines: number;
    feeding_days: number;
    unbilled_actual_cents: number;
    package_cents: number;
    adjustment_cents: number;
    included: boolean;
    has_unmatched: boolean;
    has_adjustments: boolean;
    agreements: {
      stay_id: string;
      customer_id: string;
      customer_name: string;
      from: string;
      to: string | null;
      mode: string;
      monthly_cents: number | null;
    }[];
    invoices: {
      invoice_id: string;
      status: string;
      invoice_number: number | null;
      customer_name: string;
      period_from: string | null;
      period_to: string | null;
      issue_date: string;
      cents: number;
      actual_cost: boolean;
      manual_period?: boolean;
      package_cents: number | null;
      adjustment_cents: number;
      has_adjustments: boolean;
    }[];
  }[];
  unmatched_count: number;
  unmatched_issued_cents: number;
  unassigned_cost_cents: number;
  unmatched: {
    line_id: string;
    invoice_id: string;
    invoice_number: number | null;
    status: string;
    description: string;
    amount_cents: number;
    reason: string;
  }[];
};
export function FeedComparisonReport({
  report,
}: {
  report: FeedComparison | null;
}) {
  if (!report)
    return (
      <p className="notice error" role="alert">
        Feed comparison could not load. Check the latest migration and refresh.
      </p>
    );
  return (
    <div className="stack">
      <p className="muted">
        Confirmed feed costs versus finalized feed charges for the selected
        service dates. Recorded feeding only; missing entries are not assumed to
        cost nothing.
      </p>
      <HelpPanel title="How feed costs and charges are compared">
        <p>
          Costs include feed, hay, and supplements actually recorded as fed,
          using their saved weighted inventory costs. Purchases and waste are
          excluded. Corrections restate the original feeding date here, so this
          comparison can differ from the ledger-date Feed usage report.
        </p>
        <p>
          Generated monthly charges follow their saved boarding days, weighted
          by each month’s calendar length. Actual-cost charges follow their
          claimed feeding records and saved costs. Saved invoice cents are
          distributed with stable penny rounding; a full line always reconciles
          to its original amount. Invoice issue/payment dates do not determine
          which service dates are compared.
        </p>
        <p>
          Drafts are shown separately and are not invoiced revenue. Saved
          package feed portions follow the invoice’s claimed training days,
          weighted by calendar-month length. Manually assigned feed adjustments
          follow the invoice’s supported gross feed revenue across all service
          dates, with exact cent rounding; they restate the original service
          period regardless of adjustment date. Zero-value source totals use
          equal dated shares. Reviewed manual feed lines use an equal share per
          covered calendar day. They are not actual-cost feeding claims.
          Payments are not feed revenue. Unallocated adjustments, manual lines
          without service dates and missing package splits require review. This
          report is not cash profit and does not change any invoice.
        </p>
      </HelpPanel>
      <div className="stats-grid">
        {[
          ["Recorded feed cost", report.totals.cost_cents],
          ["Net feed revenue", report.totals.issued_cents],
          ["Feed on drafts", report.totals.draft_cents],
          ["At-cost feed not on invoices", report.totals.unbilled_actual_cents],
        ].map(([label, value]) => (
          <div className="stat-card" key={String(label)}>
            <div className="stat-top">{label}</div>
            <strong className="stat-value">{money(Number(value))}</strong>
          </div>
        ))}
      </div>
      {report.unassigned_cost_cents !== 0 && (
        <p className="notice">
          {money(report.unassigned_cost_cents)} of recorded feeding has no horse
          assignment and is outside the horse totals.
        </p>
      )}
      {report.unmatched_count > 0 && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Feed charges needing review</h2>
            <span className="count-badge">{report.unmatched_count}</span>
          </div>
          <div className="record-form stack">
            <p>
              These feed lines lack dated service sources, so they are excluded
              from the comparison. Full finalized line amounts total{" "}
              {money(report.unmatched_issued_cents)}; these amounts have not
              been allocated to your selected dates.
            </p>
            {report.unmatched.map((l) => (
              <div key={l.line_id}>
                <Link
                  className="text-link"
                  href={`/admin/invoices/${l.invoice_id}#invoice-reporting`}
                >
                  <FileText size={16} />
                  {l.invoice_number
                    ? `Invoice #${l.invoice_number}`
                    : "Draft invoice"}
                </Link>
                <p>
                  {l.description} · {money(l.amount_cents)} ·{" "}
                  {l.status === "draft" ? "Draft" : "Finalized"}
                </p>
                <small className="muted">{l.reason}</small>
              </div>
            ))}
            {report.unmatched_count > 25 && (
              <p className="muted">
                Showing the first 25 lines. Narrow the dates or review the
                invoice list for more.
              </p>
            )}
          </div>
        </section>
      )}
      {!report.horses.length ? (
        <p className="notice">
          No feeding costs, generated feed charges, or training agreements for
          these dates.
        </p>
      ) : (
        report.horses.map((h) => {
          const blocked = h.included
            ? "Package split needs review"
            : h.has_adjustments
              ? "Review invoice adjustments"
              : h.has_unmatched
                ? "Review unmatched feed charges"
                : !h.feeding_lines
                  ? "No feeding recorded"
                  : null;
          const margin =
            !blocked && h.issued_cents > 0 && h.margin_percent !== null
              ? `${Number(h.margin_percent).toFixed(1)}%`
              : "—";
          return (
            <section className="panel" key={h.horse_id}>
              <div className="panel-heading">
                <div>
                  <h2>{h.name}</h2>
                  <p className="muted form-hint">
                    {h.feeding_lines} product lines across {h.feeding_days}{" "}
                    recorded feeding dates
                  </p>
                </div>
                <Link
                  className="button secondary"
                  href={`/admin/horses/${h.horse_id}`}
                >
                  <Fence size={17} />
                  Horse record
                </Link>
              </div>
              <div className="record-form stack">
                {h.unbilled_actual_cents > 0 &&
                  h.invoices.some((i) => i.manual_period) && (
                    <p className="notice">
                      Manual feed charges do not reserve individual feeding
                      entries. Review these charges before also billing the
                      unclaimed actual feed costs.
                    </p>
                  )}
                {blocked && (
                  <p className="notice">
                    {blocked}.{" "}
                    {h.included
                      ? "Some package charges lack a saved internal feed split."
                      : h.has_adjustments
                        ? "Some invoice adjustments lack a manual allocation or supported feed source dates."
                        : h.has_unmatched
                          ? "Some finalized feed charges lack dated service sources and are excluded."
                          : "Record actual feeding before judging the margin."}
                  </p>
                )}
                <dl className="feed-comparison-metrics">
                  {[
                    ["Recorded feed cost", money(h.cost_cents)],
                    ["Net feed revenue", money(h.issued_cents)],
                    [
                      "Recorded difference",
                      blocked ? "Not comparable" : money(h.difference_cents),
                    ],
                    ["Feed margin", margin],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="row-actions">
                  <span className="tag">
                    Package feed: {money(h.package_cents)}
                  </span>
                  <span className="tag">
                    Feed adjustments: {money(h.adjustment_cents)}
                  </span>
                  <span className="tag">
                    Draft feed: {money(h.draft_cents)}
                  </span>
                  {h.unbilled_actual_cents > 0 && (
                    <span className="tag">
                      At-cost feed not on invoices:{" "}
                      {money(h.unbilled_actual_cents)}
                    </span>
                  )}
                  {h.feeding_lines > 0 &&
                    h.issued_cents === 0 &&
                    !h.included && (
                      <span className="tag">No finalized feed charges</span>
                    )}
                </div>
                <details>
                  <summary>Agreements & invoice detail</summary>
                  <div className="stack feed-comparison-detail">
                    <h3>Agreements overlapping these dates</h3>
                    {!h.agreements.length && (
                      <p className="muted">
                        No training agreement for these dates.
                      </p>
                    )}
                    {h.agreements.map((a) => (
                      <div key={a.stay_id}>
                        <Link
                          className="text-link"
                          href={`/admin/training/${a.stay_id}`}
                        >
                          {a.customer_name} · Training stay
                        </Link>
                        <p>
                          {dateLabel(a.from)} –{" "}
                          {a.to ? dateLabel(a.to) : "Open-ended"} ·{" "}
                          {serviceLabels[a.mode] ?? a.mode}
                          {a.mode === "separate_monthly"
                            ? ` · ${money(a.monthly_cents ?? 0)}/month`
                            : ""}
                        </p>
                      </div>
                    ))}
                    <p className="muted">
                      Agreements show current recorded terms. Finalized invoice
                      amounts use their saved sources.
                    </p>
                    <h3>Charges allocated to these service dates</h3>
                    {!h.invoices.length && (
                      <p className="muted">
                        No generated feed charges for these dates.
                      </p>
                    )}
                    {h.invoices.map((i) => (
                      <div key={i.invoice_id}>
                        <Link
                          className="text-link"
                          href={`/admin/invoices/${i.invoice_id}`}
                        >
                          <FileText size={16} />
                          {i.invoice_number
                            ? `Invoice #${i.invoice_number}`
                            : "Draft invoice"}
                        </Link>
                        <p>
                          {i.customer_name} · {money(i.cents)} allocated ·{" "}
                          {i.status === "draft" ? "Draft" : "Finalized"} ·{" "}
                          {i.package_cents !== null
                            ? "Includes package feed"
                            : i.actual_cost
                              ? "Actual feed cost"
                              : i.manual_period
                                ? "Manual feed"
                                : "Monthly feed"}
                        </p>
                        {i.manual_period && (
                          <p className="muted">
                            Includes reviewed manual feed dates.
                          </p>
                        )}
                        {i.adjustment_cents !== 0 && (
                          <p className="muted">
                            Includes {money(i.adjustment_cents)} manually
                            allocated feed adjustments.
                          </p>
                        )}
                        {i.has_adjustments && (
                          <Link
                            className="text-link"
                            href={`/admin/invoices/${i.invoice_id}#invoice-corrections`}
                          >
                            Review adjustment allocations
                          </Link>
                        )}
                        {i.period_from && i.period_to && (
                          <small className="muted">
                            Invoice period: {dateLabel(i.period_from)} –{" "}
                            {dateLabel(i.period_to)}
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
