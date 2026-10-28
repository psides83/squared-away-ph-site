"use client";
import { startTransition, useActionState } from "react";
import { cancelReceiptPurchase } from "@/app/admin/inventory/purchases/actions";
import { Field, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
export function ReceiptPurchaseCancel({ expense }: { expense: string }) {
  const [state, action, pending] = useActionState(cancelReceiptPurchase, {});
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(() => action(f));
      }}
    >
      <Notice {...state} />
      <fieldset disabled={pending || Boolean(state.success)} className="stack">
        <input name="expense_id" type="hidden" value={expense} />
        <p>
          Cancel the entire receipt only when no later stock activity exists for
          its products. The expense is voided and original stock additions are
          reversed together. Linked supplier credit, billing or cost assignments
          may require review first. Documentation stays retained.
        </p>
        <Field
          label="Cancellation reason"
          name="reason"
          maxLength={2000}
          required
        />
        <div className="form-actions">
          <ConfirmButton
            destructive
            message="Cancel this whole receipt and remove its original stock additions? The saved items, expense and receipt attachment remain in history. This records a correction; it does not refund money."
          >
            {pending ? "Cancelling…" : "Cancel whole receipt"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
