import { revaluePurchase } from "@/app/admin/inventory/actions";
import { HelpPanel } from "@/components/help-panel";
import { Field } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
export function PurchaseCostForm({
  movement,
}: {
  movement: { id: string; value_delta_cents: number | string };
}) {
  const cost = (Number(movement.value_delta_cents) / 100).toFixed(2);
  return (
    <form action={revaluePurchase} className="record-form">
      <input type="hidden" name="request_id" value={crypto.randomUUID()} />
      <input type="hidden" name="original_id" value={movement.id} />
      <input type="hidden" name="expected_cost" value={cost} />
      <p>
        Correct the total purchase cost while keeping its quantity, date and
        receipts. Later feeding, waste and remaining stock costs will be
        recalculated in recording order.
      </p>
      <p className="notice">
        Past feeding costs will change. Invoice charges and payments stay
        unchanged; affected bills require review.
      </p>
      <HelpPanel title="How corrections and invoice reviews work">
        <p>
          For draft actual-cost feed charges, remove and regenerate outdated
          lines. For issued invoices, decide whether an adjustment is needed.
          Allocated or directly billed purchase expenses must be cleared first.
        </p>
        <p>
          Recalculation requires reconciled history of at most 2,000 entries.
          Historical entries with an unknown recording order are blocked.
          Purchase quantities stay unchanged; earlier quantity corrections and
          supplier returns remain separate work.
        </p>
      </HelpPanel>
      <div className="form-grid">
        <Field
          label="Correct purchase total ($)"
          name="cost"
          type="number"
          min="0"
          max="1000000"
          step="0.01"
          required
          defaultValue={cost}
        />
        <Field
          label="Correction reason"
          name="reason"
          required
          maxLength={2000}
        />
      </div>
      <div className="form-actions">
        <ConfirmButton message="Recalculate this product’s recorded costs and flag affected invoices? Saved invoice charges will not change.">
          Recalculate costs
        </ConfirmButton>
      </div>
    </form>
  );
}
