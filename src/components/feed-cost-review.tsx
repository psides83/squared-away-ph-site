import { money, dateLabel } from "@/lib/format";
import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { invoiceAction } from "@/app/admin/invoices/actions";
export function FeedCostReview({
  invoice,
  corrections,
}: {
  invoice: string;
  corrections: {
    correction_id: string;
    inventory_cost_corrections: {
      old_quantity: number | string;
      new_quantity: number | string;
      unit_label: string;
      old_cost_cents: number;
      new_cost_cents: number;
      reason: string;
      created_at: string;
    };
  }[];
}) {
  if (!corrections.length) return null;
  return (
    <section className="panel no-print">
      <div className="panel-heading">
        <h2>Feed costs changed</h2>
      </div>
      <div className="record-form">
        <p className="notice">
          A stock quantity or cost correction changed feeding costs used by this
          invoice or its reporting period. Charges and payments have not
          changed. Review any difference before completing this review.
        </p>
        <p>
          <Link className="text-link" href="/admin/inventory/cost-reviews">
            View stock correction history
          </Link>
        </p>
        {corrections.map((flag) => (
          <ActionPanel
            key={flag.correction_id}
            id={`review-cost-${flag.correction_id}`}
            label="Review stock correction"
          >
            <div className="panel-heading">
              <h2>Record cost review</h2>
            </div>
            <form
              className="record-form"
              action={invoiceAction.bind(null, "feed-cost-review")}
            >
              <input type="hidden" name="invoice_id" value={invoice} />
              <input
                type="hidden"
                name="correction_id"
                value={flag.correction_id}
              />
              <p>
                {dateLabel(
                  flag.inventory_cost_corrections.created_at.slice(0, 10),
                )}{" "}
                · {flag.inventory_cost_corrections.reason}
              </p>
              {Number(flag.inventory_cost_corrections.old_quantity) !==
                Number(flag.inventory_cost_corrections.new_quantity) && (
                <p>
                  Source quantity:{" "}
                  {Number(
                    flag.inventory_cost_corrections.old_quantity,
                  ).toLocaleString("en-US", { maximumFractionDigits: 6 })}{" "}
                  →{" "}
                  {Number(
                    flag.inventory_cost_corrections.new_quantity,
                  ).toLocaleString("en-US", { maximumFractionDigits: 6 })}{" "}
                  {flag.inventory_cost_corrections.unit_label}
                </p>
              )}
              <p>
                Source total:{" "}
                {money(flag.inventory_cost_corrections.old_cost_cents)} →{" "}
                {money(flag.inventory_cost_corrections.new_cost_cents)}
              </p>
              <p>
                For draft actual-cost feed charges, remove and regenerate
                outdated lines first. For issued invoices, record an adjustment
                if needed, then explain your decision here.
              </p>
              <Field
                label="Review notes / adjustment decision"
                name="reason"
                required
                maxLength={2000}
              />
              <div className="form-actions">
                <SubmitButton>Complete review</SubmitButton>
              </div>
            </form>
          </ActionPanel>
        ))}
      </div>
    </section>
  );
}
