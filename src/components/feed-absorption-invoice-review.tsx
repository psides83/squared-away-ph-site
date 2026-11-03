import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { FeedAbsorptionInvoiceForm } from "@/components/feed-absorption-invoice-form";
import { money, dateLabel } from "@/lib/format";
import type { AbsorptionInvoiceReview } from "@/lib/feed-absorption-invoice-review";
export function FeedAbsorptionInvoiceReviewContent({
  review: r,
}: {
  review: AbsorptionInvoiceReview;
}) {
  if (!r.pending_count && !r.history.length) return null;
  return (
    <section className="panel" id="invoice-feed-absorption-reviews">
      <div className="panel-heading">
        <h2>Absorbed feed: manual billing review</h2>
        <span className="tag">
          {r.pending_count ? "Review required" : "Review recorded"}
        </span>
      </div>
      <div className="record-form stack">
        {!!r.pending_count && (
          <>
            <p className="notice">
              {r.pending_count} absorbed-feed decisions changed after these
              feedings were billed. Invoice amounts are unchanged. Review any
              needed corrections manually; related feed/profit margins remain
              under review until resolved.
            </p>
            <details>
              <summary>
                Review all pending decisions · {r.pending_count}
              </summary>
              <div className="stack feed-comparison-detail">
                {r.rows.map((x) => (
                  <div key={x.decision_id}>
                    <h3>
                      {x.captured_source.feeding?.horse ?? "Horse"} ·{" "}
                      {x.captured_source.feeding?.product ?? "Feed"}
                    </h3>
                    <p>
                      {x.captured_source.feeding?.date &&
                        dateLabel(x.captured_source.feeding.date)}{" "}
                      · Protected cost changed from {money(x.previous_cents)} to{" "}
                      {money(x.new_cents)}
                    </p>
                    <p className="muted">{x.captured_source.reason}</p>
                  </div>
                ))}
              </div>
            </details>
            {r.status !== "void" && (
              <div className="row-actions">
                <Link
                  className="button secondary"
                  href={`/admin/invoices/${r.invoice_id}#invoice-corrections`}
                >
                  Enter invoice corrections
                </Link>
                <ActionPanel
                  id={`absorption-invoice-review-${r.invoice_id}`}
                  label="Record manual billing review"
                >
                  <FeedAbsorptionInvoiceForm review={r} />
                </ActionPanel>
              </div>
            )}
          </>
        )}
        {!!r.history.length && (
          <details>
            <summary>Recorded review history</summary>
            <div className="stack feed-comparison-detail">
              {r.history.map((x) => (
                <div key={x.decision_id}>
                  <p>
                    Protected cost {money(x.previous_cents)} →{" "}
                    {money(x.new_cents)}
                  </p>
                  <p className="muted">{x.resolution}</p>
                </div>
              ))}
              {r.history.length === 10 && (
                <p className="muted">
                  Latest ten resolved decisions shown; older evidence is
                  retained.
                </p>
              )}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
export async function FeedAbsorptionInvoiceReview({
  invoice,
}: {
  invoice: string;
}) {
  const { db } = await requireAdmin();
  const r = await db.rpc("invoice_feed_absorption_reviews", {
    p_invoice: invoice,
  });
  if (r.error || !r.data)
    return (
      <p className="notice error">
        Absorbed-feed invoice review could not load. Check the latest migration.
      </p>
    );
  return (
    <FeedAbsorptionInvoiceReviewContent
      review={r.data as AbsorptionInvoiceReview}
    />
  );
}
