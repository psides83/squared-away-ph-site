import { ActionPanel } from "@/components/action-panel";
import { AdjustmentReportingForm } from "@/components/adjustment-reporting-form";
import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import type { PackageRevenue } from "@/lib/package-reporting";
export function PackageRevenueReport({
  report,
}: {
  report: PackageRevenue | null;
}) {
  if (!report)
    return (
      <p role="alert" className="notice error">
        Package revenue could not load. Check the latest migration and refresh.
      </p>
    );
  const allocatedAdjustments = report.adjustments.filter((a) => a.allocation);
  const missingAdjustments = report.adjustments.filter((a) => !a.allocation);
  return (
    <div className="stack">
      <p className="muted">
        Internal revenue allocation for finalized generated training charges,
        using invoice issue dates in the selected period.
      </p>
      <HelpPanel title="How package revenue is allocated">
        <p>
          Each newly generated training line retains the agreement’s monthly
          split. Feed and board use that line’s prorated proportions; training
          receives the remainder, including any rounding pennies. Later
          agreement edits do not restate saved allocations. Deliberate
          invoice-level reporting reviews can override those allocations while
          preserving the original snapshot and review history. Drafts, void
          invoices, manual charges and separate feed or board charges are
          outside this report.
        </p>
        <p>
          These are gross invoiced amounts, not cash received or net profit.
          Discounts and credits are shown separately below using manually saved
          allocations. Refund payments are cash movements and do not reduce
          revenue a second time when paired with a charge adjustment. Use Feed
          cost vs charges for separately billed feed; this package report does
          not combine issue-date revenue with service-date costs.
        </p>
      </HelpPanel>
      <div className="stats-grid">
        {[
          ["Package feed", report.totals.feed_cents],
          ["Package board", report.totals.board_cents],
          ["Package training", report.totals.training_cents],
          ["Needs a saved split", report.totals.unallocated_cents],
        ].map(([label, value]) => (
          <div className="stat-card" key={String(label)}>
            <div className="stat-top">{label}</div>
            <strong>{money(Number(value))}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Manual invoice adjustments</h2>
        </div>
        <div className="record-form stack">
          <p className="muted">
            Adjustments belong to invoices issued in this selected period, even
            when recorded later. Category portions apply to the entire invoice,
            including separately billed services. This section is separate from
            gross package revenue above.
          </p>
          {missingAdjustments.length > 0 && (
            <p className="notice">
              {missingAdjustments.length} adjustment(s) still need allocation.
              The totals below are incomplete until all are reviewed.
            </p>
          )}
          <dl className="feed-comparison-metrics">
            {(
              [
                ["training", "Training"],
                ["feed", "Feed"],
                ["board", "Board"],
                ["other", "Other"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <dt>{label} adjustments</dt>
                <dd>
                  {money(
                    allocatedAdjustments.reduce(
                      (sum, a) =>
                        sum +
                        Math.sign(a.amount_cents) *
                          a.allocation![`${key}_cents`],
                      0,
                    ),
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {!report.adjustments.length && (
            <p className="muted">No adjustments on these invoices.</p>
          )}
          {report.adjustments.map((a) => (
            <div className="stack" key={a.id}>
              <Link
                className="text-link"
                href={`/admin/invoices/${a.invoice_id}`}
              >
                Invoice #{a.invoice_number}
              </Link>
              <p>
                {dateLabel(a.adjustment_date)} · {a.description} ·{" "}
                {money(a.amount_cents)}
              </p>
              {a.allocation ? (
                <p>
                  Training{" "}
                  {money(
                    Math.sign(a.amount_cents) * a.allocation.training_cents,
                  )}{" "}
                  · Feed{" "}
                  {money(Math.sign(a.amount_cents) * a.allocation.feed_cents)} ·
                  Board{" "}
                  {money(Math.sign(a.amount_cents) * a.allocation.board_cents)}{" "}
                  · Other{" "}
                  {money(Math.sign(a.amount_cents) * a.allocation.other_cents)}
                </p>
              ) : (
                <span className="tag">Needs manual allocation</span>
              )}
              <ActionPanel
                id={`adjustment-${a.id}`}
                label={
                  a.allocation
                    ? "Edit reporting allocation"
                    : "Allocate adjustment"
                }
              >
                <AdjustmentReportingForm adjustment={a} />
              </ActionPanel>
            </div>
          ))}
        </div>
      </section>
      {!report.lines.length ? (
        <p className="notice">
          No finalized generated training charges for these invoice dates.
        </p>
      ) : (
        report.lines.map((l) => (
          <section className="panel" key={l.id}>
            <div className="panel-heading">
              <h2>{l.horse_name ?? "Unassigned horse"}</h2>
              <Link
                className="button secondary"
                href={`/admin/invoices/${l.invoice_id}`}
              >
                Invoice #{l.invoice_number}
              </Link>
            </div>
            <div className="record-form stack">
              <p>
                {dateLabel(l.issue_date)} · Package charge{" "}
                {money(l.amount_cents)}
              </p>
              {l.feed_cents === null ? (
                <p className="notice">
                  No saved reporting split. Today’s agreement is not applied
                  automatically.{" "}
                  <Link
                    className="text-link"
                    href={`/admin/invoices/${l.invoice_id}#invoice-reporting`}
                  >
                    Review this charge in Invoice → Reporting
                  </Link>
                </p>
              ) : (
                <dl className="feed-comparison-metrics">
                  {[
                    ["Feed", l.feed_cents],
                    ["Board", l.board_cents],
                    ["Training", l.training_cents],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <dt>{label}</dt>
                      <dd>{money(Number(value))}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {l.has_adjustments && (
                <p className="notice">
                  This invoice has adjustments. The amounts above are before
                  those adjustments; review its manual allocation above.
                </p>
              )}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
