import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import type { OtherIncomeReportData } from "@/lib/other-income";
export function OtherIncomeReport({
  report: r,
  from,
  to,
  page,
}: {
  report: OtherIncomeReportData | null;
  from: string;
  to: string;
  page: number;
}) {
  if (!r)
    return (
      <p className="notice error" role="alert">
        Other-income reporting could not load. Check the latest migration and
        refresh.
      </p>
    );
  const pageUrl = (n: number) =>
    `/admin/reports?${new URLSearchParams({ from, to, other_income_page: String(n) })}#reports-other-income`;
  return (
    <div className="stack">
      <p className="muted">
        Expense reimbursements and reviewed Other invoice lines for the selected
        service dates. This is revenue reporting, separate from cash received
        and business profit.
      </p>
      <HelpPanel title="How other income is dated">
        <p>
          Generated vet, farrier, hauling and other expense reimbursements use
          their original protected expense/service date. The full saved line,
          including any handling fee, counts once when the invoice is finalized.
          Draft lines are separate. Manual Other charges and credits require
          reviewed covered dates; the issue date is never assumed to be the
          service date.
        </p>
        <p>
          Signed manual amounts spread evenly across inclusive calendar days
          with earliest-date penny rounding. Manually allocated Other
          adjustments follow supported positive gross other-income dates, with
          equal dated shares if no positive gross amount exists. An undated
          Other line blocks adjustment dating for its invoice. Later adjustments
          restate original service dates.
        </p>
        <p>
          These totals do not deduct expenses or prove complete business profit.
          Payments, credit applications and cash refunds are not counted again
          as income. Missing/stale source records remain excluded and visible
          for review. Labels and invoice assignments are current; finalized
          customer names use saved invoice details. Costs and the existing
          service reports stay separate. Undated lines appear for review when
          their invoice period, prior reviewed period or supported invoice
          sources overlap your selected dates; unknown timing is never allocated
          automatically.
        </p>
      </HelpPanel>
      <section className="panel" aria-label="Other income totals">
        <div className="record-form stack">
          <dl className="feed-comparison-metrics">
            {[
              ["Finalized reimbursements", money(r.totals.reimbursement_cents)],
              ["Reviewed manual income", money(r.totals.manual_cents)],
              ["Other adjustments", money(r.totals.adjustment_cents)],
              ["Supported net other income", money(r.totals.net_cents)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            On drafts: {money(r.totals.draft_cents)} · totals include all
            matching pages.
          </p>
        </div>
      </section>
      {(r.unmatched_count > 0 || r.unresolved_adjustment_count > 0) && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Income records needing review</h2>
          </div>
          <div className="record-form stack">
            <p className="notice">
              {r.unmatched_count} lines need source dates (
              {r.unmatched_issued_count} finalized);{" "}
              {r.unresolved_adjustment_count} adjustments need supported
              allocations. Totals above include supported records only.
            </p>
            {r.unmatched.map((x) => (
              <div key={x.line_id}>
                <Link
                  className="text-link"
                  href={`/admin/invoices/${x.invoice_id}${x.source_kind === "manual" ? "#other-income-periods" : "#invoice-invoice"}`}
                >
                  {x.invoice_number
                    ? `Invoice #${x.invoice_number}`
                    : "Draft invoice"}
                </Link>
                <p>
                  {x.description} · {money(x.amount_cents)} ·{" "}
                  {x.status === "draft" ? "Draft" : "Finalized"}
                </p>
              </div>
            ))}
            {r.adjustment_review.map((x) => (
              <div key={x.adjustment_id}>
                <Link
                  className="text-link"
                  href={`/admin/invoices/${x.invoice_id}#invoice-corrections`}
                >
                  Review{" "}
                  {x.invoice_number
                    ? `invoice #${x.invoice_number}`
                    : "invoice"}{" "}
                  adjustments
                </Link>
              </div>
            ))}
            {(r.unmatched_count > 25 || r.unresolved_adjustment_count > 25) && (
              <p className="muted">
                Showing the first 25 items in each review list. Narrow the dates
                or review invoices for more.
              </p>
            )}
          </div>
        </section>
      )}
      {!r.rows.length && (
        <p className="notice">
          No supported other-income lines for this page and date range.
        </p>
      )}
      {r.rows.map((l) => (
        <section className="panel" key={l.line_id}>
          <div className="panel-heading">
            <div>
              <h2>{l.description}</h2>
              <p className="muted form-hint">
                {l.customer_name} ·{" "}
                {l.basis === "reimbursement"
                  ? "Expense reimbursement"
                  : "Reviewed manual income"}{" "}
                · {l.status === "draft" ? "Draft" : "Finalized"}
              </p>
            </div>
          </div>
          <div className="record-form stack">
            <dl className="feed-comparison-metrics">
              <div>
                <dt>For selected service dates</dt>
                <dd>{money(l.cents)}</dd>
              </div>
              <div>
                <dt>Full saved line</dt>
                <dd>{money(l.amount_cents)}</dd>
              </div>
            </dl>
            <p className="muted">
              Service coverage: {dateLabel(l.covered_from)} –{" "}
              {dateLabel(l.covered_to)}. Invoice issued{" "}
              {dateLabel(l.issue_date)}.
            </p>
            <div className="row-actions">
              <Link
                className="button secondary"
                href={`/admin/invoices/${l.invoice_id}${l.basis === "manual" ? "#other-income-periods" : ""}`}
              >
                {l.invoice_number
                  ? `Invoice #${l.invoice_number}`
                  : "Draft invoice"}
              </Link>
              {l.expense_id && (
                <Link
                  className="button secondary"
                  href={`/admin/expenses/${l.expense_id}`}
                >
                  Original expense
                </Link>
              )}
            </div>
          </div>
        </section>
      ))}
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
          {r.count} supported {r.count === 1 ? "line" : "lines"}
        </span>
      </div>
    </div>
  );
}
