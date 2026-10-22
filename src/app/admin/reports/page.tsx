import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today, money } from "@/lib/format";
import { PageHeading } from "@/components/ui";

type HorseReport = {
  horses: {
    horse_id: string;
    horse_name: string;
    received_cents: number;
    direct_cents: number;
    shared_cents: number;
    margin_cents: number;
  }[];
  unassigned_received_cents: number;
  unallocated_paid_cents: number;
};

type Report = {
  received_cents: number;
  spent_cents: number;
  net_cents: number;
  outstanding_cents: number;
  overdue_cents: number;
  categories: { name: string; amount_cents: number; expense_count: number }[];
  months: { month: string; received_cents: number; spent_cents: number }[];
};
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export default async function Reports({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { db } = await requireAdmin();
  const query = await searchParams;
  const date = today();
  const from = query.from ?? `${date.slice(0, 4)}-01-01`;
  const to = query.to ?? date;
  const valid =
    validDate(from) &&
    validDate(to) &&
    from <= to &&
    Date.parse(to) - Date.parse(from) <= 3660 * 86400000;
  const [result, horseResult] = valid
    ? await Promise.all([
        db.rpc("cash_report", { p_from: from, p_to: to }),
        db.rpc("horse_cash_report", { p_from: from, p_to: to }),
      ])
    : [null, null];
  const report = result?.data as Report | null;
  const horseReport = horseResult?.data as HorseReport | null;
  return (
    <>
      <PageHeading
        eyebrow="THE BUSINESS"
        title="Revenue, costs & cash profit"
        description="Payments received minus expenses paid, for the dates you choose."
      />
      <section className="panel">
        <form method="get" className="form-grid">
          <label>
            From
            <input name="from" type="date" required defaultValue={from} />
          </label>
          <label>
            Through
            <input name="to" type="date" required defaultValue={to} />
          </label>
          <div className="form-actions">
            <button className="button primary" type="submit">
              Update report
            </button>
          </div>
        </form>
      </section>
      {!valid ||
      result?.error ||
      horseResult?.error ||
      !report ||
      !horseReport ? (
        <p className="notice error" role="alert">
          {!valid
            ? "Choose valid dates in order, covering at most ten years."
            : "The report could not load. Check the latest database migration, then try again."}
        </p>
      ) : (
        <>
          <div className="stats-grid">
            {[
              ["PAYMENTS RECEIVED", report.received_cents],
              ["EXPENSES PAID", report.spent_cents],
              ["NET CASH PROFIT", report.net_cents],
            ].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <div className="stat-top">{label}</div>
                <strong>{money(Number(value))}</strong>
              </div>
            ))}
          </div>
          <p className="notice">
            These figures use payment dates and expense paid dates. They exclude
            unpaid bills, drafts, voided expenses, and reversed payments.
            Corrections update past periods. Feed purchases count once as
            expenses; consuming that feed does not subtract its cost again. This
            report covers recorded activity only.
          </p>
          <section className="panel">
            <div className="panel-heading">
              <h2>Monthly cash results</h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Received</th>
                    <th>Paid out</th>
                    <th>Net cash profit</th>
                  </tr>
                </thead>
                <tbody>
                  {report.months.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}</td>
                      <td>{money(m.received_cents)}</td>
                      <td>{money(m.spent_cents)}</td>
                      <td>{money(m.received_cents - m.spent_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Paid expenses by category</h2>
              <Link href="/admin/expenses" className="text-link">
                View expenses
              </Link>
            </div>
            {report.categories.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Expenses</th>
                      <th>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.categories.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>{c.expense_count}</td>
                        <td>{money(c.amount_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No expenses paid in this period.</p>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Outstanding now</h2>
              <Link href="/admin/invoices" className="text-link">
                View invoices
              </Link>
            </div>
            <p>
              All issued invoices, across all dates:{" "}
              <strong>{money(report.outstanding_cents)}</strong> outstanding,
              including <strong>{money(report.overdue_cents)}</strong> overdue
              as of today. These balances are separate from the selected
              period’s cash profit.
            </p>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Horse cash margins</h2>
              <Link href="/admin/allocations" className="text-link">
                Allocate shared costs
              </Link>
            </div>
            <p>
              Payments on stay-linked invoices belong to that stay’s horse.
              Direct horse expenses and saved shared-cost splits use the expense
              paid date. These are margins from assigned records, not complete
              horse profitability.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Horse</th>
                    <th>Received</th>
                    <th>Direct costs paid</th>
                    <th>Shared costs paid</th>
                    <th>Recorded cash margin</th>
                  </tr>
                </thead>
                <tbody>
                  {horseReport.horses.map((h) => (
                    <tr key={h.horse_id}>
                      <td>{h.horse_name}</td>
                      <td>{money(h.received_cents)}</td>
                      <td>{money(h.direct_cents)}</td>
                      <td>{money(h.shared_cents)}</td>
                      <td>{money(h.margin_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!horseReport.horses.length && <p>No horses on file yet.</p>}
            <p className="notice">
              Not assigned to a horse:{" "}
              <strong>{money(horseReport.unassigned_received_cents)}</strong>{" "}
              received on invoices without a training stay, and{" "}
              <strong>{money(horseReport.unallocated_paid_cents)}</strong> in
              paid shared expenses without an allocation. Resolve these amounts
              before treating horse margins as complete. Manual invoice income
              remains unassigned; customer ownership alone does not determine
              the horse.
            </p>
            <p>
              Reconciliation: horse margins{" "}
              {money(
                horseReport.horses.reduce((sum, h) => sum + h.margin_cents, 0),
              )}{" "}
              + unassigned receipts{" "}
              {money(horseReport.unassigned_received_cents)} − unallocated
              shared costs {money(horseReport.unallocated_paid_cents)} =
              business net cash profit {money(report.net_cents)}.
            </p>
          </section>
        </>
      )}
    </>
  );
}
