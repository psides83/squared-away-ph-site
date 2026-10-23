"use client";
import { useActionState, useState, startTransition } from "react";
import { supplierExchangeAction } from "@/app/admin/inventory/returns/exchange-actions";
import { Field, Notice } from "@/components/ui";
import { AppSelect } from "@/components/app-select";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { dateLabel, money } from "@/lib/format";
export type ExchangePurchaseChoice = {
  id: string;
  vendor: string;
  expense_date: string;
  amount_cents: number;
  paid_on: string | null;
  products: string | null;
};
export function SupplierExchangeForm({
  returnId,
  choices,
  linkId,
}: {
  returnId?: string;
  choices?: ExchangePurchaseChoice[];
  linkId?: string;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [purchaseId, setPurchaseId] = useState("");
  const selected = choices?.find((p) => p.id === purchaseId);
  const [state, action, pending] = useActionState(supplierExchangeAction, {});
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
      <Notice error={state.error} success={state.success} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input
          type="hidden"
          name="operation"
          value={linkId ? "remove" : "link"}
        />
        <input type="hidden" name="request" value={request} />
        <input type="hidden" name="return_id" value={returnId ?? ""} />
        <input type="hidden" name="link_id" value={linkId ?? ""} />
        {linkId ? (
          <>
            <p>
              Remove this mistaken match. The return, purchase, stock and
              financial records stay unchanged.
            </p>
            <Field
              name="reason"
              label="Reason for removing link"
              required
              maxLength={2000}
            />
            <div className="form-actions">
              <ConfirmButton message="Remove this replacement purchase link? Its history will remain, and no stock or financial entries will change.">
                Remove link
              </ConfirmButton>
            </div>
          </>
        ) : (
          <>
            <p>
              Choose a separately recorded replacement purchase from this
              supplier. Linking does not apply store credit, record a cash
              payment or change inventory.
            </p>
            <label className="field supplier-credit-choice">
              Replacement purchase
              <AppSelect
                name="expense_id"
                required
                value={purchaseId}
                onChange={(e) => setPurchaseId(e.target.value)}
              >
                <option value="" disabled>
                  Choose a purchase
                </option>
                {choices?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {dateLabel(p.expense_date)} ·{" "}
                    {p.products ?? "Inventory purchase"} ·{" "}
                    {money(p.amount_cents)} · {p.paid_on ? "Settled" : "Unpaid"}
                  </option>
                ))}
              </AppSelect>
            </label>
            {selected && (
              <div className="notice" aria-live="polite">
                <strong>{selected.products ?? "Inventory purchase"}</strong>
                <p>
                  {dateLabel(selected.expense_date)} ·{" "}
                  {money(selected.amount_cents)} ·{" "}
                  {selected.paid_on ? "Settled" : "Unpaid"}
                </p>
              </div>
            )}
            <Field
              name="notes"
              label="Exchange reference / notes"
              maxLength={2000}
            />
            <div className="form-actions">
              <SubmitButton>Link replacement purchase</SubmitButton>
            </div>
          </>
        )}
      </fieldset>
    </form>
  );
}
