import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { PackageReviewForm } from "@/components/package-review-form";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import type { PackageReviewOptions } from "@/lib/package-review";
export function PackageReportingReviewsContent({
  invoice,
  page,
  data,
}: {
  invoice: string;
  page: number;
  data: PackageReviewOptions;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Training charge reporting splits</h2>
      </div>
      <div className="record-form stack">
        <HelpPanel title="Review an older package split">
          <p>
            Assign portions of a saved generated training charge to feed and
            board, with training receiving the remainder. This uses the actual
            invoice line amount and its saved training days, rather than today’s
            monthly agreement. It also supports reviewing an existing original
            split deliberately.
          </p>
          <p>
            A review restates internal package, feed and service margin reports.
            Original generated snapshots, customer invoices, payments, stock and
            future agreement terms stay unchanged. Clearing returns to the
            original split if one exists; otherwise the line needs review again.
            Lines without saved training days and manual training charges need a
            separate source-date workflow.
          </p>
        </HelpPanel>
        {!data.lines.length && (
          <p className="muted">No generated training lines on this page.</p>
        )}
        {data.lines.map((l) => (
          <div className="stack" key={l.id}>
            <h3>{l.description}</h3>
            <p>
              {l.horse_name ?? "Unassigned horse"} · {money(l.amount_cents)} ·{" "}
              {l.status === "draft"
                ? "Draft"
                : l.status === "issued"
                  ? "Finalized"
                  : "Void"}
            </p>
            {l.day_count > 0 && (
              <p className="muted">
                {l.day_count} saved training days between{" "}
                {dateLabel(l.first_day!)} and {dateLabel(l.last_day!)}.
              </p>
            )}
            {l.effective ? (
              <p>
                Feed {money(l.effective.feed_cents)} · Board{" "}
                {money(l.effective.board_cents)} · Training{" "}
                {money(l.effective.training_cents)}
              </p>
            ) : (
              <p className="notice">
                No usable reporting split. This charge remains unallocated until
                its sources and split are reviewed.
              </p>
            )}
            {l.status !== "void" &&
              l.day_count > 0 &&
              l.horse_id &&
              l.stay_id &&
              l.amount_cents >= 0 && (
                <ActionPanel
                  id={`package-review-${l.id}`}
                  label={
                    l.effective
                      ? "Review reporting split"
                      : "Assign reporting split"
                  }
                >
                  <PackageReviewForm line={l} />
                </ActionPanel>
              )}
            {l.status !== "void" && l.current && !l.current.cleared && (
              <ActionPanel
                id={`clear-package-review-${l.id}`}
                label="Clear reviewed split"
              >
                <PackageReviewForm line={l} clear />
              </ActionPanel>
            )}
            {!l.day_count && l.status !== "void" && (
              <p className="notice">
                Saved training days are missing. A split alone cannot establish
                service dates.
              </p>
            )}
            <details>
              <summary>Original split & review history</summary>
              <div className="stack">
                <p>
                  {l.original
                    ? `Original: feed ${money(l.original.feed_cents)} · board ${money(l.original.board_cents)} · training ${money(l.original.training_cents)}`
                    : "No original generated reporting split was saved."}
                </p>
                {l.history.map((r) => (
                  <div key={r.id}>
                    <p>
                      {r.cleared ? "Cleared review" : "Reviewed split"} · Feed{" "}
                      {money(r.feed_cents)} · Board {money(r.board_cents)} ·
                      Training {money(r.training_cents)}
                    </p>
                    <p className="muted">
                      {r.reason}
                      {r.retired_at ? " · Earlier version" : ""}
                    </p>
                  </div>
                ))}
                {!l.history.length && <p>No manual reviews yet.</p>}
                {l.history.length === 10 && (
                  <p className="muted">
                    Up to ten recent reviews are shown; all history is retained.
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
              href={`/admin/invoices/${invoice}?package_review_page=${page - 1}#invoice-reporting`}
            >
              Previous training charges
            </Link>
          )}
          {page * 25 < data.count && (
            <Link
              className="button secondary"
              href={`/admin/invoices/${invoice}?package_review_page=${page + 1}#invoice-reporting`}
            >
              Next training charges
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
export async function PackageReportingReviews({
  invoice,
  page,
}: {
  invoice: string;
  page: number;
}) {
  const { db } = await requireAdmin();
  const result = await db.rpc("package_review_options", {
    p_invoice: invoice,
    p_page: page,
  });
  if (result.error || !result.data)
    return (
      <p role="alert" className="notice error">
        Training charge reporting reviews could not load. Check the latest
        migration.
      </p>
    );
  return (
    <PackageReportingReviewsContent
      invoice={invoice}
      page={page}
      data={result.data as PackageReviewOptions}
    />
  );
}
