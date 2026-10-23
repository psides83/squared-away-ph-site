import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { money, dateLabel, today } from "@/lib/format";
import { ActionPanel } from "@/components/action-panel";
import {
  SupplierCreditForm,
  type CreditChoice,
} from "@/components/supplier-credit-forms";
export type CreditApplication = {
  id: string;
  credit_id: string;
  expense_id: string;
  amount_cents: number;
  applied_on: string;
  reversed_at: string | null;
  reverse_reason: string | null;
  vendor: string;
  reference?: string | null;
  expense_date?: string;
  paid_on?: string | null;
};
export function CreditApplicationList({
  rows,
  date,
}: {
  rows: CreditApplication[];
  date: string;
}) {
  return (
    <div className="stack">
      {rows.map((a) => (
        <article className="panel" key={a.id}>
          <div className="record-form">
            <strong>
              {money(a.amount_cents)} · {dateLabel(a.applied_on)}
            </strong>
            <p className="muted">
              {a.vendor}
              {a.reference ? ` · ${a.reference}` : ""}
              {a.reversed_at ? " · Reversed" : " · Applied"}
            </p>
            {a.reversed_at ? (
              <p>{a.reverse_reason}</p>
            ) : (
              <ActionPanel
                id={`reverse-credit-${a.id}`}
                label="Correct application"
              >
                <SupplierCreditForm operation="reverse" date={date} id={a.id} />
              </ActionPanel>
            )}
            <div className="row-actions">
              <Link
                className="text-link"
                href={`/admin/expenses/${a.expense_id}#expense-supplier-credits`}
              >
                Purchase expense
              </Link>
              <Link
                className="text-link"
                href={`/admin/inventory?section=credits&credit=${a.credit_id}#inventory-credits`}
              >
                Credit record
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
export async function ExpenseSupplierCredits({
  expense,
  page = 1,
}: {
  expense: string;
  page?: number;
}) {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("expense_supplier_credits", {
    p_expense: expense,
    p_page: page,
  });
  if (error || !data)
    return (
      <p className="notice error">
        Supplier credits could not load. Check the latest migration.
      </p>
    );
  const result = data as {
    applied_cents: number;
    cash_cents: number;
    eligible: CreditChoice[];
    applications: CreditApplication[];
    application_count: number;
  };
  return (
    <>
      <section className="panel record-form stack">
        <h2>Supplier credit & cash</h2>
        <div className="supplier-return-values">
          <div>
            <span>Credit applied</span>
            <strong>{money(result.applied_cents)}</strong>
          </div>
          <div>
            <span>Cash portion</span>
            <strong>{money(result.cash_cents)}</strong>
          </div>
        </div>
        <p className="muted">
          The full purchase cost and feed inventory value stay unchanged. Only
          the cash portion counts as cash spent after a paid/settled date is
          recorded. A credit alone does not mark the purchase settled.
        </p>
        {result.eligible.length > 0 && result.cash_cents > 0 ? (
          <ActionPanel id="apply-supplier-credit" label="Apply supplier credit">
            <SupplierCreditForm
              operation="apply"
              expenseId={expense}
              date={today()}
              request={crypto.randomUUID()}
              credits={result.eligible}
              cash={result.cash_cents}
            />
          </ActionPanel>
        ) : (
          <p className="muted">
            No matching available credit, or this purchase is already covered.
          </p>
        )}
        <Link
          className="text-link"
          href="/admin/inventory?section=credits#inventory-credits"
        >
          Manage supplier credits
        </Link>
        <p className="muted">
          Choices show up to 100 oldest available credits for the exact supplier
          name.
        </p>
      </section>
      <h3>Credit application history</h3>
      <CreditApplicationList rows={result.applications} date={today()} />
      {!result.applications.length && (
        <p className="record-form muted">No supplier credit applied yet.</p>
      )}
      <nav className="row-actions" aria-label="Purchase credit history">
        {page > 1 && (
          <Link
            className="button secondary"
            href={`?credit_application_page=${page - 1}#expense-supplier-credits`}
          >
            Newer applications
          </Link>
        )}
        {page * 20 < result.application_count && (
          <Link
            className="button secondary"
            href={`?credit_application_page=${page + 1}#expense-supplier-credits`}
          >
            Older applications
          </Link>
        )}
      </nav>
    </>
  );
}
