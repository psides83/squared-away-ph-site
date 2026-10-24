"use client";
import Link from "next/link";
import { useActionState, useState, useRef, startTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { recordBulkExpenses } from "@/app/admin/expenses/bulk-actions";
import { Field, Notice } from "@/components/ui";
import { AppSelect } from "@/components/app-select";
import { ConfirmButton } from "@/components/confirm-button";
import { money } from "@/lib/format";
type Draft = {
  id: string;
  expense_date: string;
  vendor: string;
  category_id: string;
};
export function BulkExpenseForm({
  date,
  request,
  categories,
  horses,
}: {
  date: string;
  request: string;
  categories: { id: string; name: string }[];
  horses: { id: string; barn_name: string }[];
}) {
  const [requestId] = useState(request);
  const [rows, setRows] = useState<Draft[]>([]);
  const [total, setTotal] = useState(0);
  const defaults = useRef<HTMLFormElement>(null);
  const entryForm = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(recordBulkExpenses, {});
  const recompute = () => {
    if (!entryForm.current) return;
    const data = new FormData(entryForm.current);
    let amount = 0;
    for (const key of data.getAll("row_id")) {
      const text = String(data.get(`row.${key}.amount`) ?? "");
      if (/^\d+(\.\d{1,2})?$/.test(text))
        amount += Math.round(Number(text) * 100);
    }
    setTotal(amount);
  };
  const addRow = () => {
    if (rows.length >= 20) return;
    const data = defaults.current ? new FormData(defaults.current) : null;
    setRows([
      ...rows,
      {
        id: crypto.randomUUID(),
        expense_date: String(data?.get("expense_date") ?? date),
        vendor: String(data?.get("vendor") ?? ""),
        category_id: String(data?.get("category_id") ?? ""),
      },
    ]);
  };
  if (state.ids)
    return (
      <section className="panel">
        <div className="record-form stack">
          <Notice
            success={`${state.ids.length} expenses saved. Stock and customer invoices were not changed.`}
          />
          <p>
            Open a record to attach receipts, review payment status or arrange
            customer charge-backs.
          </p>
          <div className="row-actions">
            {state.ids.map((id, index) => (
              <Link
                className="button secondary"
                href={`/admin/expenses/${id}#expense-receipts`}
                key={id}
              >
                Expense {index + 1}
              </Link>
            ))}
          </div>
          <div className="row-actions">
            <Link className="button" href="/admin/expenses">
              View expenses
            </Link>
            <button
              className="button secondary"
              type="button"
              onClick={() => window.location.reload()}
            >
              Start another batch
            </button>
          </div>
        </div>
      </section>
    );
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Defaults for new entries</h2>
        </div>
        <form
          ref={defaults}
          className="record-form"
          onSubmit={(e) => e.preventDefault()}
        >
          <fieldset disabled={pending} className="stack">
            <div className="form-grid">
              <Field
                label="Expense date"
                name="expense_date"
                type="date"
                defaultValue={date}
              />
              <Field label="Vendor" name="vendor" maxLength={200} />
              <label className="field">
                Category
                <AppSelect name="category_id" defaultValue="">
                  <option value="">Choose for each entry</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </AppSelect>
              </label>
            </div>
            <p className="muted">
              These values are copied when you add an entry. Existing entries
              stay unchanged. New expenses are unpaid until you enter a paid
              date.
            </p>
          </fieldset>
        </form>
      </section>
      <form
        action={action}
        ref={entryForm}
        className="stack"
        onChange={recompute}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => action(data));
        }}
      >
        <Notice error={state.error} />
        <input type="hidden" name="request" value={requestId} />
        <fieldset className="stack" disabled={pending}>
          {!rows.length && (
            <p className="notice">
              Set any shared defaults above, then add your first expense.
            </p>
          )}
          {rows.map((row, index) => {
            const name = (field: string) => `row.${row.id}.${field}`;
            return (
              <section className="panel" key={row.id}>
                <div className="panel-heading">
                  <h2>Expense {index + 1}</h2>
                  <button
                    className="button secondary"
                    type="button"
                    aria-label={`Remove expense ${index + 1}`}
                    onClick={() => {
                      setRows(rows.filter((r) => r.id !== row.id));
                      const input = entryForm.current?.elements.namedItem(
                        name("amount"),
                      ) as HTMLInputElement | null;
                      if (input) {
                        const current = Number(input.value);
                        if (Number.isFinite(current))
                          setTotal(
                            Math.max(0, total - Math.round(current * 100)),
                          );
                      }
                    }}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                    Remove
                  </button>
                </div>
                <div className="record-form stack">
                  <input type="hidden" name="row_id" value={row.id} />
                  <div className="form-grid">
                    <Field
                      label="Date"
                      name={name("expense_date")}
                      type="date"
                      defaultValue={row.expense_date}
                      required
                    />
                    <Field
                      label="Vendor"
                      name={name("vendor")}
                      defaultValue={row.vendor}
                      maxLength={200}
                    />
                    <label className="field">
                      Category
                      <AppSelect
                        name={name("category_id")}
                        defaultValue={row.category_id}
                        required
                      >
                        <option value="" disabled>
                          Choose category
                        </option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <Field
                      label="Amount ($)"
                      name={name("amount")}
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      required
                    />
                    <label className="field">
                      Horse / barn
                      <AppSelect name={name("horse_id")} defaultValue="">
                        <option value="">Shared barn cost</option>
                        {horses.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.barn_name}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                  </div>
                  <details>
                    <summary>Payment, charge-back & notes</summary>
                    <div className="stack">
                      <Field
                        label="Paid on (blank means unpaid)"
                        name={name("paid_on")}
                        type="date"
                      />
                      <label className="inline-checkbox">
                        <input type="checkbox" name={name("reimbursable")} />
                        Mark for customer charge-back (requires a horse)
                      </label>
                      <Field
                        label="Notes"
                        name={name("notes")}
                        maxLength={5000}
                      />
                    </div>
                  </details>
                </div>
              </section>
            );
          })}
          <div className="row-actions">
            <button
              className="button secondary"
              type="button"
              onClick={addRow}
              disabled={rows.length >= 20}
            >
              <Plus size={18} aria-hidden="true" />
              Add expense
            </button>
            <span className="muted">{rows.length} / 20 entries</span>
          </div>
          {rows.length > 0 && (
            <section className="panel">
              <div className="record-form stack">
                <p aria-live="polite">
                  <strong>{money(total)}</strong> total across {rows.length}{" "}
                  {rows.length === 1 ? "expense" : "expenses"}
                </p>
                <p className="muted">
                  Save records only. This does not send payments, create
                  invoices or add inventory.
                </p>
                <div className="form-actions">
                  <ConfirmButton
                    message={`Save ${rows.length} expense ${rows.length === 1 ? "record" : "records"} totalling ${money(total)}? Only entries with a paid date will count as cash spent.`}
                  >
                    Review & save expenses
                  </ConfirmButton>
                </div>
              </div>
            </section>
          )}
        </fieldset>
      </form>
    </>
  );
}
