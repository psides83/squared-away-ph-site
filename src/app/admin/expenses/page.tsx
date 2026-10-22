import Link from "next/link";
import { Receipt, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { PageHeading, Notice, Field, EmptyState } from "@/components/ui";
import { SubmitButton, DeleteButton } from "@/components/submit-button";
import {
  saveExpense,
  expenseStatus,
  saveCategory,
  deleteCategory,
  uploadReceipt,
  removeReceipt,
} from "./actions";

export default async function Expenses({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    edit?: string;
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
  const [expenses, categories, horses, editing] = await Promise.all([
    db
      .from("expenses")
      .select("*,inventory_movements(id)", { count: "exact" })
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range((page - 1) * 25, page * 25 - 1),
    db.from("expense_categories").select("*").order("name"),
    db.from("horses").select("id,barn_name").order("barn_name"),
    params.edit && /^[0-9a-f-]{36}$/i.test(params.edit)
      ? db
          .from("expenses")
          .select("*,inventory_movements(id)")
          .eq("id", params.edit)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const selected = editing.data;
  const receipts = selected
    ? await db
        .from("expense_receipts")
        .select("id,file_name,size_bytes")
        .eq("expense_id", selected.id)
    : { data: [], error: null };
  const failed =
    expenses.error ||
    categories.error ||
    horses.error ||
    editing.error ||
    receipts.error;
  const linked = (row: { inventory_movements: unknown }) =>
    Array.isArray(row.inventory_movements)
      ? row.inventory_movements.length > 0
      : Boolean(row.inventory_movements);
  const stockPurchase = selected && linked(selected);
  return (
    <>
      <PageHeading
        eyebrow="KNOW WHAT GOES INTO THE WORK"
        title="Expenses & receipts"
        description="Keep barn costs, horse expenses, and the paperwork in one place."
        action={{
          href: "/admin/expenses?new=1#record-form",
          label: "Add an expense",
        }}
      />
      <Notice
        error={
          failed
            ? "Expenses couldn’t load. Confirm the expense and receipt migrations have completed, then refresh."
            : params.error ||
              (params.edit && !selected ? "Expense not found." : undefined)
        }
        success={params.success}
      />
      <p className="notice">
        Buying feed, hay, or supplements for stock?{" "}
        <Link href="/admin/inventory">Record the purchase in Inventory</Link> so
        the expense and stock are saved together. Don’t enter the same purchase
        twice.
      </p>
      {!failed && (params.new === "1" || selected) && (
        <section className="panel editor-panel" id="record-form">
          <div className="panel-heading">
            <h2>
              {stockPurchase
                ? "Stock purchase"
                : selected
                  ? "Edit expense"
                  : "Record a cost"}
            </h2>
            <Link href="/admin/expenses" aria-label="Close expense form">
              <X size={20} />
            </Link>
          </div>
          {selected?.voided_at ? (
            <p className="record-form muted">
              This expense is voided and is excluded from future expense totals.
              Its documentation is retained.
            </p>
          ) : stockPurchase ? (
            <div className="record-form">
              <p>
                Stock purchase: <strong>{money(selected.amount_cents)}</strong>.
                Quantity and cost are retained with inventory history. Purchase
                cost corrections are not available yet.
              </p>
            </div>
          ) : (
            <form action={saveExpense} className="record-form">
              <input
                type="hidden"
                name="request_id"
                value={crypto.randomUUID()}
              />
              <input type="hidden" name="id" value={selected?.id ?? ""} />
              <div className="form-grid">
                <Field
                  label="Expense date"
                  name="expense_date"
                  type="date"
                  required
                  defaultValue={selected?.expense_date ?? today()}
                />
                <Field
                  label="Paid on (leave blank if unpaid)"
                  name="paid_on"
                  type="date"
                  defaultValue={selected?.paid_on}
                />
                <Field
                  label="Vendor / provider"
                  name="vendor"
                  defaultValue={selected?.vendor}
                />
                <Field
                  label="Amount ($)"
                  name="amount"
                  type="number"
                  min={0}
                  max={1000000}
                  step="0.01"
                  required
                  defaultValue={
                    selected
                      ? (selected.amount_cents / 100).toFixed(2)
                      : undefined
                  }
                />
                <label>
                  Category <span className="required">*</span>
                  <select
                    name="category_id"
                    required
                    defaultValue={selected?.category_id ?? ""}
                  >
                    <option value="" disabled>
                      Select a category
                    </option>
                    {categories.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Assign to horse
                  <select
                    name="horse_id"
                    defaultValue={selected?.horse_id ?? ""}
                  >
                    <option value="">Shared barn cost</option>
                    {horses.data?.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.barn_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="inline-checkbox">
                <input
                  name="reimbursable"
                  type="checkbox"
                  defaultChecked={selected?.reimbursable ?? false}
                />
                Charge back to customer (requires a horse)
              </label>
              <label>
                Notes
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={selected?.notes ?? ""}
                />
              </label>
              <p className="muted form-hint">
                Add flagged expenses explicitly to an invoice draft. The flag
                alone does not create a bill or record payment.
              </p>
              <SubmitButton>Save expense</SubmitButton>
            </form>
          )}
          {selected && !selected.voided_at && !selected.horse_id && (
            <p className="record-form">
              <Link
                href={`/admin/allocations?expense=${selected.id}`}
                className="text-link"
              >
                Review / allocate this shared cost
              </Link>
            </p>
          )}
          {selected && !selected.voided_at && (
            <form action={expenseStatus} className="record-form separated">
              <input type="hidden" name="id" value={selected.id} />
              <Field
                name="paid_on"
                label="Update payment date (clear to mark unpaid)"
                type="date"
                defaultValue={selected.paid_on}
              />
              <SubmitButton>Update payment status</SubmitButton>
            </form>
          )}
          {selected && (
            <div id="receipts" className="record-form separated">
              <h3>Private receipt documents</h3>
              {receipts.data?.map((file) => (
                <div className="row-actions" key={file.id}>
                  <a
                    href={`/admin/expenses/receipts/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link"
                  >
                    Download {file.file_name}
                  </a>
                  <form action={removeReceipt}>
                    <input type="hidden" name="id" value={file.id} />
                    <DeleteButton label="Remove receipt" />
                  </form>
                </div>
              ))}
              {!receipts.data?.length && (
                <p className="muted">No receipts attached yet.</p>
              )}
              <form action={uploadReceipt} className="stack">
                <input name="expense_id" value={selected.id} type="hidden" />
                <label>
                  Attach receipt (JPEG, PNG, WebP, or PDF; up to 3 MB)
                  <input
                    name="receipt"
                    type="file"
                    required
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                  />
                </label>
                <SubmitButton>Upload receipt</SubmitButton>
              </form>
            </div>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>The expense book</h2>
          <span className="count-badge">{expenses.count ?? 0} records</span>
        </div>
        {expenses.data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date / vendor</th>
                  <th>Category / horse</th>
                  <th>Cost</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.data.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {dateLabel(e.expense_date)}
                      <small className="cell-secondary">
                        {e.vendor || "Vendor not added"}
                      </small>
                    </td>
                    <td>
                      {
                        categories.data?.find((c) => c.id === e.category_id)
                          ?.name
                      }
                      <small className="cell-secondary">
                        {horses.data?.find((h) => h.id === e.horse_id)
                          ?.barn_name ?? "Shared barn"}
                        {e.reimbursable ? " · Charge-back" : ""}
                      </small>
                    </td>
                    <td>
                      {money(e.amount_cents)}
                      {linked(e) && (
                        <small className="cell-secondary">Stock purchase</small>
                      )}
                    </td>
                    <td>
                      <span className="tag">
                        {e.voided_at ? "Voided" : e.paid_on ? "Paid" : "Unpaid"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link
                          className="text-button"
                          href={`/admin/expenses?edit=${e.id}#record-form`}
                        >
                          View / receipts
                        </Link>
                        {!e.voided_at && !linked(e) && (
                          <form action={expenseStatus}>
                            <input name="id" type="hidden" value={e.id} />
                            <input name="void" type="hidden" value="yes" />
                            <input
                              name="paid_on"
                              type="hidden"
                              value={e.paid_on ?? ""}
                            />
                            <DeleteButton
                              label="Void"
                              confirmText="Void this expense? The record and receipts will be retained, and it will be excluded from expense totals."
                            />
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !failed && (
            <EmptyState
              icon={Receipt}
              title="Good records start with the first receipt."
              description="Record expenses for a horse or the barn. Feed purchases belong in Inventory."
              href="/admin/expenses?new=1#record-form"
              label="Add your first expense"
            />
          )
        )}
        <nav className="log-pagination" aria-label="Expense pages">
          {page > 1 ? (
            <Link
              className="text-link"
              href={`/admin/expenses?page=${page - 1}`}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>Page {page}</span>
          {page * 25 < (expenses.count ?? 0) ? (
            <Link
              className="text-link"
              href={`/admin/expenses?page=${page + 1}`}
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
      <details className="panel management-details">
        <summary>Manage expense categories</summary>
        <div className="category-content">
          {categories.data?.map((c) => (
            <div className="category-row" key={c.id}>
              <form action={saveCategory}>
                <input name="id" type="hidden" value={c.id} />
                <label>
                  Category name
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={c.name}
                  />
                </label>
                <SubmitButton className="text-button">Save</SubmitButton>
              </form>
              <form action={deleteCategory}>
                <input name="id" type="hidden" value={c.id} />
                <DeleteButton label="Remove" />
              </form>
            </div>
          ))}
          <form action={saveCategory}>
            <Field label="New category" name="name" required maxLength={100} />
            <SubmitButton>Add category</SubmitButton>
          </form>
        </div>
      </details>
    </>
  );
}
