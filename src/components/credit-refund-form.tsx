"use client";
import { useState, useActionState, startTransition } from "react";
import { creditRefundAction } from "@/app/admin/customers/credit-refund-actions";
import { Field, Notice } from "@/components/ui";
import { AppSelect } from "@/components/app-select";
import { ConfirmButton } from "@/components/confirm-button";
import { money, dateLabel } from "@/lib/format";
import { paymentMethods, paymentMethodLabels } from "@/lib/invoices";
import type { CreditChoices } from "@/components/customer-credit-form";
export function CreditRefundForm({
  credits = [],
  date,
  refundId,
}: {
  credits?: CreditChoices["available"];
  date: string;
  refundId?: string;
}) {
  const [request] = useState(() => crypto.randomUUID()),
    [credit, setCredit] = useState(""),
    [amount, setAmount] = useState(0);
  const [state, action, pending] = useActionState(creditRefundAction, {}),
    selected = credits.find((c) => c.id === credit);
  return (
    <form
      action={action}
      className="record-form"
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
      <Notice {...state} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input
          type="hidden"
          name="operation"
          value={refundId ? "reverse" : "record"}
        />
        <input type="hidden" name="request" value={request} />
        {refundId ? (
          <>
            <input type="hidden" name="refund_id" value={refundId} />
            <p>
              For a mistaken record only. Reversing restores the customer’s
              available credit and removes this refund from its original
              cash-report period. No money returns to you and invoice balances
              stay unchanged.
            </p>
            <Field
              label="Correction reason (private)"
              name="correction_reason"
              maxLength={2000}
              required
            />
          </>
        ) : (
          <>
            <p>
              Record money already returned from unused account credit. This
              reduces available credit and cash on the returned date; invoice
              balances stay unchanged.
            </p>
            <label className="field supplier-credit-choice">
              Source account credit
              <AppSelect
                name="credit_id"
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose unused credit
                </option>
                {credits.map((c) => (
                  <option key={c.id} value={c.id}>
                    {money(c.available_cents)} available ·{" "}
                    {dateLabel(c.credit_on)} · {c.reason}
                  </option>
                ))}
              </AppSelect>
            </label>
            {selected && (
              <p className="form-hint">
                {money(selected.available_cents)} unused from the credit dated{" "}
                {dateLabel(selected.credit_on)}. Earlier invoice applications
                and refunds are excluded.
              </p>
            )}
            <div className="form-grid">
              <Field
                label="Refund returned ($)"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                max={selected ? selected.available_cents / 100 : 1000000}
                required
              />
              <Field
                label="Returned on"
                name="refunded_on"
                type="date"
                defaultValue={date}
                min={selected?.credit_on}
                max={date}
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
            <Field
              label="Refund reason (shared with customer)"
              name="reason"
              maxLength={500}
              required
            />
            <details>
              <summary>Reference & private notes</summary>
              <div className="stack">
                <Field
                  label="Refund reference (shared)"
                  name="reference"
                  maxLength={200}
                />
                <label className="field">
                  Private notes
                  <textarea name="notes" rows={3} maxLength={2000} />
                </label>
              </div>
            </details>
          </>
        )}
        <div className="form-actions">
          <ConfirmButton
            message={
              refundId
                ? "Reverse this mistaken refund record? Available credit will increase and the original cash-report period will be restated. No money moves."
                : `Record ${money(amount)} already returned from unused customer credit? Available credit will decrease. Invoice balances stay unchanged. The app will not send money.`
            }
          >
            {pending
              ? "Saving…"
              : refundId
                ? "Reverse refund record"
                : "Record completed refund"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
