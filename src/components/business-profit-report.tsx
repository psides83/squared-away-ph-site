import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money } from "@/lib/format";
import type { BusinessProfitData } from "@/lib/business-profit";

export function BusinessProfitReport({
  report: r,
  from,
  to,
}: {
  report: BusinessProfitData | null;
  from: string;
  to: string;
}) {
  if (!r)
    return (
      <p className="notice error" role="alert">
        Business profit could not load. Check the latest database migration,
        then refresh.
      </p>
    );
  const t = r.totals;
  const inventoryLink = (kind: string) =>
    `/admin/reports/inventory-review?${new URLSearchParams({ kind, from, to })}`;
  const invoiceLink = (id: string) => `/admin/invoices/${id}#invoice-reporting`;
  return (
    <div className="stack">
      <p className="muted">
        Earned income and incurred costs for the selected service dates. These
        results cover recorded activity, including unpaid invoices and bills.
      </p>
      <div className="stats-grid business-profit-summary">
        {[
          ["EARNED INCOME", money(t.income_cents)],
          ["RECORDED COSTS", money(t.cost_cents)],
          ["INVENTORY GAIN / LOSS", money(t.inventory_adjustment_cents)],
          [
            "RECORDED PROFIT",
            t.profit_cents === null ? "Needs review" : money(t.profit_cents),
          ],
          [
            "PROFIT MARGIN",
            t.margin_percent === null ? "—" : `${t.margin_percent}%`,
          ],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <div className="stat-top">{label}</div>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <HelpPanel title="How business profit is calculated">
        <p>
          Profit = earned income − recorded costs + reviewed inventory gains or
          losses. Finalized training, board and feed income uses supported
          service dates. Reimbursements use their original expense dates. Manual
          other income and invoice adjustments require reviewed dates and
          allocations. Draft invoices are excluded.
        </p>
        <p>
          Feed consumption and waste use saved weighted inventory values. Board,
          training and other expense portions use reviewed covered dates,
          including unpaid bills. Inventory purchases, opening stock,
          supplier-credit applications and customer payments are not counted
          again here. Cash activity remains in the Cash flow tab.
        </p>
        <p>
          Waste is recognized on its recorded date. Stock corrections and
          standalone supplier credits need a financial review. Returns use a
          reviewed settlement date: received cash plus issued store credit, less
          returned stock value. Changed source amounts invalidate the review.
          Reversed or canceled sources are excluded; corrections can restate
          earlier reports.
        </p>
        <p>
          Unknown service dates and missing expense splits are checked across
          all recorded activity because their reporting period is not yet known.
          They may block a selected period even when an invoice or bill was
          entered outside it. This report cannot detect activity that has never
          been entered.
        </p>
      </HelpPanel>
      {t.needs_review && (
        <section className="panel">
          <div className="panel-heading">
            <h2>Finish reviews before using the profit total</h2>
          </div>
          <div className="record-form stack">
            <p>
              Supported amounts remain visible below. Final profit and margin
              are withheld until the outstanding reviews are resolved. Counts
              can overlap.
            </p>
            <dl className="feed-comparison-metrics">
              <div>
                <dt>Income lines without supported service dates</dt>
                <dd>{r.undated_income_count}</dd>
              </div>
              <div>
                <dt>Invoice adjustments needing allocation or dates</dt>
                <dd>{r.adjustment_review_count}</dd>
              </div>
              <div>
                <dt>Expenses needing current service splits</dt>
                <dd>
                  {r.cost_review_count} · {money(r.unreviewed_cost_cents)}
                </dd>
              </div>
            </dl>
            {(Object.entries(r.inventory_review_counts) as [string, number][])
              .filter(([, count]) => count > 0)
              .map(([kind, count]) => (
                <Link
                  className="button secondary"
                  key={kind}
                  href={inventoryLink(kind)}
                >
                  Review {count}{" "}
                  {kind === "return"
                    ? "supplier settlement(s)"
                    : kind === "credit"
                      ? "supplier credit(s)"
                      : "stock correction(s)"}
                </Link>
              ))}
            {r.services.review.needs_review && (
              <p className="notice">
                Service revenue or cost records also need review. Open the
                service results for their detailed checks.
              </p>
            )}
            {r.undated_income.length > 0 && (
              <details className="help-panel">
                <summary>Review undated income (up to 25)</summary>
                <div className="help-content stack">
                  {r.undated_income.map((x) => (
                    <Link
                      className="button secondary"
                      key={x.line_id}
                      href={invoiceLink(x.invoice_id)}
                    >
                      Invoice {x.invoice_number ?? "record"}: {x.description}
                    </Link>
                  ))}
                </div>
              </details>
            )}
            {r.adjustment_review.length > 0 && (
              <details className="help-panel">
                <summary>Review invoice adjustments (up to 25)</summary>
                <div className="help-content stack">
                  {r.adjustment_review.map((x) => (
                    <Link
                      className="button secondary"
                      key={x.adjustment_id}
                      href={`/admin/invoices/${x.invoice_id}#invoice-corrections`}
                    >
                      Invoice {x.invoice_number ?? "record"} allocation
                    </Link>
                  ))}
                </div>
              </details>
            )}
            <div className="form-actions">
              {r.cost_review.map((x) => (
                <Link
                  className="button secondary"
                  key={x.expense_id}
                  href={`/admin/expenses/${x.expense_id}#expense-service-costs`}
                >
                  Review {x.vendor || "expense"} · {money(x.eligible_cents)}
                </Link>
              ))}
              <Link
                className="button secondary"
                href="#reports-combined-services"
              >
                Service results
              </Link>
              <Link className="button secondary" href="#reports-other-income">
                Other income
              </Link>
            </div>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Income and costs</h2>
        </div>
        <div className="record-form stack">
          <dl className="feed-comparison-metrics">
            <div>
              <dt>Training, board and feed income</dt>
              <dd>{money(r.services.totals.net_cents)}</dd>
            </div>
            <div>
              <dt>Reimbursements and other income</dt>
              <dd>{money(r.other_income.totals.net_cents)}</dd>
            </div>
            {r.services.services.map((s) => (
              <div key={s.service}>
                <dt>
                  {s.service.charAt(0).toUpperCase() + s.service.slice(1)} costs
                </dt>
                <dd>{money(s.cost_cents)}</dd>
              </div>
            ))}
            <div>
              <dt>Reviewed other expenses</dt>
              <dd>{money(t.other_cost_cents)}</dd>
            </div>
            <div>
              <dt>Feed waste / spoilage · {t.waste_count} entries</dt>
              <dd>{money(t.waste_cost_cents)}</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Inventory financial reviews</h2>
        </div>
        <div className="record-form stack">
          <p>
            Review gains, losses and neutral corrections without changing stock
            or moving money. Return settlements include received cash and issued
            store credit together.
          </p>
          <div className="form-actions">
            {(
              [
                ["return", "Supplier settlements"],
                ["correction", "Stock corrections"],
                ["credit", "Standalone credits"],
              ] as const
            ).map(([kind, label]) => (
              <Link
                className="button secondary"
                key={kind}
                href={inventoryLink(kind)}
              >
                {label}
                {r.inventory_review_counts[kind]
                  ? ` · ${r.inventory_review_counts[kind]} pending`
                  : ""}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
