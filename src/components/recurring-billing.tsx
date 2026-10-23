import Link from "next/link";
import { dateLabel } from "@/lib/format";
import { billingScheduleLabels } from "@/lib/billing-schedule";
import { SubmitButton } from "@/components/submit-button";
import {
  prepareRecurring,
  skipVoidedCycle,
} from "@/app/admin/invoices/recurring/actions";
export type BillingCycle = {
  state: string;
  from?: string;
  to?: string;
  billing_date?: string;
  invoice_id?: string;
  cycle_id?: string;
  reason?: string | null;
};
export type RecurringStay = {
  stay_id: string;
  horse_id: string;
  horse_name: string;
  customer_name: string;
  schedule: string;
  billing_day: number;
  next: BillingCycle;
};
export function RecurringBillingCards({ rows }: { rows: RecurringStay[] }) {
  return (
    <div className="horse-grid">
      {rows.map((r) => (
        <article className="horse-card recurring-billing-card" key={r.stay_id}>
          <h3>
            <Link className="inline-link" href={`/admin/horses/${r.horse_id}`}>{r.horse_name}</Link>
          </h3>
          <p className="muted">
            Billed to {r.customer_name} · {billingScheduleLabels[r.schedule]}
            {r.schedule === "custom" ? ` (${r.billing_day})` : ""}
          </p>
          <p className="tag">
            {(
              {
                due: "Ready to prepare",
                upcoming: "Upcoming",
                review: "Draft needs review",
                voided: "Voided — action needed",
                complete: "All stay dates covered",
              } as Record<string, string>
            )[r.next.state] ?? r.next.state}
          </p>
          {r.next.from && r.next.to && (
            <p>
              Period: {dateLabel(r.next.from)}–{dateLabel(r.next.to)}
            </p>
          )}
          {r.next.billing_date && (
            <p>Billing date: {dateLabel(r.next.billing_date)}</p>
          )}
          {r.next.reason && (
            <p className="notice">Last preparation check: {r.next.reason}</p>
          )}
          <div className="row-actions">
            {["due", "review"].includes(r.next.state) && (
              <form action={prepareRecurring}>
                <input name="stay_id" type="hidden" value={r.stay_id} />
                <input name="period_from" type="hidden" value={r.next.from} />
                <input name="period_to" type="hidden" value={r.next.to} />
                <SubmitButton>
                  {r.next.state === "review"
                    ? "Recheck and finish invoice"
                    : "Prepare this cycle"}
                </SubmitButton>
              </form>
            )}
            {r.next.invoice_id && (
              <Link
                className="text-link"
                href={`/admin/invoices/${r.next.invoice_id}#invoice-charges`}
              >
                Open invoice
              </Link>
            )}
            <Link
              className="text-link"
              href={`/admin/training?edit=${r.stay_id}#record-form`}
            >
              Billing agreement
            </Link>
          </div>
          {r.next.state === "voided" && (
            <details>
              <summary>Skip this voided cycle</summary>
              <form className="stack readiness-form" action={skipVoidedCycle}>
                <input name="cycle_id" type="hidden" value={r.next.cycle_id} />
                <p>
                  This records an intentional skipped period and moves to the
                  next cycle. It does not replace the voided invoice.
                </p>
                <label>
                  Reason
                  <textarea name="reason" rows={2} required maxLength={2000} />
                </label>
                <SubmitButton>Skip and continue</SubmitButton>
              </form>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
