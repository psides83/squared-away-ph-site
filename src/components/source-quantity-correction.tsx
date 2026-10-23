"use client";
import Link from "next/link";
import { useActionState, useState, startTransition } from "react";
import { correctSourceQuantity } from "@/app/admin/inventory/actions";
import { Field, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { HelpPanel } from "@/components/help-panel";
export function SourceQuantityCorrection({
  movement,
  request,
}: {
  movement: {
    id: string;
    entered_quantity: string | number;
    value_delta_cents: string | number;
    unit_label: string;
    ounces_per_unit: string | number;
  };
  request: string;
}) {
  const [snapshot] = useState(movement);
  const [requestId] = useState(request);
  const [state, action, pending] = useActionState(correctSourceQuantity, {});
  const cost = (Number(snapshot.value_delta_cents) / 100).toFixed(2);
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Notice error={state.error} success={state.success} />
      {state.success && (
        <Link className="button secondary" href="/admin/inventory/cost-reviews">
          View corrections & invoice reviews
        </Link>
      )}
      <fieldset disabled={pending || Boolean(state.success)} className="stack">
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="original_id" value={snapshot.id} />
        <input
          type="hidden"
          name="expected_quantity"
          value={snapshot.entered_quantity}
        />
        <input type="hidden" name="expected_cost" value={cost} />
        <p>
          Correct this recorded stock quantity or total cost, including after
          some feed has been used. The original expense, receipts and date stay
          with this entry.
        </p>
        <p className="notice">
          Past feed costs and remaining stock will be recalculated. Actual
          feeding quantities, invoice charges and payments stay unchanged.
          Affected invoices require review.
        </p>
        <div className="form-grid">
          <Field
            name="quantity"
            label="Correct quantity"
            type="number"
            min="0.000001"
            max="1000000000"
            step="0.000001"
            suffix={snapshot.unit_label}
            required
            defaultValue={Number(snapshot.entered_quantity)}
          />
          <Field
            name="cost"
            label="Correct total cost ($)"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            required
            defaultValue={cost}
          />
        </div>
        <p className="muted">
          Recorded conversion: 1 {snapshot.unit_label} ={" "}
          {Number(snapshot.ounces_per_unit).toLocaleString("en-US", {
            maximumFractionDigits: 6,
          })}{" "}
          oz. This conversion stays unchanged.
        </p>
        <Field
          name="reason"
          label="Correction reason"
          required
          maxLength={2000}
        />
        <HelpPanel title="Shortages, billing and protected history">
          <p>
            If recalculation would make stock negative at any earlier entry, the
            entire correction is blocked. Review the earlier stock records
            before retrying. No stock adjustment is created automatically; a new
            addition recorded now does not rewrite earlier consumption.
          </p>
          <p>
            Recalculation follows recording order and supports reconciled
            histories up to 2,000 entries. Ambiguous legacy order and reversed
            source entries are blocked. Changing a purchase total also respects
            its existing invoice and shared-cost protections.
          </p>
          <p>
            For outdated draft actual-cost feed charges, remove and regenerate
            their lines. Review issued invoices and record any needed adjustment
            deliberately. To change a unit or its conversion before any later
            activity, use Replace latest entry instead.
          </p>
        </HelpPanel>
        <div className="form-actions">
          <ConfirmButton message="Correct this stock entry and recalculate later costs? Historical shortages will block the entire change. Saved invoice charges and payments will not change.">
            Save correction & recalculate
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
