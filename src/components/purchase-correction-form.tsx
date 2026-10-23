import { AppSelect } from "@/components/app-select";
import { Field } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { correctPurchase, correctInbound } from "@/app/admin/inventory/actions";
export function PurchaseCorrectionForm({
  m,
  units,
  inbound = false,
}: {
  inbound?: boolean;
  m: {
    id: string;
    entered_quantity: string | number;
    unit_id: string;
    value_delta_cents: string | number;
  };
  units: { id: string; label: string; ounces_per_unit: string | number }[];
}) {
  return (
    <form
      action={inbound ? correctInbound : correctPurchase}
      className="record-form"
    >
      <input type="hidden" name="request_id" value={crypto.randomUUID()} />
      <input type="hidden" name="original_id" value={m.id} />
      {inbound ? (
        <p>
          Correct opening stock or a stock addition before any later activity.
          The original entry stays in history with a reversal and corrected
          stock addition. No expense or cash transaction is created.
        </p>
      ) : (
        <p>
          Replace an incorrectly entered quantity or total cost. The original
          expense is voided and retained, including its receipts. Its date,
          vendor and payment date carry to the replacement. This is not a vendor
          return or refund.
        </p>
      )}
      <p className="notice">
        Only the latest stock entry with no subsequent stock activity can be
        replaced. Saved feeding costs and invoice/shared-cost protections remain
        in force. Updated unit conversions apply to the replacement.
      </p>
      <div className="form-grid">
        <Field
          label="Correct quantity"
          name="quantity"
          type="number"
          min="0.000001"
          step="0.000001"
          required
          defaultValue={Number(m.entered_quantity)}
        />
        <label>
          Unit
          <AppSelect
            aria-label="Unit"
            name="unit_id"
            required
            defaultValue={m.unit_id}
          >
            {units?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label} · {u.ounces_per_unit} oz each
              </option>
            ))}
          </AppSelect>
        </label>
        <Field
          label="Correct total cost ($)"
          name="cost"
          type="number"
          min="0"
          max="1000000"
          step="0.01"
          required
          defaultValue={(Number(m.value_delta_cents) / 100).toFixed(2)}
        />
        <Field
          label="Correction reason"
          name="reason"
          required
          maxLength={2000}
        />
      </div>
      <div className="form-actions">
        <ConfirmButton
          message={
            inbound
              ? "Correct this stock entry? Its history will be retained and the stock quantity and value updated together."
              : "Replace this mistaken purchase entry? The original expense will be voided, its receipts retained, and corrected stock and expense records saved together."
          }
        >
          Save corrected entry
        </ConfirmButton>
      </div>
    </form>
  );
}
