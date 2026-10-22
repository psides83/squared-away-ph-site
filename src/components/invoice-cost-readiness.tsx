import Link from "next/link";
import { dateLabel } from "@/lib/format";
import { invoiceAction } from "@/app/admin/invoices/actions";
import { SubmitButton } from "@/components/submit-button";
export type CostReadiness = {
  service: string;
  ready: boolean;
  changed: boolean;
  reviewed_at: string | null;
  source_count: number;
  line_count: number;
};
export function InvoiceCostReadiness({
  invoice,
  rows,
  error,
  events = [],
  period,
}: {
  period?: { from: string; to: string };
  events?: {
    service: string;
    ready: boolean;
    reason: string;
    created_at: string;
  }[];
  invoice: string;
  rows: CostReadiness[];
  error?: boolean;
}) {
  if (error)
    return (
      <p className="notice error">
        Actual-cost readiness could not load. Check the invoice period,
        agreement, and latest database migration.
      </p>
    );
  if (!rows.length && !events.length) return null;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Actual-cost period review</h2>
      </div>
      <div className="record-form stack">
        {period && (
          <p>
            <strong>Invoice period:</strong> {dateLabel(period.from)}–
            {dateLabel(period.to)}
          </p>
        )}
        {rows.length > 0 && (
          <>
            <p>
              Generate and review the charges, then confirm that all feed or
              boarding costs for this invoice period have been entered. New or
              changed records and service charges require another review.
              Automatic billing is not scheduled yet.
            </p>
            <Link
              className="text-link"
              href={`/admin/invoices/${invoice}#generate-services`}
            >
              Review training and service charges
            </Link>
          </>
        )}
        {rows.map((r) => (
          <div className="stack separated" key={r.service}>
            <h3>
              {r.service === "feed" ? "Feed" : "Boarding"} ·{" "}
              {r.ready
                ? "Ready"
                : r.changed
                  ? "Review needed — records changed"
                  : "Not marked ready"}
            </h3>
            <p className="muted">
              {r.source_count} recorded source lines · {r.line_count} generated
              service lines.{" "}
              {r.service === "boarding"
                ? "Review all assigned stay costs; source count includes costs outside the invoice period."
                : "Source count includes reversed or already claimed records; review the detailed charges."}
            </p>
            <details>
              <summary>
                {r.ready ? "Reopen review" : "Review and mark ready"}
              </summary>
              <form
                action={invoiceAction.bind(null, "cost-ready")}
                className="stack readiness-form"
              >
                <input name="invoice_id" type="hidden" value={invoice} />
                <input name="service" type="hidden" value={r.service} />
                <input
                  name="ready"
                  type="hidden"
                  value={r.ready ? "no" : "yes"}
                />
                {!r.ready && (
                  <label className="inline-checkbox">
                    <input name="confirmed" type="checkbox" required />
                    All relevant records and charges for this period have been
                    reviewed, including any intentional zero cost.
                  </label>
                )}
                <label>
                  Review note
                  <textarea
                    name="reason"
                    required
                    maxLength={2000}
                    rows={2}
                    placeholder={
                      r.ready
                        ? "Why does this period need more review?"
                        : "What did you check?"
                    }
                  />
                </label>
                <SubmitButton>
                  {r.ready ? "Mark as needing review" : "Mark records ready"}
                </SubmitButton>
              </form>
            </details>
          </div>
        ))}
        {events.length > 0 && (
          <details>
            <summary>Review history ({events.length} latest)</summary>
            <div className="stack readiness-form">
              {events.map((e, index) => (
                <p key={index}>
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "America/Chicago",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(e.created_at))}{" "}
                  · {e.service === "feed" ? "Feed" : "Boarding"} ·{" "}
                  {e.ready ? "Marked ready" : "Reopened"}
                  <br />
                  {e.reason}
                </p>
              ))}
            </div>
          </details>
        )}
        <p className="muted">
          Reviews are saved for this invoice period. Automatic scheduling is
          still planned.
        </p>
      </div>
    </section>
  );
}
