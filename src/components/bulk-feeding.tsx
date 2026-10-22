"use client";
import { useState } from "react";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import {
  ProductUnitFields,
  type ProductOption,
  type UnitOption,
} from "@/components/stock-forms";
import {
  confirmBulkFeeding,
  recordBulkFeeding,
} from "@/app/admin/inventory/actions";

type Horse = { id: string; barn_name: string; ration?: string };
export function DailyFeedingBatch({
  horses,
  date,
}: {
  horses: Horse[];
  date: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <form action={confirmBulkFeeding} className="record-form">
      <p>
        Choose the horses that received their entire saved daily ration.
        Previously confirmed horses are safely skipped for the same date.
      </p>
      <Field
        name="feeding_date"
        label="Actual feeding date"
        type="date"
        required
        defaultValue={date}
        max={date}
      />
      <button
        className="text-button"
        type="button"
        onClick={() =>
          setSelected(
            selected.length === horses.length ? [] : horses.map((h) => h.id),
          )
        }
      >
        {selected.length === horses.length
          ? "Clear selection"
          : "Select all horses with rations"}
      </button>
      <div className="batch-horse-list">
        {horses.map((h) => (
          <label className="batch-horse-row" key={h.id}>
            <span>
              <strong>{h.barn_name}</strong>
              <small className="muted">{h.ration}</small>
            </span>
            <input
              type="checkbox"
              name="horse_id"
              value={h.id}
              checked={selected.includes(h.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, h.id]
                    : selected.filter((id) => id !== h.id),
                )
              }
            />
          </label>
        ))}
      </div>
      <p className="muted">
        {selected.length} horses selected. If any horse has insufficient stock,
        the whole batch stays unsaved.
      </p>
      {selected.length > 0 ? (
        <SubmitButton>Confirm selected horses fed</SubmitButton>
      ) : (
        <p>Select at least one horse to continue.</p>
      )}
    </form>
  );
}
export function ExtraFeedingBatch({
  horses,
  products,
  units,
  date,
  request,
}: {
  horses: Horse[];
  products: ProductOption[];
  units: UnitOption[];
  date: string;
  request: string;
}) {
  return (
    <form action={recordBulkFeeding} className="record-form">
      <input name="request_id" type="hidden" value={request} />
      <p>
        Record one product for several horses, with a separate quantity for
        each. Use this for extras or partial feedings; it does not confirm saved
        daily rations. Leave a quantity blank to skip that horse.
      </p>
      <div className="form-grid">
        <Field
          name="feeding_date"
          label="Actual feeding date"
          type="date"
          required
          defaultValue={date}
          max={date}
        />
        <ProductUnitFields products={products} units={units} />
      </div>
      <div className="batch-horse-list">
        {horses.map((h) => (
          <label className="batch-horse-row" key={h.id}>
            <strong>{h.barn_name}</strong>
            <span>
              Quantity in selected unit
              <input
                type="number"
                name={`quantity_${h.id}`}
                min="0.000001"
                max="1000000000"
                step="0.000001"
                placeholder="Skip"
              />
            </span>
          </label>
        ))}
      </div>
      <label>
        Notes
        <textarea name="notes" maxLength={5000} rows={2} />
      </label>
      <p className="muted">
        Review every quantity before saving. All entries save together and
        deduct stock at its current weighted cost.
      </p>
      <SubmitButton>Record these feedings</SubmitButton>
    </form>
  );
}
