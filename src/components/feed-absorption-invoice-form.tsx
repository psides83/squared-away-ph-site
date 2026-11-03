"use client";
import { useState, useActionState, startTransition } from "react";
import { resolveFeedAbsorptionInvoice } from "@/app/admin/invoices/feed-absorption-review-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { Field, Notice } from "@/components/ui";
import type { AbsorptionInvoiceReview } from "@/lib/feed-absorption-invoice-review";
export function FeedAbsorptionInvoiceForm({
  review,
}: {
  review: AbsorptionInvoiceReview;
}) {
  const [snapshot] = useState(review),
    [state, action, pending] = useActionState(resolveFeedAbsorptionInvoice, {});
  return (
    <form
      className="record-form"
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(() => action(f));
      }}
    >
      <Notice {...state} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input name="invoice_id" type="hidden" value={snapshot.invoice_id} />
        <input
          name="source_token"
          type="hidden"
          value={snapshot.source_token}
        />
        <p>
          Review all {snapshot.pending_count} pending absorbed-feed decisions
          and any required billing corrections. This records your resolution
          only; it does not calculate or create credits, charges, refunds or
          payments.
        </p>
        <p className="notice">
          Draft feed charges must be removed and regenerated if their sources or
          protected amounts changed. For finalized invoices, enter any
          adjustments or refunds yourself before recording your resolution, or
          explain why the existing charges should remain.
        </p>
        <Field
          name="reason"
          label="Manual billing review and resolution"
          required
          maxLength={2000}
        />
        <div className="form-actions">
          <ConfirmButton message="Record that you reviewed all currently pending absorbed-feed billing changes and entered any needed corrections yourself? This action creates no financial transaction.">
            {pending ? "Saving…" : "Record manual review"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
