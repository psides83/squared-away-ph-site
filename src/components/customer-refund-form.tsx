"use client";
import { useActionState, useState, startTransition } from "react";
import { invoiceRefundAction } from "@/app/admin/invoices/refund-actions";
import { AppSelect } from "@/components/app-select";
import { Field, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { money, dateLabel } from "@/lib/format";
import { paymentMethods, paymentMethodLabels } from "@/lib/invoices";
export type RefundPayment = {
  id: string;
  paid_on: string;
  amount_cents: number;
  method: string;
  refunded_cents: number;
  available_cents: number;
};
export function CustomerRefundForm({
  payments,
  date,
  refundId,
}: {
  payments?: RefundPayment[];
  date: string;
  refundId?: string;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(0);
  const [payment, setPayment] = useState("");
  const [effect, setEffect] = useState("");
  const [state, action, pending] = useActionState(invoiceRefundAction, {});
  const selected = payments?.find((p) => p.id === payment);
  return (
    <form
      className="record-form"
      action={action}
      onChange={(e) => {
        const value = String(new FormData(e.currentTarget).get("amount") ?? "");
        setAmount(
          /^\d+(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : 0,
        );
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Notice error={state.error} success={state.success} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input name="request" type="hidden" value={request} />
        <input
          name="operation"
          type="hidden"
          value={refundId ? "reverse" : "record"}
        />
        {refundId ? (
          <>
            <input type="hidden" name="refund_id" value={refundId} />
            <p>
              For a mistaken record only. This removes the recorded refund from
              its original cash-report period. A matching invoice reduction will
              receive a reversing charge adjustment. This does not return money
              to you.
            </p>
            <Field
              label="Correction reason (private)"
              name="correction_reason"
              required
              maxLength={2000}
            />
            <div className="form-actions">
              <ConfirmButton message="Reverse this mistaken refund record and its linked invoice reduction, if any? No money moves. Later payments may prevent this correction.">
                Reverse refund record
              </ConfirmButton>
            </div>
          </>
        ) : (
          <>
            <p>
              Record money already returned to the customer. Choose the received
              payment it came from and the intended effect on the invoice.
            </p>
            <label className="field supplier-credit-choice">
              Source payment
              <AppSelect
                name="payment_id"
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose a received payment
                </option>
                {payments
                  ?.filter((p) => p.available_cents > 0)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {dateLabel(p.paid_on)} · {paymentMethodLabels[p.method]} ·{" "}
                      {money(p.available_cents)} available
                    </option>
                  ))}
              </AppSelect>
            </label>
            {selected && (
              <p className="notice">
                {money(selected.available_cents)} available after earlier
                refunds and expense-recovery assignments. Originally received{" "}
                {money(selected.amount_cents)} on {dateLabel(selected.paid_on)}.
              </p>
            )}
            <div className="form-grid">
              <Field
                label="Refund returned ($)"
                name="amount"
                type="number"
                min="0.01"
                max={selected ? selected.available_cents / 100 : 1000000}
                step="0.01"
                required
              />
              <Field
                label="Returned on"
                name="refunded_on"
                type="date"
                min={selected?.paid_on}
                max={date}
                defaultValue={date}
                required
              />
              <label className="field">
                Returned by
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
            </div>
            <label className="field supplier-credit-choice">
              Invoice effect
              <AppSelect
                name="effect"
                value={effect}
                onChange={(e) => setEffect(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose invoice effect
                </option>
                <option value="reduce">
                  Reduce charges by the refund amount
                </option>
                <option value="reopen">
                  Reopen the refunded amount as owed
                </option>
              </AppSelect>
            </label>
            {effect && (
              <p className="notice">
                {effect === "reduce"
                  ? "Adds a matching credit adjustment. The current balance due stays unchanged."
                  : "Invoice charges stay unchanged. The customer’s balance due increases by the refund amount, using the existing due date."}
              </p>
            )}
            <Field
              label="Refund reason (shown on invoice)"
              name="reason"
              required
              maxLength={500}
            />
            <details>
              <summary>Reference & private notes</summary>
              <div className="stack">
                <Field
                  label="Refund reference"
                  name="reference"
                  maxLength={200}
                />
                <label className="field">
                  Private refund notes
                  <textarea name="notes" maxLength={2000} rows={3} />
                </label>
              </div>
            </details>
            <div className="form-actions">
              <ConfirmButton
                message={`Record ${money(amount)} already returned${selected ? ` from the payment received ${dateLabel(selected.paid_on)}` : ""}? ${effect === "reduce" ? "Invoice charges and retained payments will both decrease." : "The refunded amount will become payable again on the invoice."} The app will not send money.`}
              >
                Record completed refund
              </ConfirmButton>
            </div>
          </>
        )}
      </fieldset>
    </form>
  );
}
