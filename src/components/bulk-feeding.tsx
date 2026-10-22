"use client";
import { feedingTimeLabel, type FeedingTime } from "@/lib/feeding-times";

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

type Horse = {
  id: string;
  barn_name: string;
  rations?: { feeding_time_id: string; summary: string }[];
};
export function DailyFeedingBatch({
  horses,
  date,
  times,
}: {
  horses: Horse[];
  times: FeedingTime[];
  date: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [time, setTime] = useState(times.find((t) => !t.archived)?.id ?? "");
  const eligible = horses.filter((h) =>
    h.rations?.some((r) => r.feeding_time_id === time),
  );
  return (
    <form action={confirmBulkFeeding} className="record-form">
      <p>
        Choose the horses that received their saved ration for this feeding
        time. Previously confirmed horses are safely skipped for the same date
        and feeding time.
      </p>
      <label>
        Feeding time
        <select
          name="feeding_time_id"
          required
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            setSelected([]);
          }}
        >
          <option value="" disabled>
            Choose a feeding time
          </option>
          {times
            .filter((t) => !t.archived)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {feedingTimeLabel(t)}
              </option>
            ))}
        </select>
      </label>
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
        disabled={!eligible.length}
        onClick={() =>
          setSelected(
            selected.length === eligible.length
              ? []
              : eligible.map((h) => h.id),
          )
        }
      >
        {selected.length === eligible.length
          ? "Clear selection"
          : "Select all horses with rations"}
      </button>
      <div className="batch-horse-list">
        {!eligible.length && (
          <p className="muted">
            No assigned active rations at this feeding time. Add rations or
            choose another time.
          </p>
        )}
        {eligible.map((h) => (
          <label className="batch-horse-row" key={h.id}>
            <span>
              <strong>{h.barn_name}</strong>
              <small className="muted">
                {h.rations
                  ?.filter((r) => r.feeding_time_id === time)
                  .map((r) => r.summary)
                  .join(" · ")}
              </small>
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
  times = [],
}: {
  horses: Horse[];
  products: ProductOption[];
  units: UnitOption[];
  date: string;
  request: string;
  times?: FeedingTime[];
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
        <label>
          Feeding time
          <select name="feeding_time_id" defaultValue="">
            <option value="">Unscheduled extra / partial feeding</option>
            {times
              .filter((t) => !t.archived)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {feedingTimeLabel(t)}
                </option>
              ))}
          </select>
        </label>
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
