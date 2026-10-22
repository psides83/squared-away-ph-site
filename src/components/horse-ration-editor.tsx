import { ActionPanel } from "@/components/action-panel";
import { SubmitButton } from "@/components/submit-button";
import {
  ProductQuantityFields,
  type ProductOption,
  type UnitOption,
} from "@/components/stock-forms";
import { saveHorseRation } from "@/app/admin/inventory/actions";
import { feedingTimeLabel, type FeedingTime } from "@/lib/feeding-times";
import { type Ration } from "@/components/saved-rations";
export function HorseRationEditor({
  horse,
  selected,
  isNew,
  products,
  units,
  times,
}: {
  horse: { id: string };
  selected?: Ration;
  isNew: boolean;
  products: ProductOption[];
  units: UnitOption[];
  times: FeedingTime[];
}) {
  return (
    <ActionPanel
      id="ration-form"
      label={selected ? "Edit ration" : "Add a ration"}
      defaultOpen={Boolean(selected) || isNew}
      closeHref={`/admin/horses/${horse.id}#horse-rations`}
    >
      {selected || products.some((p) => !p.archived) ? (
        <form
          action={saveHorseRation.bind(null, horse.id)}
          className="record-form"
          key={selected?.id ?? "new"}
        >
          <input type="hidden" name="id" value={selected?.id ?? ""} />
          <div className="form-grid">
            <input type="hidden" name="horse_id" value={horse.id} />
            <label>
              Feeding time
              <select
                name="feeding_time_id"
                required
                defaultValue={selected?.feeding_time_id ?? ""}
              >
                <option value="" disabled>
                  Choose a feeding time
                </option>
                {times
                  ?.filter(
                    (t) => !t.archived || t.id === selected?.feeding_time_id,
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id} disabled={t.archived}>
                      {feedingTimeLabel(t)}
                      {t.archived ? " (archived)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <ProductQuantityFields
              products={products}
              units={units}
              initialProduct={selected?.product_id}
              initialUnit={selected?.unit_id}
              initialQuantity={selected?.quantity}
            />
          </div>
          <label className="inline-checkbox">
            <input
              name="active"
              type="checkbox"
              defaultChecked={selected?.active ?? true}
            />
            Active ration
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={selected?.notes ?? ""}
            />
          </label>
          <p className="muted">
            One line per horse, product, and feeding time. Morning and evening
            quantities are separate. Saving a ration does not deduct stock or
            change past feedings.
          </p>
          <SubmitButton>Save ration</SubmitButton>
        </form>
      ) : (
        <p className="record-form muted">
          Add an active inventory product first.
        </p>
      )}
    </ActionPanel>
  );
}
