"use client";
import { useActionState, useState, startTransition } from "react";
import { customerCreditAction } from "@/app/admin/customers/credit-actions";
import { Field, Notice } from "@/components/ui";
import { AppSelect } from "@/components/app-select";
import { ConfirmButton } from "@/components/confirm-button";
import { money, dateLabel } from "@/lib/format";
import { paymentMethods, paymentMethodLabels } from "@/lib/invoices";
export type CreditChoices = {
  payments: {
    id: string;
    invoice_number: number;
    paid_on: string;
    available_cents: number;
  }[];
  available: {
    id: string;
    credit_on: string;
    reason: string;
    available_cents: number;
  }[];
  invoices: {
    id: string;
    invoice_number: number;
    balance_cents: number;
    issue_date: string;
  }[];
};
export function CustomerCreditForm({
  customerId,
  date,
  operation,
  choices,
  recordId,
}: {
  customerId: string;
  date: string;
  operation: "record" | "apply" | "reverse-credit" | "reverse-application";
  choices?: CreditChoices;
  recordId?: string;
}) {
  const [request] = useState(() => crypto.randomUUID()),
    [source, setSource] = useState("advance"),
    [credit, setCredit] = useState(""),
    [invoice, setInvoice] = useState("");
  const [state, action, pending] = useActionState(customerCreditAction, {});
  const correction = operation.startsWith("reverse"),
    selected = choices?.available.find((c) => c.id === credit),
    bill = choices?.invoices.find((i) => i.id === invoice);
  return (
    <form
      className="record-form"
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Notice {...state} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input type="hidden" name="operation" value={operation} />
        <input type="hidden" name="request" value={request} />
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="record_id" value={recordId ?? ""} />
        {correction ? (
          <p>
            Correct a mistaken record. No money moves. Source credits can only
            be reversed after their applications have been reversed.
          </p>
        ) : operation === "record" ? (
          <>
            <label className="field supplier-credit-choice">
              Credit source
              <AppSelect
                name="source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="advance">
                  Money received for future invoices
                </option>
                <option value="invoice">Reduce a fully paid invoice</option>
              </AppSelect>
            </label>
            {source === "advance" ? (
              <>
                <p>
                  Record money already received and held for this customer. It
                  counts as cash on the received date.
                </p>
                <label className="field">
                  Received by
                  <AppSelect name="method" defaultValue="" required>
                    <option value="" disabled>
                      Choose method
                    </option>
                    {paymentMethods.map((m) => (
                      <option key={m} value={m}>
                        {paymentMethodLabels[m]}
                      </option>
                    ))}
                  </AppSelect>
                </label>
              </>
            ) : (
              <>
                <p>
                  Move retained money into account credit and reduce the source
                  invoice’s charges equally. Its balance stays unchanged. No new
                  cash is received.
                </p>
                <label className="field supplier-credit-choice">
                  Source payment
                  <AppSelect name="payment_id" defaultValue="" required>
                    <option value="" disabled>
                      Choose a paid invoice payment
                    </option>
                    {choices?.payments.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.invoice_number} · {dateLabel(p.paid_on)} ·{" "}
                        {money(p.available_cents)} available
                      </option>
                    ))}
                  </AppSelect>
                </label>
              </>
            )}
          </>
        ) : (
          <>
            <p>
              Apply part or all of an available credit to an open invoice. This
              does not record another cash receipt.
            </p>
            <label className="field supplier-credit-choice">
              Available credit
              <AppSelect
                name="credit_id"
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose credit
                </option>
                {choices?.available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {dateLabel(c.credit_on)} · {money(c.available_cents)} ·{" "}
                    {c.reason}
                  </option>
                ))}
              </AppSelect>
            </label>
            <label className="field supplier-credit-choice">
              Invoice
              <AppSelect
                name="invoice_id"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose invoice
                </option>
                {choices?.invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    #{i.invoice_number} · {money(i.balance_cents)} due
                  </option>
                ))}
              </AppSelect>
            </label>
          </>
        )}
        {!correction && (
          <div className="form-grid">
            <Field
              label="Amount ($)"
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              max={
                operation === "apply"
                  ? Math.min(
                      selected?.available_cents ?? 100000000,
                      bill?.balance_cents ?? 100000000,
                    ) / 100
                  : 1000000
              }
              required
            />
            <Field
              label={
                operation === "apply"
                  ? "Applied on"
                  : source === "advance"
                    ? "Received on"
                    : "Credit date"
              }
              name="date"
              type="date"
              defaultValue={date}
              min={
                operation === "apply"
                  ? [selected?.credit_on, bill?.issue_date]
                      .filter(Boolean)
                      .sort()
                      .at(-1)
                  : undefined
              }
              max={date}
              required
            />
          </div>
        )}
        {operation !== "apply" && (
          <Field
            label={correction ? "Correction reason (private)" : "Reason"}
            name="reason"
            required
            maxLength={correction ? 2000 : 500}
          />
        )}
        {operation === "record" && (
          <Field
            label="Reference (optional)"
            name="reference"
            maxLength={200}
          />
        )}
        <div className="form-actions">
          <ConfirmButton
            message={
              correction
                ? "Reverse this mistaken record? Its history is retained. This does not send or return money."
                : operation === "apply"
                  ? "Apply this credit to the selected invoice? Its balance due will decrease. No new cash is received."
                  : source === "advance"
                    ? "Record money already received as customer account credit? Do not record the same money as an invoice payment."
                    : "Reduce the selected fully paid invoice and move the same amount into customer account credit? No money moves."
            }
          >
            {pending
              ? "Saving…"
              : correction
                ? "Reverse record"
                : operation === "apply"
                  ? "Apply credit"
                  : "Save account credit"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
