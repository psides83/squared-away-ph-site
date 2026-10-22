import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { PageHeading, Notice } from "@/components/ui";
import { DeleteButton } from "@/components/submit-button";
import { AllocationForm } from "@/components/allocation-form";
import type { AllocationBasis } from "@/lib/allocations";
import { clearAllocation } from "./actions";

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export default async function Allocations({
  searchParams,
}: {
  searchParams: Promise<{
    expense?: string;
    from?: string;
    to?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.page) || 1)),
  );
  const id =
    params.expense && /^[0-9a-f-]{36}$/i.test(params.expense)
      ? params.expense
      : null;
  const [list, selected] = await Promise.all([
    db
      .from("expenses")
      .select(
        "id,expense_date,paid_on,vendor,amount_cents,expense_allocations(id,retired_at)",
        { count: "exact" },
      )
      .is("horse_id", null)
      .is("voided_at", null)
      .order("expense_date", { ascending: false })
      .order("id")
      .range((page - 1) * 25, page * 25 - 1),
    id
      ? db.from("expenses").select("*").eq("id", id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const expense = selected.data;
  const history = expense
    ? await db
        .from("expense_allocations")
        .select("*,expense_allocation_lines(*)")
        .eq("expense_id", expense.id)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [], error: null };
  const active = history.data?.find((a) => !a.retired_at);
  const from =
    params.from ?? active?.period_from ?? expense?.expense_date ?? today();
  const to = params.to ?? active?.period_to ?? expense?.expense_date ?? today();
  const eligible = expense && !expense.voided_at && !expense.horse_id;
  const valid =
    validDate(from) &&
    validDate(to) &&
    from <= to &&
    to <= today() &&
    Date.parse(to) - Date.parse(from) <= 365 * 86400000;
  const basis =
    eligible && valid
      ? await db.rpc("allocation_board_days", { p_from: from, p_to: to })
      : null;
  const failed = list.error || selected.error || history.error || basis?.error;
  return (
    <>
      <PageHeading
        eyebrow="EVERY HORSE COUNTS"
        title="Shared barn costs"
        description="Divide a recorded expense by actual boarding days, including your own horses."
      />
      <Notice
        error={
          failed
            ? "Shared costs could not load. Check the latest migration and try again."
            : params.error ||
              (params.expense && !expense ? "Expense not found." : undefined)
        }
        success={params.success}
      />
      <p className="notice">
        Allocations distribute an existing cost; they never add another expense
        or issue a customer charge. Paid expenses appear in reports by their
        payment date, even when their boarding period differs. Direct horse
        expenses already belong to that horse.
      </p>
      {expense && (
        <ActionPanel
          id="allocate-expense"
          label="Divide this shared expense"
          defaultOpen
          closeHref="/admin/allocations"
        >
          <div className="panel-heading">
            <h2>
              {expense.vendor || "Shared expense"} ·{" "}
              {money(expense.amount_cents)}
            </h2>
            <Link
              href={`/admin/expenses?edit=${expense.id}`}
              className="text-link"
            >
              Expense / receipts
            </Link>
          </div>
          {!eligible ? (
            <p>
              This expense must be non-voided and assigned to Shared barn before
              it can be allocated.
            </p>
          ) : (
            <>
              <form method="get" className="record-form">
                <input type="hidden" name="expense" value={expense.id} />
                <div className="form-grid">
                  <label>
                    Boarding period from
                    <input
                      name="from"
                      type="date"
                      required
                      defaultValue={from}
                      max={today()}
                    />
                  </label>
                  <label>
                    Through (inclusive)
                    <input
                      name="to"
                      type="date"
                      required
                      defaultValue={to}
                      max={today()}
                    />
                  </label>
                </div>
                <button className="button secondary" type="submit">
                  Review boarding period
                </button>
              </form>
              {!valid ? (
                <p className="notice error">
                  Choose an elapsed boarding period of 1–366 days.
                </p>
              ) : basis?.data && !failed ? (
                <AllocationForm
                  key={`${expense.id}:${from}:${to}:${active?.id ?? "new"}`}
                  expense={expense.id}
                  amount={expense.amount_cents}
                  from={from}
                  to={to}
                  basis={basis.data as AllocationBasis[]}
                  request={crypto.randomUUID()}
                  savedRows={
                    active?.period_from === from && active?.period_to === to
                      ? active.expense_allocation_lines
                      : undefined
                  }
                />
              ) : null}
              {active && (
                <form
                  action={clearAllocation}
                  className="record-form separated"
                >
                  <input type="hidden" name="expense_id" value={expense.id} />
                  <label>
                    Reason for clearing
                    <input name="reason" required maxLength={2000} />
                  </label>
                  <DeleteButton
                    label="Clear active allocation"
                    confirmText="Clear this allocation? Its history will remain. The shared expense will be unallocated in horse reports until you save another split."
                  />
                </form>
              )}
            </>
          )}
          <div className="record-form separated">
            <h3>Saved allocation history (latest 10)</h3>
            {history.data?.length ? (
              history.data.map((a) => (
                <details key={a.id}>
                  <summary>
                    {a.retired_at ? "Retired" : "Active"} ·{" "}
                    {dateLabel(a.period_from)} – {dateLabel(a.period_to)} ·{" "}
                    {money(a.source_amount_cents)}
                  </summary>
                  <p>{a.reason}</p>
                  <small>
                    Saved{" "}
                    {new Date(a.created_at).toLocaleString("en-US", {
                      timeZone: "America/Chicago",
                    })}{" "}
                    Central. {a.retired_reason}
                  </small>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Horse at allocation</th>
                          <th>Board days</th>
                          <th>Training days at save</th>
                          <th>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.expense_allocation_lines.map(
                          (l: {
                            horse_id: string;
                            horse_name: string;
                            board_days: number;
                            training_days_snapshot: number;
                            amount_cents: number;
                          }) => (
                            <tr key={l.horse_id}>
                              <td>{l.horse_name}</td>
                              <td>{l.board_days}</td>
                              <td>{l.training_days_snapshot}</td>
                              <td>
                                {money(l.amount_cents)}
                                <small className="cell-secondary">
                                  <Link
                                    className="text-link"
                                    href={`/admin/attribution?expense=${expense.id}&horse=${l.horse_id}&allocation=${a.id}`}
                                  >
                                    Stay reporting / history
                                  </Link>
                                </small>
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))
            ) : (
              <p>No saved allocation yet.</p>
            )}
          </div>
        </ActionPanel>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Shared expense book</h2>
          <span className="count-badge">{list.count ?? 0} records</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date / vendor</th>
                <th>Cost</th>
                <th>Payment</th>
                <th>Allocation</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((e) => (
                <tr key={e.id}>
                  <td>
                    {dateLabel(e.expense_date)}
                    <small className="cell-secondary">
                      {e.vendor || "No vendor"}
                    </small>
                  </td>
                  <td>{money(e.amount_cents)}</td>
                  <td>
                    {e.paid_on ? `Paid ${dateLabel(e.paid_on)}` : "Unpaid"}
                  </td>
                  <td>
                    <Link
                      href={`/admin/allocations?expense=${e.id}`}
                      className="text-link"
                    >
                      {e.expense_allocations.some(
                        (a: { retired_at: string | null }) => !a.retired_at,
                      )
                        ? "Review / revise"
                        : "Allocate cost"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.data?.length && !failed && (
          <p>
            No shared expenses yet. Record barn costs in Expenses or stock
            purchases in Inventory.
          </p>
        )}
        <nav className="log-pagination" aria-label="Shared expense pages">
          {page > 1 ? (
            <Link href={`/admin/allocations?page=${page - 1}`}>Previous</Link>
          ) : (
            <span />
          )}
          <span>Page {page}</span>
          {page * 25 < (list.count ?? 0) ? (
            <Link href={`/admin/allocations?page=${page + 1}`}>Next</Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}
