import Link from "next/link";
import { dateLabel, money } from "@/lib/format";
import { expectedRecovery } from "@/lib/return-expectations";
export type RecoveryFilter = "outstanding" | "overdue" | "unset" | "all";
export type RecoveryRow = {
  id: string;
  vendor: string;
  product_name: string;
  returned_on: string;
  cash_cents: number | null;
  cash_due: string | null;
  credit_cents: number | null;
  credit_due: string | null;
  notes: string | null;
  cash_received_cents: number;
  credit_issued_cents: number;
  overdue: boolean;
  outstanding: boolean;
  unset: boolean;
};
export type RecoveryQueue = {
  as_of: string;
  total: number;
  summary: {
    cash_remaining_cents: number;
    credit_remaining_cents: number;
    outstanding_count: number;
    overdue_count: number;
    unset_count: number;
    active_count: number;
  };
  rows: RecoveryRow[];
};
const filters: {
  id: RecoveryFilter;
  label: string;
  count: keyof Pick<
    RecoveryQueue["summary"],
    "outstanding_count" | "overdue_count" | "unset_count" | "active_count"
  >;
}[] = [
  { id: "outstanding", label: "Outstanding", count: "outstanding_count" },
  { id: "overdue", label: "Overdue", count: "overdue_count" },
  { id: "unset", label: "Unset targets", count: "unset_count" },
  { id: "all", label: "All active", count: "active_count" },
];
export function SupplierRecoveryQueue({
  data,
  filter,
  page,
}: {
  data: RecoveryQueue;
  filter: RecoveryFilter;
  page: number;
}) {
  return (
    <>
      <section className="panel">
        <div className="record-form stack">
          <div className="supplier-return-values">
            <div>
              <span className="muted">Cash refunds outstanding</span>
              <p>
                <strong>{money(data.summary.cash_remaining_cents)}</strong>
              </p>
            </div>
            <div>
              <span className="muted">Store credit outstanding</span>
              <p>
                <strong>{money(data.summary.credit_remaining_cents)}</strong>
              </p>
            </div>
          </div>
          <p className="muted">
            Totals cover known targets across all active returns. Unset amounts
            are unknown, not zero. Store credit is separate from cash. As of{" "}
            {dateLabel(data.as_of)}.
          </p>
        </div>
      </section>
      <nav className="row-actions" aria-label="Supplier follow-up filters">
        {filters.map((item) => (
          <Link
            key={item.id}
            className={`button ${filter === item.id ? "" : "secondary"}`}
            aria-current={filter === item.id ? "page" : undefined}
            href={`?filter=${item.id}`}
          >
            {item.label} ({data.summary[item.count]})
          </Link>
        ))}
      </nav>
      {!data.rows.length && (
        <section className="panel record-form">
          <p>
            {filter === "overdue"
              ? "No supplier refunds or credits are overdue."
              : filter === "outstanding"
                ? "No known refund or store-credit amounts are outstanding."
                : filter === "unset"
                  ? "All active returns have both targets specified."
                  : "No active supplier returns."}
          </p>
          {filter === "outstanding" && data.summary.unset_count > 0 && (
            <Link className="button secondary" href="?filter=unset">
              Review unset targets
            </Link>
          )}
          {page > 1 && (
            <Link className="button secondary" href={`?filter=${filter}`}>
              Back to first page
            </Link>
          )}
        </section>
      )}
      {data.rows.map((row) => (
        <article className="panel" key={row.id}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {row.vendor} · {dateLabel(row.returned_on)}
              </p>
              <h2>{row.product_name}</h2>
            </div>
            <span className="tag">
              {row.overdue
                ? "Overdue"
                : row.outstanding
                  ? "Awaiting recovery"
                  : row.unset
                    ? "Targets incomplete"
                    : "Targets fulfilled"}
            </span>
          </div>
          <div className="record-form stack">
            <div className="supplier-return-values">
              {[
                {
                  label: "Cash refund",
                  target: row.cash_cents,
                  received: row.cash_received_cents,
                  due: row.cash_due,
                },
                {
                  label: "Store credit",
                  target: row.credit_cents,
                  received: row.credit_issued_cents,
                  due: row.credit_due,
                },
              ].map((item) => {
                const status = expectedRecovery(
                  item.target,
                  item.received,
                  item.due,
                  data.as_of,
                );
                return (
                  <div key={item.label}>
                    <strong>{item.label}</strong>
                    <p>
                      {item.target === null
                        ? "Target not set"
                        : item.target === 0
                          ? "None expected"
                          : `${money(status.remaining!)} remaining of ${money(item.target)}`}
                    </p>
                    <p className="muted">
                      {money(item.received)}{" "}
                      {item.label === "Store credit" ? "issued" : "received"}
                    </p>
                    {item.due &&
                      status.remaining !== null &&
                      status.remaining > 0 && (
                        <p className={status.overdue ? "notice" : "muted"}>
                          {status.overdue ? "Overdue · " : ""}Due{" "}
                          {dateLabel(item.due)}
                        </p>
                      )}
                  </div>
                );
              })}
            </div>
            {row.notes && <p>{row.notes}</p>}
            <div className="row-actions">
              <Link
                className="button secondary"
                href={`/admin/inventory?section=returns&return=${row.id}#return-${row.id}`}
              >
                Open return
              </Link>
              {row.cash_cents !== null &&
                row.cash_received_cents < row.cash_cents && (
                  <Link
                    className="button secondary"
                    href={`/admin/inventory?section=returns&return=${row.id}#refund-${row.id}`}
                  >
                    Record cash refund
                  </Link>
                )}
              {row.credit_cents !== null &&
                row.credit_issued_cents < row.credit_cents && (
                  <Link
                    className="button secondary"
                    href={`/admin/inventory?section=credits&credit_return=${row.id}&credit_new=1#new-supplier-credit`}
                  >
                    Record store credit
                  </Link>
                )}
              {row.unset && (
                <Link
                  className="button secondary"
                  href={`/admin/inventory?section=returns&return=${row.id}#expectations-${row.id}`}
                >
                  Set targets
                </Link>
              )}
            </div>
          </div>
        </article>
      ))}
      <nav className="row-actions" aria-label="Supplier follow-up pages">
        {page > 1 && (
          <Link
            className="button secondary"
            href={`?filter=${filter}&page=${page - 1}`}
          >
            Previous page
          </Link>
        )}
        {page * 25 < data.total && (
          <Link
            className="button secondary"
            href={`?filter=${filter}&page=${page + 1}`}
          >
            Next page
          </Link>
        )}
      </nav>
    </>
  );
}
