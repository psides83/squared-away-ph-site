import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import { MonthlyServicePeriodForm } from "@/components/monthly-service-period-form";
import { money, dateLabel } from "@/lib/format";
import type { MonthlyServiceOptions } from "@/lib/monthly-service-periods";
export function MonthlyServiceReportingContent({
  invoice,
  page,
  data,
}: {
  invoice: string;
  page: number;
  data: MonthlyServiceOptions;
}) {
  if (!data.count) return null;
  const url = (n: number) =>
    `/admin/invoices/${invoice}?monthly_service_page=${n}#monthly-service-reviews`;
  return (
    <section className="panel" id="monthly-service-reviews">
      <div className="panel-heading">
        <h2>Historical monthly feed & board dates</h2>
      </div>
      <div className="record-form stack">
        <HelpPanel title="When should I review these monthly charges?">
          <p>
            Use this when an older generated monthly feed or board charge has no
            saved service-day sources. Review its actual physical boarding
            dates. Current rates and training classifications do not replace
            historical dates.
          </p>
          <p>
            The full saved amount is distributed using calendar-month day
            weights, matching generated monthly reporting. No billing
            reservations, feed consumption claims or costs are created. If
            original sources return, they take precedence and this review
            becomes inactive. Changes to the source snapshot, amount, horse,
            stay or stay bounds require review again. Actual-cost charges and
            unrecognized source formats remain unsupported.
          </p>
        </HelpPanel>
        {!data.lines.length && (
          <p className="muted">
            No eligible historical monthly charges on this page.
          </p>
        )}
        {data.lines.map((l) => (
          <article className="stack separated" key={l.id}>
            <h3>{l.description}</h3>
            <p>
              {money(l.amount_cents)} ·{" "}
              {l.service === "feed" ? "Feed" : "Board"} ·{" "}
              {l.horse_name ?? "No horse assigned"} ·{" "}
              {l.status === "draft" ? "Draft" : "Finalized"}
            </p>
            {l.valid ? (
              <p>
                <span className="tag">Reviewed dates</span>{" "}
                {dateLabel(l.current!.covered_from)} –{" "}
                {dateLabel(l.current!.covered_to)}
              </p>
            ) : !l.missing_sources ? (
              <p className="notice">
                Original service sources are available. Reporting uses those
                sources; the earlier review can be cleared.
              </p>
            ) : (
              <p className="notice">
                Review physical boarding dates before using this charge in
                service-date reports.
              </p>
            )}
            <div className="row-actions">
              {l.missing_sources && l.horse_id && l.stay_id && (
                <ActionPanel
                  id={`monthly-${l.id}`}
                  label={
                    l.valid ? "Edit monthly dates" : "Review monthly dates"
                  }
                >
                  <MonthlyServicePeriodForm line={l} />
                </ActionPanel>
              )}
              {l.current && !l.current.cleared && (
                <ActionPanel id={`clear-monthly-${l.id}`} label="Clear review">
                  <MonthlyServicePeriodForm line={l} clear />
                </ActionPanel>
              )}
              {(!l.horse_id || !l.stay_id) && (
                <Link
                  className="button secondary"
                  href={`/admin/attribution?invoice=${invoice}`}
                >
                  Assign horse & stay
                </Link>
              )}
            </div>
            <details>
              <summary>Review history</summary>
              <div className="stack feed-comparison-detail">
                {l.history.map((h) => (
                  <div key={h.id}>
                    <p>
                      {h.cleared ? "Cleared" : "Reviewed"} ·{" "}
                      {dateLabel(h.covered_from)} – {dateLabel(h.covered_to)} ·{" "}
                      {money(h.amount_cents)}
                    </p>
                    <p className="muted">
                      {h.reason}
                      {h.retired_at ? " · Earlier version" : ""}
                    </p>
                  </div>
                ))}
                {!l.history.length && <p>No saved review history.</p>}
                {l.history.length === 10 && (
                  <p className="muted">
                    Latest ten versions shown; older evidence is retained.
                  </p>
                )}
              </div>
            </details>
          </article>
        ))}
        <div className="row-actions">
          {page > 1 && (
            <Link className="button secondary" href={url(page - 1)}>
              Previous
            </Link>
          )}
          {page * 25 < data.count && (
            <Link className="button secondary" href={url(page + 1)}>
              Next
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
export async function MonthlyServiceReporting({
  invoice,
  page,
}: {
  invoice: string;
  page: number;
}) {
  const { db } = await requireAdmin();
  const r = await db.rpc("monthly_service_reporting", {
    p_invoice: invoice,
    p_page: page,
  });
  if (r.error || !r.data)
    return (
      <p className="notice error">
        Monthly service dates could not load. Check the latest database
        migration.
      </p>
    );
  return (
    <MonthlyServiceReportingContent
      invoice={invoice}
      page={page}
      data={r.data as MonthlyServiceOptions}
    />
  );
}
