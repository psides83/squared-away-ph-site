import Link from "next/link";
import { dateLabel, money, today } from "@/lib/format";
export type HorseStatusData = {
  horse_id: string;
  last_trained: string | null;
  training_title: string | null;
  last_fed: string | null;
  feeding_label: string | null;
  outstanding_cents: number;
  overdue_cents: number;
  bills: {
    id: string;
    number: number;
    due_date: string;
    balance_cents: number;
  }[];
};
export function HorseStatus({
  status,
  showBilling = true,
}: {
  status?: HorseStatusData;
  showBilling?: boolean;
}) {
  if (!status)
    return <p className="muted">Activity and billing status unavailable.</p>;
  return (
    <>
      <dl className="training-activity">
        <div>
          <dt>Last fed</dt>
          <dd>
            {status.last_fed
              ? dateLabel(status.last_fed)
              : "No feeding recorded"}
            {status.last_fed && (
              <small>
                {status.feeding_label || "Extra / unscheduled feeding"}
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>Last trained</dt>
          <dd>
            {status.last_trained
              ? dateLabel(status.last_trained)
              : "No session recorded"}
            {status.training_title && <small>{status.training_title}</small>}
          </dd>
        </div>
        {showBilling && (
          <div>
            <dt>Outstanding bills</dt>
            <dd>
              {status.outstanding_cents > 0
                ? money(status.outstanding_cents)
                : "No outstanding bills"}
              {status.overdue_cents > 0 && (
                <small className="billing-past-due">
                  {money(status.overdue_cents)} past due
                </small>
              )}
            </dd>
          </div>
        )}
      </dl>
      {showBilling && status.bills.length > 0 && (
        <details className="horse-billing-details">
          <summary>
            View {status.bills.length} outstanding{" "}
            {status.bills.length === 1 ? "bill" : "bills"}
          </summary>
          <div className="stack">
            {status.bills.map((b) => (
              <Link
                className="text-link"
                key={b.id}
                href={`/admin/invoices/${b.id}`}
              >
                Invoice #{b.number} · {money(b.balance_cents)} ·{" "}
                {b.due_date < today() ? "Past due" : "Due"}{" "}
                {dateLabel(b.due_date)}
              </Link>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
export function HorseQuickActions({ id }: { id: string }) {
  return (
    <div className="row-actions horse-quick-actions">
      <Link
        className="button"
        href={`/admin/feeding?horse=${id}#feeding-rations`}
      >
        Feed
      </Link>
      <Link
        className="button secondary"
        href={`/admin/log?new=1&horse=${id}#record-form`}
      >
        Log training
      </Link>
    </div>
  );
}
