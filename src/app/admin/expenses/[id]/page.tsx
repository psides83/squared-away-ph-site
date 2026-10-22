import { AppSelect } from "@/components/app-select";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { PageHeading, Notice, Field } from "@/components/ui";
import { SectionTabs } from "@/components/section-tabs";
import { ActionPanel } from "@/components/action-panel";
import { SubmitButton, DeleteButton } from "@/components/submit-button";
import { ReceiptPicker } from "@/components/receipt-picker";
import {
  ExpenseInvoiceLinks,
  type ExpenseFollowup,
} from "@/components/expense-followup";
import { expenseRecordAction, uploadReceipt, removeReceipt } from "../actions";
export default async function ExpenseRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params,
    query = await searchParams;
  const { db } = await requireAdmin();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const [expense, categories, horses, receipts, followup] = await Promise.all([
    db
      .from("expenses")
      .select("*,inventory_movements(id,product_id)")
      .eq("id", id)
      .maybeSingle(),
    db.from("expense_categories").select("id,name"),
    db.from("horses").select("id,barn_name"),
    db
      .from("expense_receipts")
      .select("id,file_name,size_bytes")
      .eq("expense_id", id)
      .order("created_at"),
    db.rpc("expense_followup", { p_expenses: [id] }),
  ]);
  if (!expense.data && !expense.error) notFound();
  const e = expense.data;
  const owners = e?.horse_id
    ? await db
        .from("horse_customers")
        .select("customer_id")
        .eq("horse_id", e.horse_id)
    : { data: [], error: null };
  const stays = e?.horse_id
    ? await db
        .from("training_stays")
        .select("id,billing_customer_id")
        .eq("horse_id", e.horse_id)
        .lte("arrival_date", e.expense_date)
        .or(`departure_date.is.null,departure_date.gte.${e.expense_date}`)
    : { data: [], error: null };
  const customerIds = [
    ...new Set([
      ...(owners.data ?? []).map((o) => o.customer_id),
      ...(stays.data ?? []).map((s) => s.billing_customer_id),
    ]),
  ];
  const [customers, drafts] = customerIds.length
    ? await Promise.all([
        db.from("customers").select("id,name").in("id", customerIds),
        db
          .from("invoice_totals")
          .select("id,customer_id,stay_id,created_at")
          .eq("status", "draft")
          .in("customer_id", customerIds)
          .order("created_at", { ascending: false })
          .limit(100),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  const eligibleDrafts = (drafts.data ?? []).filter((i) =>
    i.stay_id
      ? stays.data?.some((s) => s.id === i.stay_id)
      : owners.data?.some((o) => o.customer_id === i.customer_id),
  );
  const f = (followup.data as ExpenseFollowup[] | null)?.[0];
  const movements = e?.inventory_movements
    ? Array.isArray(e.inventory_movements)
      ? e.inventory_movements
      : [e.inventory_movements]
    : [];
  const stock = movements.length > 0;
  return (
    <>
      <Link className="text-link" href="/admin/expenses">
        Back to expenses
      </Link>
      <PageHeading
        title={e?.vendor || "Expense record"}
        description={
          e
            ? `${dateLabel(e.expense_date)} · ${money(e.amount_cents)}`
            : "Expense details, receipts, and billing follow-up."
        }
      />
      <Notice
        error={
          expense.error
            ? "Expense could not load. Please refresh."
            : query.error
        }
        success={query.success}
      />
      {e && (
        <>
          <section className="panel">
            <div className="record-form">
              <div className="row-actions">
                <span className="tag">
                  {e.voided_at ? "Voided" : e.paid_on ? "Paid" : "Unpaid"}
                </span>
                <strong>
                  {categories.data?.find((c) => c.id === e.category_id)?.name ??
                    "Category unavailable"}
                </strong>
                {e.horse_id ? (
                  <Link
                    className="text-link"
                    href={`/admin/horses/${e.horse_id}`}
                  >
                    {horses.data?.find((h) => h.id === e.horse_id)?.barn_name ??
                      "Horse record"}
                  </Link>
                ) : (
                  <span>Shared barn cost</span>
                )}
              </div>
              {!e.voided_at && (
                <div className="row-actions">
                  <ActionPanel
                    id="expense-payment"
                    label={
                      e.paid_on
                        ? "Update payment status"
                        : "Record expense payment"
                    }
                  >
                    <form
                      action={expenseRecordAction.bind(null, "payment")}
                      className="record-form"
                    >
                      <input name="expense_id" type="hidden" value={id} />
                      <p>
                        Record when you paid this vendor. This is separate from
                        customer invoice payments.
                      </p>
                      <Field
                        name="paid_on"
                        type="date"
                        label="Paid on (clear to mark unpaid)"
                        defaultValue={e.paid_on ?? today()}
                      />
                      <SubmitButton>Save payment status</SubmitButton>
                    </form>
                  </ActionPanel>
                  <Link
                    className="text-link"
                    href={`/admin/expenses?edit=${id}#record-form`}
                  >
                    Edit expense
                  </Link>
                </div>
              )}
            </div>
          </section>
          <SectionTabs
            id="expense"
            label="Expense record sections"
            sections={[
              {
                id: "details",
                label: "Details",
                content: (
                  <section className="panel">
                    <div className="record-form stack">
                      <h2>Expense details</h2>
                      <p>
                        Original cost: {money(e.amount_cents)} ·{" "}
                        {e.paid_on
                          ? `Paid ${dateLabel(e.paid_on)}`
                          : "Vendor payment not recorded"}
                      </p>
                      <p>
                        {e.reimbursable
                          ? "Marked for customer charge-back"
                          : "Not marked for full customer charge-back"}
                      </p>
                      {stock && (
                        <p className="notice">
                          Stock purchase. Quantity and purchase cost are
                          retained with inventory history; purchase-cost
                          corrections are not available yet.
                        </p>
                      )}
                      <p className="log-notes">
                        {e.notes || "No private notes added."}
                      </p>
                      {!e.horse_id && !e.voided_at && (
                        <Link
                          className="text-link"
                          href={`/admin/allocations?expense=${id}`}
                        >
                          Review shared-cost allocation
                        </Link>
                      )}
                      <Link className="text-link" href="/admin/attribution">
                        Review income & cost assignments
                      </Link>
                      {stock &&
                        movements.map(
                          (m: { id: string; product_id: string }) => (
                            <Link
                              className="text-link"
                              key={m.id}
                              href={`/admin/inventory?product=${m.product_id}#inventory-history`}
                            >
                              Open stock history
                            </Link>
                          ),
                        )}
                      {!stock && !e.voided_at && (
                        <details>
                          <summary>Manage expense record</summary>
                          <form action={expenseRecordAction.bind(null, "void")}>
                            <input name="expense_id" type="hidden" value={id} />
                            <input
                              name="paid_on"
                              type="hidden"
                              value={e.paid_on ?? ""}
                            />
                            <DeleteButton
                              label="Void expense"
                              confirmText="Void this expense? Its record and receipts will remain, and linked billing may prevent this change."
                            />
                          </form>
                        </details>
                      )}
                    </div>
                  </section>
                ),
              },
              {
                id: "receipts",
                label: `Receipts (${receipts.data?.length ?? 0})`,
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Private receipts</h2>
                    </div>
                    <div className="record-form stack">
                      {receipts.error ? (
                        <p className="notice error">Receipts could not load.</p>
                      ) : receipts.data?.length ? (
                        receipts.data.map((r) => (
                          <div className="row-actions" key={r.id}>
                            <a
                              className="text-link"
                              href={`/admin/expenses/receipts/${r.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download {r.file_name}
                            </a>
                            <form action={removeReceipt}>
                              <input name="id" type="hidden" value={r.id} />
                              <input
                                name="record_context"
                                type="hidden"
                                value="yes"
                              />
                              <DeleteButton label="Remove receipt" />
                            </form>
                          </div>
                        ))
                      ) : (
                        <p>No receipt attached yet.</p>
                      )}
                      <ActionPanel id="attach-receipt" label="Attach receipt">
                        <form action={uploadReceipt} className="record-form">
                          <input name="expense_id" type="hidden" value={id} />
                          <input
                            name="record_context"
                            type="hidden"
                            value="yes"
                          />
                          <ReceiptPicker required />
                          <SubmitButton>Attach receipt</SubmitButton>
                        </form>
                      </ActionPanel>
                    </div>
                  </section>
                ),
              },
              {
                id: "billing",
                label: "Customer billing",
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Invoice follow-up</h2>
                    </div>
                    <div className="record-form stack">
                      <ExpenseInvoiceLinks
                        data={followup.error ? undefined : f}
                      />
                      {!e.voided_at &&
                        e.reimbursable &&
                        e.horse_id &&
                        !followup.error &&
                        f &&
                        !f.invoices.length && (
                          <>
                            <ActionPanel
                              id="bill-expense"
                              label="Add to a draft invoice"
                            >
                              <form
                                action={expenseRecordAction.bind(
                                  null,
                                  "chargeback",
                                )}
                                className="record-form"
                              >
                                <input
                                  name="expense_id"
                                  type="hidden"
                                  value={id}
                                />
                                <p>
                                  Choose the responsible customer’s draft.
                                  Already-billed costs and conflicting boarding
                                  portions cannot be charged again.
                                </p>
                                {drafts.error ||
                                owners.error ||
                                stays.error ||
                                customers.error ? (
                                  <p className="notice error">
                                    Eligible invoices could not load.
                                  </p>
                                ) : eligibleDrafts.length ? (
                                  <>
                                    <label>
                                      Draft invoice
                                      <AppSelect
                                        name="invoice_id"
                                        required
                                        defaultValue=""
                                      >
                                        <option value="" disabled>
                                          Choose a matching draft
                                        </option>
                                        {eligibleDrafts.map((i) => (
                                          <option key={i.id} value={i.id}>
                                            {customers.data?.find(
                                              (c) => c.id === i.customer_id,
                                            )?.name ?? "Customer"}{" "}
                                            · Created{" "}
                                            {dateLabel(
                                              i.created_at.slice(0, 10),
                                            )}
                                            {i.stay_id
                                              ? " · Training stay"
                                              : " · Manual invoice"}
                                          </option>
                                        ))}
                                      </AppSelect>
                                    </label>
                                    <Field
                                      name="markup"
                                      label="Handling fee ($)"
                                      type="number"
                                      min={0}
                                      max={1000000}
                                      step="0.01"
                                      required
                                      defaultValue="0"
                                    />
                                    <SubmitButton>
                                      Add expense charge-back
                                    </SubmitButton>
                                    <p className="muted">
                                      Showing matches among the latest 100
                                      candidate drafts.
                                    </p>
                                  </>
                                ) : (
                                  <p>
                                    No matching draft invoices. Create one
                                    below, then return here to add this expense.
                                  </p>
                                )}
                              </form>
                            </ActionPanel>
                            <h3>Create a customer draft</h3>
                            {customers.data?.map((c) => {
                              const stay = stays.data?.find(
                                (s) => s.billing_customer_id === c.id,
                              );
                              return (
                                <Link
                                  className="text-link"
                                  key={c.id}
                                  href={`/admin/invoices?new=1&customer=${c.id}${stay ? `&stay=${stay.id}` : ""}#invoice-form`}
                                >
                                  New invoice for {c.name}
                                  {stay ? " · matching training stay" : ""}
                                </Link>
                              );
                            })}
                            <p className="muted">
                              Choose responsibility explicitly, especially after
                              a sale or with co-owners. A new draft does not add
                              this expense until you choose Add to a draft
                              invoice.
                            </p>
                          </>
                        )}
                      {!e.voided_at &&
                        e.reimbursable &&
                        Number(f?.invoices.length) > 0 && (
                          <p className="muted">
                            All or part of this cost is already reserved or
                            billed. Review the linked invoices before adding
                            another full charge-back.
                          </p>
                        )}
                      {!e.voided_at && !e.reimbursable && (
                        <p className="muted">
                          For a full charge-back, edit the expense and mark it
                          for reimbursement. Actual-cost boarding portions are
                          managed through reviewed stay costs.
                        </p>
                      )}
                    </div>
                  </section>
                ),
              },
            ]}
          />
        </>
      )}
    </>
  );
}
