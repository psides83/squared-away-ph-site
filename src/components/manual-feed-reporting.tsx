import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { ManualFeedPeriodForm } from "@/components/manual-feed-period-form";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import type { ManualFeedOptions } from "@/lib/manual-feed-periods";
export function ManualFeedReportingContent({
  invoice,
  page,
  data,
}: {
  invoice: string;
  page: number;
  data: ManualFeedOptions;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Manual feed charge periods</h2>
      </div>
      <div className="record-form stack">
        <HelpPanel title="When should I assign a feed period?">
          <p>
            Use this for a nonnegative manual invoice line categorized as feed.
            Choose its actual covered dates; the invoice issue date alone does
            not establish them. Saved dates let the feed comparison distribute
            this charge across the selected service period.
          </p>
          <p>
            The invoice’s current horse assignment is used. A changed horse,
            stay or amount invalidates an earlier review until you save it
            again. Negative manual lines and historical package splits need
            separate workflows. These dates do not change customer invoices,
            payments, stock, actual-cost claims or the training agreement.
          </p>
        </HelpPanel>
        {!data.lines.length && (
          <p className="muted">
            No manual feed lines on this page. Generated feed charges already
            have their own saved sources.
          </p>
        )}
        {data.lines.map((line) => (
          <div className="stack" key={line.id}>
            <h3>{line.description}</h3>
            <p>
              {money(line.amount_cents)} ·{" "}
              {line.horse_name ?? "No horse assigned"} ·{" "}
              {line.status === "draft"
                ? "Draft"
                : line.status === "issued"
                  ? "Finalized"
                  : "Void"}
            </p>
            {line.valid ? (
              <p>
                <span className="tag">Reviewed dates</span>{" "}
                {dateLabel(line.current!.covered_from)} –{" "}
                {dateLabel(line.current!.covered_to)}
              </p>
            ) : (
              <p className="notice">
                {line.status === "void"
                  ? "This invoice is void. Its review history is retained and excluded from comparisons."
                  : line.has_saved_period
                    ? "The saved period no longer matches the invoice assignment, amount or stay dates. Review it again."
                    : "This charge needs reviewed service dates before it can enter the feed comparison."}
              </p>
            )}
            {!line.horse_id && (
              <Link
                className="button secondary"
                href={`/admin/attribution?invoice=${invoice}`}
              >
                Assign invoice to a horse
              </Link>
            )}
            {line.status !== "void" &&
              line.amount_cents >= 0 &&
              line.horse_id && (
                <ActionPanel
                  id={`feed-period-${line.id}`}
                  label={
                    line.has_saved_period
                      ? "Edit feed period"
                      : "Assign feed period"
                  }
                >
                  <ManualFeedPeriodForm line={line} />
                </ActionPanel>
              )}
            {line.status !== "void" && line.has_saved_period && (
              <ActionPanel
                id={`clear-feed-period-${line.id}`}
                label="Clear feed period"
              >
                <ManualFeedPeriodForm line={line} clear />
              </ActionPanel>
            )}
            {line.amount_cents < 0 && (
              <p className="muted">
                Negative manual feed lines remain excluded. Use reviewed invoice
                adjustment allocations for separate discounts or credits.
              </p>
            )}
            <details>
              <summary>Feed period review history</summary>
              <div className="stack">
                {line.history.map((h) => (
                  <div key={h.id}>
                    <p>
                      {h.cleared ? "Cleared period" : "Reviewed period"} ·{" "}
                      {dateLabel(h.covered_from)} – {dateLabel(h.covered_to)} ·{" "}
                      {money(h.amount_cents)}
                    </p>
                    <p className="muted">
                      {h.reason}
                      {h.retired_at ? " · Earlier version" : ""}
                    </p>
                  </div>
                ))}
                {!line.history.length && <p>No saved review history.</p>}
                {line.history.length === 10 && (
                  <p className="muted">
                    Showing the latest ten reviews. Earlier history is retained.
                  </p>
                )}
              </div>
            </details>
          </div>
        ))}
        <div className="row-actions">
          {page > 1 && (
            <Link
              className="button secondary"
              href={`/admin/invoices/${invoice}?manual_feed_page=${page - 1}#invoice-reporting`}
            >
              Previous
            </Link>
          )}
          {page * 25 < data.count && (
            <Link
              className="button secondary"
              href={`/admin/invoices/${invoice}?manual_feed_page=${page + 1}#invoice-reporting`}
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
export async function ManualFeedReporting({
  invoice,
  page,
}: {
  invoice: string;
  page: number;
}) {
  const { db } = await requireAdmin();
  const result = await db.rpc("manual_feed_reporting", {
    p_invoice: invoice,
    p_page: page,
  });
  if (result.error || !result.data)
    return (
      <p className="notice error" role="alert">
        Manual feed periods could not load. Check the latest reporting
        migration.
      </p>
    );
  return (
    <ManualFeedReportingContent
      invoice={invoice}
      page={page}
      data={result.data as ManualFeedOptions}
    />
  );
}
