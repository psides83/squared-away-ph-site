import { PackageRevenueReport } from "@/components/package-revenue-report";
import type { PackageRevenue } from "@/lib/package-reporting";
import { validCashExportPeriod } from "@/lib/cash-export";
import { CashExportButton } from "@/components/cash-export-button";
import {
  ExpenseRecoveryReport,
  type ExpenseRecoveryReportData,
} from "@/components/expense-recovery-report";
import {
  FeedComparisonReport,
  type FeedComparison,
} from "@/components/feed-comparison-report";
import { HelpPanel } from "@/components/help-panel";
import { TemporalInput } from "@/components/temporal-input";
import {
  InventoryUsageReport,
  type InventoryUsage,
} from "@/components/inventory-usage-report";
import { SectionTabs } from "@/components/section-tabs";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today, money, dateLabel } from "@/lib/format";
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

type StayReport = {
  stays: {
    stay_id: string;
    horse_name: string;
    customer_name: string;
    arrival_date: string;
    departure_date: string | null;
    received_cents: number;
    direct_cents: number;
    shared_cents: number;
    margin_cents: number;
  }[];
  unassigned_received_cents: number;
  unassigned_direct_cents: number;
  unassigned_shared_cents: number;
  unallocated_shared_cents: number;
};

type Report = {
  received_cents: number;
  spent_cents: number;
  net_cents: number;
  supplier_credit_used_cents?: number;
  supplier_refunds_cents?: number;
  customer_refunds_cents?: number;
  outstanding_cents: number;
  overdue_cents: number;
  categories: { name: string; amount_cents: number; expense_count: number }[];
  months: {
    month: string;
    supplier_credit_used_cents?: number;
    received_cents: number;
    spent_cents: number;
    supplier_refunds_cents?: number;
    customer_refunds_cents?: number;
  }[];
};
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
  const valid = validCashExportPeriod(from, to);
  const [result, usage, comparison, recovery, packages] = valid
    ? await Promise.all([
        db.rpc("financial_report_bundle", { p_from: from, p_to: to }),
        db.rpc("inventory_usage_report", { p_from: from, p_to: to }),
        db.rpc("feed_charge_comparison", { p_from: from, p_to: to }),
        db.rpc("expense_recovery_report", { p_from: from, p_to: to }),
        db.rpc("package_revenue_report", { p_from: from, p_to: to }),
      ])
    : [null, null, null, null, null];
  const report = result?.data?.business as Report | null;
  const horseReport = result?.data?.horse as HorseReport | null;
  const stayReport = result?.data?.stay as StayReport | null;
  return (
    <>
      <PageHeading
        eyebrow="THE BUSINESS"
        title="Business reports"
        description="Review cash flow, horse and training-visit results, and feed costs versus customer charges."
      />
      <section className="panel">
        <form method="get" className="record-form report-period-form">
          <div className="form-grid">
            <label>
              From
              <TemporalInput
                name="from"
                type="date"
                required
                defaultValue={from}
              />
            </label>
            <label>
              Through
              <TemporalInput name="to" type="date" required defaultValue={to} />
            </label>
            <div className="form-actions">
              <button className="button primary" type="submit">
                Update report
              </button>
            </div>
          </div>
        </form>
      </section>
      {!valid || result?.error || !report || !horseReport || !stayReport ? (
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
              ["SUPPLIER REFUNDS", report.supplier_refunds_cents ?? 0],
              ["CUSTOMER REFUNDS", report.customer_refunds_cents ?? 0],
              ["STORE CREDIT USED", report.supplier_credit_used_cents ?? 0],
              ["NET CASH PROFIT", report.net_cents],
            ].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <div className="stat-top">{label}</div>
                <strong>{money(Number(value))}</strong>
              </div>
            ))}
          </div>
          <HelpPanel title="How these financial reports are calculated">
            {" "}
            <p>
              Store credits reduce the cash portion of settled purchases; they
              do not reduce feed value or count as cash income. Horse and visit
              costs retain their full recorded amounts and reconcile through the
              separately shown non-cash credit offset. These figures use payment
              dates and expense paid dates. They exclude unpaid bills, drafts,
              voided expenses, and reversed payments. Corrections update past
              periods. Feed purchases count once as expenses; consuming that
              feed does not subtract its cost again. Actual supplier refunds
              increase net cash separately from customer payments and gross
              expenses paid. They remain unassigned business credits in
              horse/visit reconciliation. This report covers recorded activity
              only.
            </p>
          </HelpPanel>
          <p className="muted">
            Customer refunds reduce cash on the date returned. Horse and visit
            net receipts include those refunds under the invoice’s reporting
            assignment.
          </p>
          <SectionTabs
            id="reports"
            label="Financial report sections"
            defaultTab="cash"
            sections={[
              {
                id: "package-revenue",
                label: "Package revenue",
                content: (
                  <PackageRevenueReport
                    report={
                      packages?.error
                        ? null
                        : (packages?.data as PackageRevenue | null)
                    }
                  />
                ),
              },
              {
                id: "expense-recovery",
                label: "Expense recovery",
                content: (
                  <ExpenseRecoveryReport
                    data={
                      recovery?.error
                        ? null
                        : (recovery?.data as ExpenseRecoveryReportData | null)
                    }
                  />
                ),
              },
              {
                id: "cash",
                label: "Monthly cash",
                content: (
                  <>
                    <section className="panel">
                      <div className="panel-heading cash-export-heading">
                        <h2>Monthly cash results</h2>
                        <CashExportButton from={from} to={to} />
                      </div>
                      <div className="record-form">
                        <HelpPanel title="What is included in the cash export?">
                          <p>
                            The CSV includes customer payments, paid expenses,
                            supplier refunds and customer refunds for the
                            selected dates. Store credit is shown separately
                            from cash paid. Full-credit purchases remain visible
                            with zero cash paid. Unpaid bills, drafts, voided
                            expenses, reversed transactions and feed consumption
                            are excluded.
                          </p>
                          <p>
                            Each row includes record IDs for review. Customer
                            names use the saved invoice details; supplier names
                            and expense categories reflect current records.
                            Corrections can change earlier periods. This is a
                            generic spreadsheet ledger. Direct
                            accounting-software integrations remain planned.
                            Exports are limited to 10,000 entries; shorten the
                            period if needed. Text that could be read as a
                            spreadsheet formula is prefixed with an apostrophe.
                          </p>
                        </HelpPanel>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Month</th>
                              <th>Payments received</th>
                              <th>Paid out</th>
                              <th>Supplier refunds</th>
                              <th>Customer refunds</th>
                              <th>Store credit used</th>
                              <th>Net cash profit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.months.map((m) => (
                              <tr key={m.month}>
                                <td>{m.month}</td>
                                <td>{money(m.received_cents)}</td>
                                <td>{money(m.spent_cents)}</td>
                                <td>{money(m.supplier_refunds_cents ?? 0)}</td>
                                <td>{money(m.customer_refunds_cents ?? 0)}</td>
                                <td>
                                  {money(m.supplier_credit_used_cents ?? 0)}
                                </td>
                                <td>
                                  {money(
                                    m.received_cents -
                                      m.spent_cents +
                                      (m.supplier_refunds_cents ?? 0) -
                                      (m.customer_refunds_cents ?? 0),
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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
                        <strong>{money(report.outstanding_cents)}</strong>{" "}
                        outstanding, including{" "}
                        <strong>{money(report.overdue_cents)}</strong> overdue
                        as of today. These balances are separate from the
                        selected period’s cash profit.
                      </p>
                    </section>
                  </>
                ),
              },
              {
                id: "expenses",
                label: "Expenses",
                content: (
                  <>
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
                  </>
                ),
              },
              {
                id: "usage",
                label: "Feed usage",
                content: (
                  <InventoryUsageReport
                    report={
                      usage?.error
                        ? null
                        : (usage?.data as InventoryUsage | null)
                    }
                  />
                ),
              },
              {
                id: "feed-comparison",
                label: "Feed cost vs charges",
                content: (
                  <FeedComparisonReport
                    report={
                      comparison?.error
                        ? null
                        : (comparison?.data as FeedComparison | null)
                    }
                  />
                ),
              },
              {
                id: "horses",
                label: "By horse",
                content: (
                  <>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Horse cash margins</h2>
                        <Link href="/admin/allocations" className="text-link">
                          Allocate shared costs
                        </Link>
                      </div>
                      <p>
                        Payments on stay-linked invoices belong to that stay’s
                        horse. Manual invoice receipts use their saved reporting
                        assignment. Direct horse expenses and saved shared-cost
                        splits use the expense paid date. These are margins from
                        assigned records, not complete horse profitability.
                      </p>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Horse</th>
                              <th>Net receipts</th>
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
                      {!horseReport.horses.length && (
                        <p>No horses on file yet.</p>
                      )}
                      <p className="notice">
                        Not assigned to a horse:{" "}
                        <strong>
                          {money(horseReport.unassigned_received_cents)}
                        </strong>{" "}
                        received without a horse reporting assignment, and{" "}
                        <strong>
                          {money(horseReport.unallocated_paid_cents)}
                        </strong>{" "}
                        in paid shared expenses without an allocation. Resolve
                        these amounts before treating horse margins as complete.
                        Use Match income & expenses to assign manual invoices;
                        customer ownership alone does not determine the horse.
                      </p>
                      <p>
                        Reconciliation: horse margins{" "}
                        {money(
                          horseReport.horses.reduce(
                            (sum, h) => sum + h.margin_cents,
                            0,
                          ),
                        )}{" "}
                        + unassigned receipts{" "}
                        {money(horseReport.unassigned_received_cents)} −
                        unallocated shared costs{" "}
                        {money(horseReport.unallocated_paid_cents)} + unassigned
                        supplier refunds{" "}
                        {money(report.supplier_refunds_cents ?? 0)} + non-cash
                        supplier credit used{" "}
                        {money(report.supplier_credit_used_cents ?? 0)} =
                        business net cash profit {money(report.net_cents)}.
                      </p>
                    </section>
                  </>
                ),
              },
              {
                id: "stays",
                label: "By training stay",
                content: (
                  <>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Training-stay cash margins</h2>
                        <Link href="/admin/attribution" className="text-link">
                          Match income & expenses
                        </Link>
                      </div>
                      <p>
                        Receipts use the invoice’s original stay or a saved
                        reporting link. Costs use reviewed stay splits on direct
                        horse expenses and current shared-cost portions. Dates
                        below identify the stay; the selected report period
                        still uses payment dates. Unassigned amounts remain
                        separate.
                      </p>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Horse / billing customer</th>
                              <th>Stay</th>
                              <th>Net receipts</th>
                              <th>Direct costs paid</th>
                              <th>Shared costs paid</th>
                              <th>Recorded cash margin</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stayReport.stays.map((s) => (
                              <tr key={s.stay_id}>
                                <td>
                                  {s.horse_name}
                                  <small className="cell-secondary">
                                    {s.customer_name}
                                  </small>
                                </td>
                                <td>
                                  {dateLabel(s.arrival_date)} –{" "}
                                  {s.departure_date
                                    ? dateLabel(s.departure_date)
                                    : "ongoing"}
                                </td>
                                <td>{money(s.received_cents)}</td>
                                <td>{money(s.direct_cents)}</td>
                                <td>{money(s.shared_cents)}</td>
                                <td>{money(s.margin_cents)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!stayReport.stays.length && (
                        <p>No training stays yet.</p>
                      )}
                      <p className="notice">
                        Not assigned to stays: receipts{" "}
                        {money(stayReport.unassigned_received_cents)}, direct
                        horse costs {money(stayReport.unassigned_direct_cents)},
                        and allocated horse shares{" "}
                        {money(stayReport.unassigned_shared_cents)}. Shared barn
                        costs not yet allocated to horses:{" "}
                        {money(stayReport.unallocated_shared_cents)}.
                        Owner-horse costs with no training stay correctly remain
                        outside stay margins. These figures represent assigned
                        recorded activity, not complete stay profitability.
                      </p>
                      <p>
                        Reconciliation: stay margins{" "}
                        {money(
                          stayReport.stays.reduce(
                            (sum, s) => sum + s.margin_cents,
                            0,
                          ),
                        )}{" "}
                        + unassigned receipts{" "}
                        {money(stayReport.unassigned_received_cents)} −
                        unassigned direct costs{" "}
                        {money(stayReport.unassigned_direct_cents)} − unassigned
                        horse shares {money(stayReport.unassigned_shared_cents)}{" "}
                        − unallocated barn costs{" "}
                        {money(stayReport.unallocated_shared_cents)} +
                        unassigned supplier refunds{" "}
                        {money(report.supplier_refunds_cents ?? 0)} + non-cash
                        supplier credit used{" "}
                        {money(report.supplier_credit_used_cents ?? 0)} =
                        business net cash profit {money(report.net_cents)}.
                      </p>
                    </section>
                  </>
                ),
              },
            ]}
          />
        </>
      )}
    </>
  );
}
