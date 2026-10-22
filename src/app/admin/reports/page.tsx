import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today, money } from "@/lib/format";
import { PageHeading } from "@/components/ui";

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
  const result = valid
    ? await db.rpc("cash_report", { p_from: from, p_to: to })
    : null;
  const report = result?.data as Report | null;
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
      {!valid || result?.error || !report ? (
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
          <p className="notice">
            Horse-level profit and shared-cost allocations are still being
            built. Shared barn costs are included in overall expenses here, but
            have not been distributed across individual horses.
          </p>
        </>
      )}
    </>
  );
}
