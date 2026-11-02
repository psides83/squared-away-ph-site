import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import { OtherIncomePeriodForm } from "@/components/other-income-period-form";
import { money, dateLabel } from "@/lib/format";
import type { OtherIncomeOptions } from "@/lib/other-income";
export function OtherIncomeReviewContent({
  invoice,
  page,
  data,
}: {
  invoice: string;
  page: number;
  data: OtherIncomeOptions;
}) {
  return (
    <section className="panel" id="other-income-periods">
      <div className="panel-heading">
        <h2>Other income service dates</h2>
      </div>
      <div className="record-form stack">
        <HelpPanel title="Which income needs these dates?">
          <p>
            Manual lines categorized as Other need explicit service coverage
            before entering date-based income reports. The issue date alone is
            not a service date. A one-day charge uses the same date in both
            fields. Signed amounts spread evenly over inclusive calendar days
            with earliest-date penny rounding.
          </p>
          <p>
            Generated expense reimbursements use the original protected expense
            date, including their handling fee, and do not need this editor.
            Payments remain in cash reports on received dates. This review
            changes reporting only; invoice totals and customer balances stay
            unchanged. A horse/stay assignment is optional and follows the
            invoice; these service dates are not boarding occupancy records.
          </p>
        </HelpPanel>
        {!data.lines.length && (
          <p className="muted">No manual Other lines on this page.</p>
        )}
        {data.lines.map((l) => (
          <div className="stack" key={l.id}>
            <h3>{l.description}</h3>
            <p>
              {money(l.amount_cents)} ·{" "}
              {l.horse_name ??
                "Customer/business income without a horse assignment"}{" "}
              ·{" "}
              {l.status === "draft"
                ? "Draft"
                : l.status === "issued"
                  ? "Finalized"
                  : "Void"}
            </p>
            {l.valid ? (
              <p>
                <span className="tag">Reviewed dates</span>{" "}
                {dateLabel(l.current!.covered_from)} –{" "}
                {dateLabel(l.current!.covered_to)}
              </p>
            ) : (
              <p className="notice">
                {l.status === "void"
                  ? "This invoice is void; its private review history remains available."
                  : l.current && !l.current.cleared
                    ? "The saved period no longer matches the source. Review its dates and assignment again."
                    : "This income needs reviewed service dates."}
              </p>
            )}
            {l.status !== "void" && l.source_token && (
              <ActionPanel
                id={`other-period-${l.id}`}
                label={
                  l.current && !l.current.cleared
                    ? "Edit income period"
                    : "Assign income period"
                }
              >
                <OtherIncomePeriodForm line={l} />
              </ActionPanel>
            )}
            {l.status !== "void" && l.current && !l.current.cleared && (
              <ActionPanel
                id={`clear-other-period-${l.id}`}
                label="Clear income period"
              >
                <OtherIncomePeriodForm line={l} clear />
              </ActionPanel>
            )}
            <details>
              <summary>Income period history</summary>
              <div className="stack">
                {l.history.map((x) => (
                  <div key={x.id}>
                    <p>
                      {x.cleared ? "Cleared" : "Reviewed"} ·{" "}
                      {dateLabel(x.covered_from)} – {dateLabel(x.covered_to)} ·{" "}
                      {money(x.amount_cents)}
                    </p>
                    <p className="muted">
                      {x.reason}
                      {x.retired_at ? " · Earlier version" : ""}
                    </p>
                  </div>
                ))}
                {!l.history.length && <p>No saved review history.</p>}
                {l.history.length === 10 && (
                  <p className="muted">
                    Showing the latest ten reviews; earlier history is retained.
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
              href={`/admin/invoices/${invoice}?other_income_page=${page - 1}#other-income-periods`}
            >
              Previous
            </Link>
          )}
          {page * 25 < data.count && (
            <Link
              className="button secondary"
              href={`/admin/invoices/${invoice}?other_income_page=${page + 1}#other-income-periods`}
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
export async function OtherIncomeReview({
  invoice,
  page,
}: {
  invoice: string;
  page: number;
}) {
  const { db } = await requireAdmin();
  const r = await db.rpc("other_income_options", {
    p_invoice: invoice,
    p_page: page,
  });
  if (r.error || !r.data)
    return (
      <p className="notice error" role="alert">
        Other-income periods could not load. Check the latest migration.
      </p>
    );
  return (
    <OtherIncomeReviewContent
      invoice={invoice}
      page={page}
      data={r.data as OtherIncomeOptions}
    />
  );
}
