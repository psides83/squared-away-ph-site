import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { ManualServicePeriodForm } from "@/components/manual-service-period-form";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import type { ManualServiceOptions } from "@/lib/manual-service-periods";
export function ManualServiceReportingContent({
  invoice,
  page,
  data,
}: {
  invoice: string;
  page: number;
  data: ManualServiceOptions;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Manual training & board periods</h2>
      </div>
      <div className="record-form stack">
        <HelpPanel title="How are manual service periods used?">
          <p>
            Use this for a manual charge or credit categorized as training or
            board. Choose its actual covered dates; the invoice issue date alone
            does not establish them. Saved dates let service reports distribute
            this charge across the selected service period.
          </p>
          <p>
            The invoice’s current horse assignment is used. A changed horse,
            stay or amount invalidates an earlier review until you save it
            again. Training uses recorded worked and billable rest days and
            requires a stay. Board uses all covered calendar days. These dates
            do not change customer invoices, payments, stock, actual-cost claims
            or the training agreement.
          </p>
        </HelpPanel>
        {!data.lines.length && (
          <p className="muted">
            No manual training or board lines on this page. Generated and
            historical source reviews are separate.
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
                {line.service === "training" && line.current?.days
                  ? ` · ${line.current.days.filter((d) => d.status === "worked" || d.status === "rest").length} billable days`
                  : ""}
              </p>
            ) : (
              <p className="notice">
                {line.status === "void"
                  ? "This invoice is void. Its review history is retained and excluded from comparisons."
                  : line.has_saved_period
                    ? "The saved period no longer matches the invoice assignment, amount or stay dates. Review it again."
                    : "This charge or credit needs reviewed service dates before it can enter the service reports."}
              </p>
            )}
            {(!line.horse_id ||
              (line.service === "training" && !line.stay_id)) && (
              <Link
                className="button secondary"
                href={`/admin/attribution?invoice=${invoice}`}
              >
                Assign invoice to a horse / stay
              </Link>
            )}
            {line.service === "training" && line.stay_id && (
              <Link
                className="button secondary"
                href={`/admin/training/${line.stay_id}`}
              >
                Review stay & training days
              </Link>
            )}
            {line.status !== "void" &&
              line.horse_id &&
              (line.service === "board" || line.stay_id) && (
                <ActionPanel
                  id={`service-period-${line.id}`}
                  label={
                    line.has_saved_period
                      ? "Edit service period"
                      : "Assign service period"
                  }
                >
                  <ManualServicePeriodForm line={line} />
                </ActionPanel>
              )}
            {line.status !== "void" && line.has_saved_period && (
              <ActionPanel
                id={`clear-service-period-${line.id}`}
                label="Clear service period"
              >
                <ManualServicePeriodForm line={line} clear />
              </ActionPanel>
            )}
            <details>
              <summary>Service period review history</summary>
              <div className="stack">
                {line.history.map((h) => (
                  <div key={h.id}>
                    <p>
                      {h.cleared ? "Cleared period" : "Reviewed period"} ·{" "}
                      {dateLabel(h.covered_from)} – {dateLabel(h.covered_to)} ·{" "}
                      {money(h.amount_cents)}
                      {h.service === "training" && h.days
                        ? ` · ${h.days.filter((d) => d.status === "worked" || d.status === "rest").length} billable days`
                        : ""}
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
              href={`/admin/invoices/${invoice}?manual_service_page=${page - 1}#invoice-reporting`}
            >
              Previous
            </Link>
          )}
          {page * 25 < data.count && (
            <Link
              className="button secondary"
              href={`/admin/invoices/${invoice}?manual_service_page=${page + 1}#invoice-reporting`}
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
export async function ManualServiceReporting({
  invoice,
  page,
}: {
  invoice: string;
  page: number;
}) {
  const { db } = await requireAdmin();
  const result = await db.rpc("manual_service_reporting", {
    p_invoice: invoice,
    p_page: page,
  });
  if (result.error || !result.data)
    return (
      <p className="notice error" role="alert">
        Manual service periods could not load. Check the latest reporting
        migration.
      </p>
    );
  return (
    <ManualServiceReportingContent
      invoice={invoice}
      page={page}
      data={result.data as ManualServiceOptions}
    />
  );
}
