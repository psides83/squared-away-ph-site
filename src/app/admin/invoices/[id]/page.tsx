import { phoneDisplay } from "@/lib/input-format";
import { CustomerInvoiceLines } from "@/components/customer-invoice-lines";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel, money } from "@/lib/format";
import {
  invoiceStatus,
  paymentMethods,
  paymentMethodLabels,
  securePaymentLink,
} from "@/lib/invoices";
import { serviceLabels } from "@/lib/billing-days";
import { PageHeading, Notice, Field } from "@/components/ui";
import { SubmitButton, DeleteButton } from "@/components/submit-button";
import {
  InvoiceConfirmButton,
  PrintInvoice,
} from "@/components/invoice-buttons";
import {
  InvoiceServices,
  InvoiceServiceDetail,
} from "@/components/invoice-services";
import { invoiceAction } from "../actions";

export default async function Invoice({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db } = await requireAdmin();
  const result = await db
    .from("invoice_totals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (result.error)
    return (
      <p className="notice error">
        Invoice couldn’t load. Confirm the latest billing migration has
        completed.
      </p>
    );
  if (!result.data) notFound();
  const invoice = result.data;
  const [
    lines,
    payments,
    adjustments,
    customer,
    stay,
    expenses,
    links,
    presentation,
  ] = await Promise.all([
    db
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", id)
      .order("created_at"),
    db
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", id)
      .order("created_at"),
    db
      .from("invoice_adjustments")
      .select("*")
      .eq("invoice_id", id)
      .order("created_at"),
    db
      .from("customers")
      .select("id,name,email,phone")
      .eq("id", invoice.customer_id)
      .single(),
    invoice.stay_id
      ? db.from("training_stays").select("*").eq("id", invoice.stay_id).single()
      : Promise.resolve({ data: null, error: null }),
    invoice.status === "draft"
      ? db
          .from("expenses")
          .select(
            "id,horse_id,vendor,amount_cents,expense_date,invoice_expense_claims(line_id)",
          )
          .eq("reimbursable", true)
          .is("voided_at", null)
          .order("expense_date", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    invoice.status === "draft"
      ? db
          .from("horse_customers")
          .select("horse_id")
          .eq("customer_id", invoice.customer_id)
      : Promise.resolve({ data: [], error: null }),
    db.rpc("admin_invoice_presentation", { p_invoice: id }),
  ]);
  const services =
    invoice.status === "draft" && invoice.stay_id
      ? await db.rpc("invoice_service_options", { p_invoice: id })
      : { data: null, error: null };
  const failed = [
    lines,
    payments,
    adjustments,
    customer,
    stay,
    expenses,
    links,
    services,
    presentation,
  ].some((r) => r.error);
  const date = today();
  const draft = invoice.status === "draft";
  const issued = invoice.status === "issued";
  const snapshot = invoice.customer_snapshot ?? customer.data;
  const business = invoice.business_snapshot;
  const title = invoice.invoice_number
    ? `SAPH-${invoice.invoice_number}`
    : "Draft invoice";
  const candidates = (expenses.data ?? []).filter(
    (e) =>
      !(Array.isArray(e.invoice_expense_claims)
        ? e.invoice_expense_claims.length > 0
        : Boolean(e.invoice_expense_claims)) &&
      (stay.data
        ? e.horse_id === stay.data.horse_id
        : links.data?.some((link) => link.horse_id === e.horse_id)),
  );
  const invoiceId = <input name="invoice_id" type="hidden" value={id} />;
  return (
    <>
      <div className="no-print">
        <PageHeading
          eyebrow="THE BILLING BOOK"
          title={title}
          description={`${snapshot?.name ?? "Customer"} · ${invoiceStatus(invoice, date)}`}
        />
        <Notice
          error={
            failed
              ? "Some invoice details couldn’t load. Refresh before making changes."
              : query.error
          }
          success={query.success}
        />
        <div className="row-actions invoice-toolbar">
          <Link className="text-link" href="/admin/invoices">
            All invoices
          </Link>
          {!invoice.stay_id && (
            <Link
              className="text-link"
              href={`/admin/attribution?invoice=${id}`}
            >
              Income reporting assignment
            </Link>
          )}
          <PrintInvoice />
          <span className="muted">
            Customer format:{" "}
            {presentation.data?.style === "combined_services"
              ? "Combined training, feed & board"
              : "Itemized"}
          </span>
          {draft && (
            <Link
              className="text-link"
              href={`/admin/customers?edit=${invoice.customer_id}#record-form`}
            >
              Change customer invoice format
            </Link>
          )}
        </div>
      </div>
      <section className="panel invoice-document">
        <div className="invoice-doc-header">
          <div>
            <p className="eyebrow">
              {business?.name ?? "SQUARED AWAY PERFORMANCE HORSES"}
            </p>
            <h1>{title}</h1>
            <p className="muted">
              {invoiceStatus(invoice, date)}
              {draft ? " · Not a finalized bill" : ""}
            </p>
            {business?.phone && <p>{phoneDisplay(business.phone)}</p>}
            {business?.email && <p>{business.email}</p>}
          </div>
          <div>
            <p>Invoice date: {dateLabel(invoice.issue_date)}</p>
            <p>Due: {dateLabel(invoice.due_date)}</p>
            {invoice.period_from && (
              <p>
                Period: {dateLabel(invoice.period_from)}–
                {dateLabel(invoice.period_to)}
              </p>
            )}
          </div>
        </div>
        <div className="invoice-party">
          <p className="eyebrow">BILL TO</p>
          <h2>{snapshot?.name}</h2>
          {snapshot?.email && <p>{snapshot.email}</p>}
          {snapshot?.phone && <p>{phoneDisplay(snapshot.phone)}</p>}
        </div>
        <CustomerInvoiceLines lines={presentation.data?.lines ?? []} />
        <ActionPanel id="invoice-breakdown" label="Review detailed charges">
          <p className="record-form muted">
            Your internal breakdown. The customer’s invoice uses the format
            above; grouping never changes these charges, source records, or
            totals.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Amount</th>
                  {draft && <th className="no-print">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {lines.data?.map((line) => (
                  <tr key={line.id}>
                    <td>
                      {line.description}
                      {line.kind === "training" && line.source_snapshot && (
                        <small className="cell-secondary">
                          {money(line.source_snapshot.monthly_rate_cents)}/month
                          × {line.source_snapshot.billable_days}/
                          {line.source_snapshot.calendar_days}; rounded once to
                          cents.
                        </small>
                      )}
                      {line.kind === "service" && line.source_snapshot && (
                        <InvoiceServiceDetail snapshot={line.source_snapshot} />
                      )}
                      {line.kind === "expense" && line.source_snapshot && (
                        <small className="cell-secondary">
                          Original cost{" "}
                          {money(line.source_snapshot.original_cost_cents)} +
                          handling fee{" "}
                          {money(line.source_snapshot.handling_fee_cents)}
                        </small>
                      )}
                    </td>
                    <td>{money(line.amount_cents)}</td>
                    {draft && (
                      <td className="no-print">
                        <form action={invoiceAction.bind(null, "remove")}>
                          {invoiceId}
                          <input name="line_id" type="hidden" value={line.id} />
                          <DeleteButton
                            label="Remove"
                            confirmText="Remove this draft line? Any linked expense, feeding records, or service/calendar days will become available for billing again."
                          />
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ActionPanel>
        {!lines.data?.length && (
          <p className="record-form muted">No line items yet.</p>
        )}
        <div className="invoice-totals">
          <p>
            <span>{draft ? "Draft lines" : "Original invoice"}</span>
            <strong>{money(Number(invoice.base_cents))}</strong>
          </p>
          {Number(invoice.adjustment_cents) !== 0 && (
            <p>
              <span>Adjustments</span>
              <strong>{money(Number(invoice.adjustment_cents))}</strong>
            </p>
          )}
          <p>
            <span>Current total</span>
            <strong>{money(Number(invoice.total_cents))}</strong>
          </p>
          <p>
            <span>Recorded payments</span>
            <strong>{money(Number(invoice.paid_cents))}</strong>
          </p>
          <p className="invoice-balance">
            <span>{issued ? "Balance due" : "Remaining (not receivable)"}</span>
            <strong>{money(Number(invoice.balance_cents))}</strong>
          </p>
        </div>
        {invoice.notes && (
          <div className="invoice-notes">
            <h3>Notes</h3>
            <p>{invoice.notes}</p>
          </div>
        )}
        {business && (
          <div className="invoice-notes">
            <h3>Payment instructions</h3>
            {business.payment_instructions && (
              <p>{business.payment_instructions}</p>
            )}
            {business.apple_cash_instructions && (
              <p>Apple Cash: {business.apple_cash_instructions}</p>
            )}
            <div className="row-actions">
              {securePaymentLink(business.venmo_url) && (
                <a
                  className="text-link"
                  href={securePaymentLink(business.venmo_url)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Venmo
                </a>
              )}
              {securePaymentLink(business.paypal_url) && (
                <a
                  className="text-link"
                  href={securePaymentLink(business.paypal_url)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  PayPal
                </a>
              )}
            </div>
            <p className="muted form-hint">
              Using a payment link does not confirm receipt. Payments are
              recorded separately after they are received.
            </p>
          </div>
        )}
        {invoice.status === "void" && (
          <p className="notice error invoice-void">
            Voided: {invoice.void_reason}
          </p>
        )}
        {!!adjustments.data?.length && (
          <div className="invoice-notes">
            <h3>Adjustment history</h3>
            {adjustments.data.map((a) => (
              <p key={a.id}>
                {dateLabel(a.adjustment_date)} · {a.description} ·{" "}
                {money(a.amount_cents)}
              </p>
            ))}
          </div>
        )}
        {!!payments.data?.length && (
          <div className="invoice-notes">
            <h3>Payment history</h3>
            {payments.data.map((p) => (
              <p key={p.id}>
                {dateLabel(p.paid_on)} · {paymentMethodLabels[p.method]} ·{" "}
                {money(p.amount_cents)}
                {p.reference ? ` · ${p.reference}` : ""}
                {p.reversed_at ? ` · Reversed: ${p.reversal_reason}` : ""}
              </p>
            ))}
          </div>
        )}
      </section>
      {!failed && (
        <div className="no-print">
          {draft && (
            <>
              <ActionPanel id="draft-details" label="Edit draft details">
                <div className="panel-heading">
                  <h2>Review draft details</h2>
                </div>
                <form
                  action={invoiceAction.bind(null, "header")}
                  className="record-form"
                >
                  {invoiceId}
                  <div className="form-grid">
                    <Field
                      name="issue_date"
                      label="Invoice date"
                      type="date"
                      required
                      defaultValue={invoice.issue_date}
                    />
                    <Field
                      name="due_date"
                      label="Payment due date"
                      type="date"
                      required
                      defaultValue={invoice.due_date}
                    />
                  </div>
                  <label>
                    Customer-facing notes
                    <textarea
                      name="notes"
                      rows={3}
                      maxLength={5000}
                      defaultValue={invoice.notes ?? ""}
                    />
                  </label>
                  <p className="muted form-hint">
                    Customer, stay, and period are fixed for this draft. If
                    those are wrong, void it and create a new draft.
                  </p>
                  <SubmitButton>Save draft details</SubmitButton>
                </form>
              </ActionPanel>
              <ActionPanel id="invoice-line" label="Add an invoice line">
                <div className="panel-heading">
                  <h2>Add a reviewed line</h2>
                </div>
                <form
                  action={invoiceAction.bind(null, "line")}
                  className="record-form"
                >
                  {invoiceId}
                  <input
                    name="request_id"
                    type="hidden"
                    value={crypto.randomUUID()}
                  />
                  <Field
                    name="description"
                    label="Description"
                    required
                    maxLength={500}
                  />
                  <label>
                    Charge category
                    <select name="billing_category" defaultValue="other">
                      <option value="other">Other — keep separate</option>
                      <option value="training">Training</option>
                      <option value="feed">Feed</option>
                      <option value="boarding">Board</option>
                    </select>
                  </label>
                  <p className="muted">
                    Choose Training, Feed, or Board to include this manual line
                    in the customer’s combined service total. Other charges stay
                    separate.
                  </p>
                  <div className="form-grid">
                    <label>
                      Line type
                      <select name="direction">
                        <option value="charge">Charge</option>
                        <option value="credit">Credit</option>
                      </select>
                    </label>
                    <Field
                      name="amount"
                      label="Amount ($)"
                      type="number"
                      min={0}
                      max={1000000}
                      step="0.01"
                      required
                    />
                  </div>
                  <p className="muted form-hint">
                    Manual lines are intentional overrides and are not
                    automatically checked against previously billed calendar
                    days or expenses. Use the source-linked tools below whenever
                    applicable.
                  </p>
                  <SubmitButton>Add draft line</SubmitButton>
                </form>
              </ActionPanel>
              {stay.data && (
                <ActionPanel
                  id="generate-services"
                  label="Generate training and service charges"
                >
                  <div className="panel-heading">
                    <h2>Training and service agreements</h2>
                    <Link
                      href={`/admin/calendar?stay=${stay.data.id}`}
                      className="text-link"
                    >
                      Review billing calendar
                    </Link>
                  </div>
                  <div className="record-form">
                    <p>
                      Training rate: {money(stay.data.monthly_rate_cents)}
                      /month. Proration:{" "}
                      {stay.data.proration.replaceAll("_", " ")}.
                    </p>
                    <p>
                      Feed: {serviceLabels[stay.data.feed_billing]}
                      {stay.data.feed_monthly_cents !== null
                        ? ` · ${money(stay.data.feed_monthly_cents)}/month`
                        : ""}
                      .
                    </p>
                    <p>
                      Boarding: {serviceLabels[stay.data.boarding_billing]}
                      {stay.data.boarding_monthly_cents !== null
                        ? ` · ${money(stay.data.boarding_monthly_cents)}/month`
                        : ""}
                      .
                    </p>
                    <p className="notice">
                      Training charges use worked/rest dates. Separately billed
                      monthly feed and boarding use every physical boarding day,
                      including non-training days. “Not recorded” agreements
                      should be resolved before finalizing.
                    </p>
                    <form action={invoiceAction.bind(null, "training")}>
                      {invoiceId}
                      <SubmitButton>
                        Generate calendar-prorated training
                      </SubmitButton>
                    </form>
                    <p className="muted form-hint">
                      Requires one elapsed calendar-month period and every
                      eligible stay day classified. Only worked/rest days are
                      charged. Already reserved days cannot be billed again.
                    </p>
                    <InvoiceServices
                      invoice={id}
                      stay={stay.data}
                      options={services.data}
                    />
                  </div>
                </ActionPanel>
              )}
              <ActionPanel id="charge-back" label="Add an expense charge-back">
                <div className="panel-heading">
                  <h2>Add an expense charge-back</h2>
                </div>
                <form
                  action={invoiceAction.bind(null, "expense")}
                  className="record-form"
                >
                  {invoiceId}
                  <label>
                    Unbilled expense (latest 100 candidates)
                    <select name="expense_id" required defaultValue="">
                      <option value="" disabled>
                        Select an expense
                      </option>
                      {candidates.map((e) => (
                        <option key={e.id} value={e.id}>
                          {dateLabel(e.expense_date)} · {e.vendor ?? "Provider"}{" "}
                          · {money(e.amount_cents)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field
                    name="markup"
                    label="Explicit handling fee ($; 0 = at cost)"
                    type="number"
                    min={0}
                    max={1000000}
                    step="0.01"
                    required
                    defaultValue="0.00"
                  />
                  <p className="muted form-hint">
                    The expense must be flagged for charge-back and belong to
                    the customer’s horse or this historical stay. Its source
                    cost is preserved; adding it does not create a second
                    expense.
                  </p>
                  <SubmitButton>Add charge-back</SubmitButton>
                </form>
              </ActionPanel>
              <section className="panel management-details">
                <div className="record-form">
                  <h2>Ready to finalize?</h2>
                  <p>
                    Review every line and the due date. Finalizing assigns an
                    invoice number and snapshots customer, business, and payment
                    details. It does not send the invoice or collect payment.
                  </p>
                  <form action={invoiceAction.bind(null, "finalize")}>
                    {invoiceId}
                    <InvoiceConfirmButton prompt="Finalize this invoice? Original lines and billing details will be preserved. Later corrections require adjustments or voiding.">
                      Finalize invoice
                    </InvoiceConfirmButton>
                  </form>
                </div>
              </section>
            </>
          )}
          {issued && (
            <>
              {Number(invoice.balance_cents) > 0 ? (
                <ActionPanel id="record-payment" label="Record payment">
                  <div className="panel-heading">
                    <h2>Record a received payment</h2>
                  </div>
                  <form
                    action={invoiceAction.bind(null, "payment")}
                    className="record-form"
                  >
                    {invoiceId}
                    <input
                      name="request_id"
                      type="hidden"
                      value={crypto.randomUUID()}
                    />
                    <div className="form-grid">
                      <Field
                        name="amount"
                        label="Amount received ($)"
                        type="number"
                        min={0.01}
                        max={Math.min(
                          1000000,
                          Number(invoice.balance_cents) / 100,
                        )}
                        step="0.01"
                        required
                      />
                      <Field
                        name="paid_on"
                        label="Actual payment date"
                        type="date"
                        required
                        defaultValue={date}
                        max={date}
                      />
                      <label>
                        Method
                        <select name="method">
                          {paymentMethods.map((method) => (
                            <option key={method} value={method}>
                              {paymentMethodLabels[method]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field
                        name="reference"
                        label="Reference / check number"
                        maxLength={200}
                      />
                    </div>
                    <label>
                      Private payment notes
                      <textarea name="notes" rows={3} maxLength={2000} />
                    </label>
                    <p className="muted form-hint">
                      Record only money actually received. Partial payments are
                      supported; overpayments are not. This does not initiate a
                      financial transaction.
                    </p>
                    <SubmitButton>Record received payment</SubmitButton>
                  </form>
                </ActionPanel>
              ) : (
                <p className="notice management-details">
                  This invoice has no remaining balance.
                </p>
              )}
              <details className="panel management-details">
                <summary>Add a charge or credit adjustment</summary>
                <form
                  action={invoiceAction.bind(null, "adjust")}
                  className="record-form"
                >
                  {invoiceId}
                  <input
                    name="request_id"
                    type="hidden"
                    value={crypto.randomUUID()}
                  />
                  <div className="form-grid">
                    <label>
                      Type
                      <select name="direction">
                        <option value="credit">Credit / reduce bill</option>
                        <option value="charge">Additional charge</option>
                      </select>
                    </label>
                    <Field
                      name="amount"
                      label="Adjustment amount ($)"
                      type="number"
                      min={0.01}
                      max={1000000}
                      step="0.01"
                      required
                    />
                    <Field
                      name="adjustment_date"
                      label="Adjustment date"
                      type="date"
                      required
                      defaultValue={date}
                      max={date}
                    />
                    <Field
                      name="description"
                      label="Reason / description"
                      required
                      maxLength={500}
                    />
                  </div>
                  <p className="muted form-hint">
                    Adjustments preserve the original invoice. To correct an
                    adjustment, add an explicit offsetting entry. Credits cannot
                    reduce the bill below recorded payments.
                  </p>
                  <SubmitButton>Record adjustment</SubmitButton>
                </form>
              </details>
              {payments.data?.some((p) => !p.reversed_at) && (
                <details className="panel management-details">
                  <summary>Correct a recorded payment</summary>
                  <p className="record-form muted">
                    Reverse an incorrectly recorded payment with a reason. This
                    corrects the record only; it does not refund or transfer
                    money.
                  </p>
                  {payments.data
                    .filter((p) => !p.reversed_at)
                    .map((p) => (
                      <form
                        key={p.id}
                        action={invoiceAction.bind(null, "reverse")}
                        className="record-form separated"
                      >
                        {invoiceId}
                        <input name="payment_id" type="hidden" value={p.id} />
                        <p>
                          {dateLabel(p.paid_on)} · {money(p.amount_cents)} ·{" "}
                          {paymentMethodLabels[p.method]}
                        </p>
                        <Field
                          name="reason"
                          label="Reversal reason"
                          required
                          maxLength={2000}
                        />
                        <InvoiceConfirmButton prompt="Reverse this recorded payment? The balance will reopen. No money will be refunded.">
                          Reverse payment record
                        </InvoiceConfirmButton>
                      </form>
                    ))}
                </details>
              )}
            </>
          )}
          {invoice.status !== "void" && (
            <details className="panel management-details">
              <summary>Void this invoice</summary>
              <form
                action={invoiceAction.bind(null, "void")}
                className="record-form"
              >
                {invoiceId}
                <Field
                  name="reason"
                  label="Void reason"
                  required
                  maxLength={2000}
                />
                <p className="muted form-hint">
                  Recorded payments must be reversed first. Voiding retains the
                  bill and releases linked expenses/days for rebilling. It does
                  not refund money.
                </p>
                <InvoiceConfirmButton prompt="Void this invoice and release its linked source charges? Its history will remain visible.">
                  Void invoice
                </InvoiceConfirmButton>
              </form>
            </details>
          )}
        </div>
      )}
    </>
  );
}
