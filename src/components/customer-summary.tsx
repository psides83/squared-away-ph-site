import Link from "next/link";
import { dateLabel, money } from "@/lib/format";
import { phoneDisplay } from "@/lib/input-format";
export type CustomerSummaryData = {
  customer_id: string;
  horse_count: number;
  current_stays: number;
  outstanding_cents: number;
  overdue_cents: number;
  outstanding_count: number;
  draft_count: number;
  last_payment_date: string | null;
  last_payment_cents: number | null;
  portal_status: string;
};
export function CustomerSummary({
  summary,
}: {
  summary?: CustomerSummaryData;
}) {
  if (!summary) return <p className="muted">Customer summary unavailable.</p>;
  return (
    <dl className="training-activity customer-activity">
      <div>
        <dt>Outstanding</dt>
        <dd>
          {summary.outstanding_cents > 0
            ? money(summary.outstanding_cents)
            : "No outstanding bills"}
          {summary.overdue_cents > 0 && (
            <small className="billing-past-due">
              {money(summary.overdue_cents)} past due
            </small>
          )}
        </dd>
      </div>
      <div>
        <dt>Latest payment</dt>
        <dd>
          {summary.last_payment_date
            ? `${money(summary.last_payment_cents ?? 0)} · ${dateLabel(summary.last_payment_date)}`
            : "No payment recorded"}
        </dd>
      </div>
      <div>
        <dt>Horses & training</dt>
        <dd>
          {summary.horse_count} linked{" "}
          {Number(summary.horse_count) === 1 ? "horse" : "horses"}
          <small>
            {summary.current_stays} current training{" "}
            {Number(summary.current_stays) === 1 ? "agreement" : "agreements"}{" "}
            billed here
          </small>
        </dd>
      </div>
    </dl>
  );
}
export function CustomerActions({
  customer,
}: {
  customer: { id: string; phone?: string | null; email?: string | null };
}) {
  const phone = customer.phone?.replace(/[^+\d]/g, "");
  return (
    <div className="row-actions customer-quick-actions">
      {phone && (
        <>
          <a className="button secondary" href={`tel:${phone}`}>
            Call
          </a>
          <a className="button secondary" href={`sms:${phone}`}>
            Text
          </a>
        </>
      )}
      {customer.email && (
        <a className="button secondary" href={`mailto:${customer.email}`}>
          Email
        </a>
      )}
      <Link
        className="button"
        href={`/admin/invoices?new=1&customer=${customer.id}#invoice-form`}
      >
        New invoice
      </Link>
    </div>
  );
}
export function CustomerContact({
  phone,
  email,
}: {
  phone?: string | null;
  email?: string | null;
}) {
  return (
    <div className="contact-cell">
      {phone && <span>{phoneDisplay(phone)}</span>}
      {email && <span className="customer-email">{email}</span>}
      {!phone && !email && (
        <span className="muted">No contact details added</span>
      )}
    </div>
  );
}
