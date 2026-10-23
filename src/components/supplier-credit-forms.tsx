"use client";
import {
  useActionState,
  useState,
  startTransition,
  type FormEvent,
} from "react";
import { supplierCreditAction } from "@/app/admin/inventory/credit-actions";
import { Field, Notice } from "@/components/ui";
import { AppSelect } from "@/components/app-select";
import { ConfirmButton } from "@/components/confirm-button";
import { money, dateLabel } from "@/lib/format";
export type CreditChoice = {
  id: string;
  vendor: string;
  reference: string | null;
  available_cents: number;
  issued_on?: string;
};
export function SupplierCreditForm({
  operation,
  date,
  request,
  expenseId,
  returnId,
  vendor,
  credits = [],
  cash = 0,
  id,
}: {
  operation: "issue" | "apply" | "cancel" | "reverse";
  date: string;
  request?: string;
  expenseId?: string;
  returnId?: string;
  vendor?: string;
  credits?: CreditChoice[];
  cash?: number;
  id?: string;
}) {
  const [state, action, pending] = useActionState(supplierCreditAction, {});
  const [requestId] = useState(request ?? "");
  const [creditId, setCreditId] = useState("");
  const selectedCredit = credits.find((c) => c.id === creditId);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
  return (
    <form action={action} onSubmit={submit} className="record-form">
      <Notice error={state.error} success={state.success} />
      <fieldset disabled={pending || Boolean(state.success)} className="stack">
        <input type="hidden" name="operation" value={operation} />
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="id" value={id ?? ""} />
        <input type="hidden" name="expense_id" value={expenseId ?? ""} />
        <input type="hidden" name="return_id" value={returnId ?? ""} />
        {operation === "issue" && (
          <>
            <p>
              Record a credit actually issued by the supplier. This is store
              credit, not a cash refund. Apply it deliberately from a purchase’s
              Supplier credits tab.
            </p>
            <div className="form-grid">
              <Field
                name="vendor"
                label="Supplier"
                required
                maxLength={200}
                defaultValue={vendor}
              />
              <Field
                name="issued_on"
                label="Issued on"
                type="date"
                required
                defaultValue={date}
                max={date}
              />
              <Field
                name="amount"
                label="Credit amount ($)"
                type="number"
                required
                min="0.01"
                max="1000000"
                step="0.01"
              />
              <Field
                name="reference"
                label="Credit reference (optional)"
                maxLength={200}
              />
            </div>
          </>
        )}
        {operation === "apply" && (
          <>
            <p>
              Apply only credit actually used for this purchase. Its full feed
              value stays recorded. Cash reports exclude this portion when the
              expense is marked paid/settled.
            </p>
            <label className="field supplier-credit-choice">
              <span className="field-label">Supplier credit</span>
              <AppSelect
                name="credit_id"
                value={creditId}
                onChange={(e) => setCreditId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Choose an available credit
                </option>
                {credits.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.reference || c.vendor}
                    {c.issued_on ? ` · ${dateLabel(c.issued_on)}` : ""} ·{" "}
                    {money(c.available_cents)} available
                  </option>
                ))}
              </AppSelect>
            </label>
            {selectedCredit && (
              <p className="muted">
                Available on this credit:{" "}
                <strong>{money(selectedCredit.available_cents)}</strong>
              </p>
            )}
            <div className="form-grid">
              <Field
                name="amount"
                label="Credit used ($)"
                type="number"
                required
                min="0.01"
                max={(
                  Math.min(cash, selectedCredit?.available_cents ?? cash) / 100
                ).toFixed(2)}
                step="0.01"
              />
              <Field
                name="applied_on"
                label="Applied on"
                type="date"
                required
                defaultValue={date}
                max={date}
              />
            </div>
            <p className="muted">
              Current purchase cash portion: {money(cash)}. Supplier names must
              match; no approximate matches are applied.
            </p>
          </>
        )}
        {(operation === "cancel" || operation === "reverse") && (
          <p className="notice">
            Correct mistaken records only. Reversing an application restores the
            credit balance and restates the purchase’s cash portion on its
            recorded settlement date. This does not record a new payment.
          </p>
        )}
        {operation !== "apply" && (
          <Field
            name="reason"
            label={
              operation === "issue" ? "Credit reason" : "Correction reason"
            }
            required
            maxLength={2000}
          />
        )}
        <div className="form-actions">
          <ConfirmButton
            destructive={operation === "cancel" || operation === "reverse"}
            message={
              operation === "issue"
                ? "Record this supplier credit without assuming any cash was received?"
                : operation === "apply"
                  ? "Apply this supplier credit to the purchase? Feed value stays unchanged; the recorded cash portion will be reduced."
                  : "Correct this credit record and retain its history? Past cash reports may be restated."
            }
          >
            {operation === "issue"
              ? "Record supplier credit"
              : operation === "apply"
                ? "Apply credit"
                : operation === "cancel"
                  ? "Cancel credit entry"
                  : "Reverse application"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
