import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
export type ExpenseRecoveryReportData = {
  totals: {
    absorbed_cost_cents?: number;
    undecided_cost_cents?: number;
    paid_cost_cents: number;
    issued_cost_cents: number;
    draft_cost_cents: number;
    unbilled_cost_cents: number;
    unbilled_reimbursable_cents: number;
    other_unbilled_cents: number;
    issued_fee_cents: number;
    recovered_cents: number;
    cash_recovered_cents?: number;
    credit_recovered_cents?: number;
    not_recovered_cents: number;
  };
  count: number;
  expenses: {
    id: string;
    vendor: string | null;
    expense_date: string;
    paid_on: string;
    category_name: string;
    horse_name: string | null;
    amount_cents: number;
    absorbed_cost_cents?: number;
    reimbursable: boolean;
    issued_cost_cents: number;
    draft_cost_cents: number;
    unbilled_cost_cents: number;
    recovered_cents: number;
    cash_recovered_cents?: number;
    credit_recovered_cents?: number;
    issued_fee_cents: number;
    invoices: {
      invoice_id: string;
      invoice_number: number | null;
      status: string;
      customer_name: string;
      cost_cents: number;
      charge_cents: number;
      balance_cents: number;
      due_date: string;
    }[];
  }[];
};
export function ExpenseRecoveryReport({
  data,
}: {
  data: ExpenseRecoveryReportData | null;
}) {
  if (!data)
    return (
      <p className="notice error">
        Expense recovery report could not load. Check the latest migration.
      </p>
    );
  return (
    <div className="stack">
      <p className="muted">
        Expenses paid during the selected dates, with their current billing and
        manually assigned recovery. Customer payments and account credit applied
        later are included in assigned recovery.
      </p>
      <HelpPanel title="How expense recovery differs from cash profit">
        <p>
          Original expense costs are split between finalized invoice claims,
          draft claims and costs not separately billed. Full expense
          charge-backs and assigned actual-cost boarding portions are included
          once. Fees are shown separately. Feed consumption is not a second
          expense reimbursement source.
        </p>
        <p>
          Only explicit assignments from active customer payments or applied
          account credit count as recovered cost. Unapplied account credit,
          invoice adjustments and settled balances do not establish recovery.
          Missing assignments can understate recovery. Costs not separately
          billed may be included in training rates, awaiting reimbursement or
          borne by the business; this report does not assume they are
          intentionally absorbed unless you explicitly designate an amount on
          the expense record. Absorbed amounts are included in costs not
          separately billed and not assigned as repaid; they are shown
          separately from costs awaiting a decision.
        </p>
        <p>
          This is a current view of a paid-expense cohort, not cash received
          during the selected dates. Cash reports already include actual
          customer cash receipts once, including advances on their received
          dates. Do not add assigned recovery again as revenue. Voided
          expenses/invoices, reversed payments/credit applications and removed
          assignments are excluded from active totals.
        </p>
      </HelpPanel>
      <div className="stats-grid">
        {[
          ["Expenses paid", data.totals.paid_cost_cents],
          ["Cost assigned as repaid", data.totals.recovered_cents],
          ["Cost not assigned as repaid", data.totals.not_recovered_cents],
          ["Cost on finalized invoices", data.totals.issued_cost_cents],
        ].map(([label, value]) => (
          <div className="stat-card" key={String(label)}>
            <div className="stat-top">{label}</div>
            <strong>{money(Number(value))}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Billing coverage</h2>
        </div>
        <div className="record-form stack">
          <p>
            Assigned from cash payments:{" "}
            <strong>
              {money(
                data.totals.cash_recovered_cents ?? data.totals.recovered_cents,
              )}
            </strong>{" "}
            · Assigned from account credit:{" "}
            <strong>{money(data.totals.credit_recovered_cents ?? 0)}</strong>
          </p>
          <p>
            On drafts: <strong>{money(data.totals.draft_cost_cents)}</strong> ·
            Not separately billed:{" "}
            <strong>{money(data.totals.unbilled_cost_cents)}</strong> · Fees on
            finalized linked charges:{" "}
            <strong>{money(data.totals.issued_fee_cents)}</strong>
          </p>
          <p>
            Intentionally absorbed:{" "}
            <strong>{money(data.totals.absorbed_cost_cents ?? 0)}</strong> ·
            Awaiting a billing decision:{" "}
            <strong>
              {money(
                data.totals.undecided_cost_cents ??
                  data.totals.unbilled_cost_cents,
              )}
            </strong>
          </p>
          <p className="muted">
            Excluding absorbed costs:{" "}
            {money(data.totals.unbilled_reimbursable_cents)} marked for customer
            charge-back; {money(data.totals.other_unbilled_cents)} other costs.
            Training/package revenue is not allocated here.
          </p>
        </div>
      </section>
      {data.count > 100 && (
        <p className="notice">
          Showing the latest 100 of {data.count} paid expenses. Totals include
          all matching expenses. Narrow the dates to review more.
        </p>
      )}
      {!data.expenses.length ? (
        <p className="notice">
          No non-voided expenses were paid during these dates.
        </p>
      ) : (
        data.expenses.map((e) => (
          <section className="panel" key={e.id}>
            <div className="panel-heading">
              <div>
                <h2>{e.vendor || "Expense"}</h2>
                <p className="muted form-hint">
                  {e.category_name} · {e.horse_name || "Barn / shared"} · Paid{" "}
                  {dateLabel(e.paid_on)}
                </p>
              </div>
              <Link className="text-link" href={`/admin/expenses/${e.id}`}>
                Expense record
              </Link>
            </div>
            <div className="record-form stack">
              <dl className="feed-comparison-metrics">
                {[
                  ["Original cost", e.amount_cents],
                  ["Assigned as repaid", e.recovered_cents],
                  ["Cost on finalized invoices", e.issued_cost_cents],
                  ["Not separately billed", e.unbilled_cost_cents],
                  ["Intentionally absorbed", e.absorbed_cost_cents ?? 0],
                  [
                    "Awaiting a billing decision",
                    e.unbilled_cost_cents - (e.absorbed_cost_cents ?? 0),
                  ],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt>{label}</dt>
                    <dd>{money(Number(value))}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted">
                Repaid through cash payments{" "}
                {money(e.cash_recovered_cents ?? e.recovered_cents)} · account
                credit {money(e.credit_recovered_cents ?? 0)}.
              </p>
              <details>
                <summary>Billing sources and payment assignments</summary>
                <div className="stack feed-comparison-detail">
                  {!e.invoices.length ? (
                    <p>No linked invoice claims.</p>
                  ) : (
                    e.invoices.map((i, index) => (
                      <div key={`${i.invoice_id}-${index}`}>
                        <Link
                          className="text-link"
                          href={`/admin/invoices/${i.invoice_id}#invoice-payments`}
                        >
                          {i.invoice_number
                            ? `Invoice #${i.invoice_number}`
                            : "Draft invoice"}{" "}
                          · {i.customer_name}
                        </Link>
                        <p>
                          {i.status === "draft" ? "Draft" : "Finalized"} ·
                          Original cost {money(i.cost_cents)} · Charge{" "}
                          {money(i.charge_cents)} · Whole-invoice balance{" "}
                          {money(i.balance_cents)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </details>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
