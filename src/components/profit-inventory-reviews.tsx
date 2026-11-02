import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import { ProfitInventoryForm } from "@/components/profit-inventory-form";
import { money, dateLabel } from "@/lib/format";
import type { ProfitInventoryOptions } from "@/lib/business-profit";
export function ProfitInventoryReviews({
  data: r,
  from,
  to,
  page,
}: {
  data: ProfitInventoryOptions | null;
  from: string;
  to: string;
  page: number;
}) {
  if (!r)
    return (
      <p className="notice error" role="alert">
        Financial inventory reviews could not load. Check the latest migration.
      </p>
    );
  const url = (kind: string, n = 1) =>
    `/admin/reports/inventory-review?${new URLSearchParams({ kind, page: String(n), from, to })}`;
  return (
    <div className="stack">
      <nav className="row-actions" aria-label="Financial inventory categories">
        {[
          ["return", "Supplier returns"],
          ["correction", "Stock corrections"],
          ["credit", "Standalone credits"],
        ].map(([kind, label]) => (
          <Link
            className={`button ${kind === r.kind ? "primary" : "secondary"}`}
            aria-current={kind === r.kind ? "page" : undefined}
            href={url(kind)}
            key={kind}
          >
            {label}
          </Link>
        ))}
      </nav>
      <p className="muted">
        {r.pending_count} of {r.count} active records need review. This
        workspace shows all active records in this category, including dates
        outside the report period.
      </p>
      <HelpPanel title="How inventory reviews affect profit">
        <p>
          Waste is costed automatically on its recorded date. Other stock
          corrections require an explicit no-extra-effect or full saved-value
          gain/loss choice. Standalone supplier credits also need a receipt-date
          review. Return-linked credits belong to their return’s outcome and
          never count a second time when applied to a purchase.
        </p>
        <p>
          For returns, review actual received cash and issued credit against the
          saved stock value, then choose the actual final settlement date. A
          pending refund is not assumed to be zero. A final shortfall or zero
          refund can be reviewed explicitly with a reason. Changes to values,
          receipts or expected amounts invalidate the financial review; they do
          not silently alter its amount. Mistaken source reversals/cancellations
          remove its profit effect while retaining private evidence. Closing a
          financial outcome does not change operational follow-up expectations.
        </p>
      </HelpPanel>
      {!r.rows.length && (
        <p className="notice">No active records in this category.</p>
      )}
      {r.rows.map((s) => (
        <section className="panel" key={s.source_id}>
          <div className="panel-heading">
            <div>
              <h2>{s.label}</h2>
              <p className="muted form-hint">
                {dateLabel(s.source_date)} ·{" "}
                {s.source_kind === "return"
                  ? "Supplier return"
                  : s.source_kind === "credit"
                    ? "Standalone supplier credit"
                    : s.detail_kind === "adjustment_out"
                      ? "Stock correction out"
                      : "Stock correction in"}
              </p>
            </div>
            <span className="tag">
              {s.valid ? "Financially reviewed" : "Needs review"}
            </span>
          </div>
          <div className="record-form stack">
            <dl className="feed-comparison-metrics">
              <div>
                <dt>
                  {s.source_kind === "credit"
                    ? "Credit value"
                    : "Saved stock value"}
                </dt>
                <dd>{money(s.stock_cents)}</dd>
              </div>
              {s.source_kind === "return" && (
                <>
                  <div>
                    <dt>Actual cash + credit</dt>
                    <dd>{money(s.cash_cents + s.credit_cents)}</dd>
                  </div>
                  <div>
                    <dt>Expected cash</dt>
                    <dd>
                      {s.expected_cash_cents === null
                        ? "Not set"
                        : money(s.expected_cash_cents)}
                    </dd>
                  </div>
                  <div>
                    <dt>Expected credit</dt>
                    <dd>
                      {s.expected_credit_cents === null
                        ? "Not set"
                        : money(s.expected_credit_cents)}
                    </dd>
                  </div>
                </>
              )}
            </dl>
            {s.valid ? (
              <p>
                Reviewed effect {money(s.current!.profit_cents)} on{" "}
                {dateLabel(s.current!.recognition_date)}.
              </p>
            ) : s.current && !s.current.cleared ? (
              <p className="notice">
                The saved review no longer matches the source. Review the
                current values before using the profit total.
              </p>
            ) : (
              <p className="muted">No current financial review.</p>
            )}
            <div className="row-actions">
              <ActionPanel
                id={`profit-review-${s.source_id}`}
                label={
                  s.valid ? "Edit financial review" : "Review financial effect"
                }
              >
                <ProfitInventoryForm source={s} />
              </ActionPanel>
              {s.current && !s.current.cleared && (
                <ActionPanel
                  id={`clear-profit-review-${s.source_id}`}
                  label="Clear review"
                >
                  <ProfitInventoryForm source={s} clear />
                </ActionPanel>
              )}
              <Link
                className="button secondary"
                href={
                  s.source_kind === "return"
                    ? `/admin/inventory/returns?return=${s.source_id}`
                    : s.source_kind === "credit"
                      ? "/admin/inventory?section=credits#inventory-credits"
                      : "/admin/inventory#inventory-history"
                }
              >
                Source records
              </Link>
            </div>
            <details>
              <summary>Financial review history</summary>
              <div className="stack feed-comparison-detail">
                {s.history.map((h) => (
                  <div key={h.id}>
                    <p>
                      {h.cleared ? "Cleared review" : "Reviewed outcome"} ·{" "}
                      {dateLabel(h.recognition_date)} · {money(h.profit_cents)}
                    </p>
                    <p className="muted">
                      {h.reason}
                      {h.retired_at ? " · Earlier version" : ""}
                    </p>
                  </div>
                ))}
                {!s.history.length && <p>No saved review history.</p>}
                {s.history.length === 10 && (
                  <p className="muted">
                    Showing the latest ten reviews; older evidence is retained.
                  </p>
                )}
              </div>
            </details>
          </div>
        </section>
      ))}
      <div className="row-actions">
        {page > 1 && (
          <Link className="button secondary" href={url(r.kind, page - 1)}>
            Previous
          </Link>
        )}
        {page * 25 < r.count && (
          <Link className="button secondary" href={url(r.kind, page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
