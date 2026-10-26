"use client";
import { AppSelect } from "@/components/app-select";

import { feedingTimeLabel, type FeedingTime } from "@/lib/feeding-times";

import { FormInput } from "@/components/form-input";
import { servingStepper } from "@/lib/input-format";
import { useState } from "react";
import { dateLabel } from "@/lib/format";
import { ConfirmButton } from "@/components/confirm-button";
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
  home = false,
  past,
}: {
  home?: boolean;
  past?: {
    date: string;
    confirmations: { horse_id: string; feeding_time_id: string | null }[];
  };
  horses: Horse[];
  times: FeedingTime[];
  date: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [time, setTime] = useState(times.find((t) => !t.archived)?.id ?? "");
  const atTime = horses.filter((h) =>
    h.rations?.some((r) => r.feeding_time_id === time),
  );
  const logged = new Set(
    past?.confirmations
      .filter((c) => c.feeding_time_id === time || c.feeding_time_id === null)
      .map((c) => c.horse_id),
  );
  const eligible = atTime.filter((h) => !logged.has(h.id));
  return (
    <form action={confirmBulkFeeding} className="record-form">
      <input
        type="hidden"
        name="return_to"
        value={past ? "past-feeding" : home ? "home" : "feeding"}
      />
      <p>
        Choose the horses that received their saved ration for this feeding
        time. Previously confirmed horses are safely skipped for the same date
        and feeding time.
      </p>
      <label>
        Feeding time
        <AppSelect
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
        </AppSelect>
      </label>
      {past ? (
        <>
          <input type="hidden" name="feeding_date" value={past.date} />
          <p className="notice">
            Logging feedings for <strong>{dateLabel(past.date)}</strong>. Review
            the rations below: saved schedules and current weighted stock costs
            are used, rather than a historical version of the feeding plan. Use
            actual quantities if these differed.
          </p>
        </>
      ) : (
        <Field
          name="feeding_date"
          label="Actual feeding date"
          type="date"
          required
          defaultValue={date}
          max={date}
        />
      )}
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
          : past
            ? "Select all missing horses"
            : "Select all horses with rations"}
      </button>
      <div className="batch-horse-list">
        {!atTime.length && (
          <p className="muted">
            No assigned active rations at this feeding time. Add rations or
            choose another time.
          </p>
        )}
        {past && atTime.length > 0 && !eligible.length && (
          <p className="notice success">
            All horses with a current ration at this feeding time are already
            logged for {dateLabel(past.date)}.
          </p>
        )}
        {atTime.map((h) => (
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
            {logged.has(h.id) ? (
              <span className="tag">Already logged</span>
            ) : (
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
            )}
          </label>
        ))}
      </div>
      <p className="muted">
        {selected.length} horses selected. If any horse has insufficient stock,
        the whole batch stays unsaved.
      </p>
      {selected.length > 0 ? (
        <div className="form-actions">
          {past ? (
            <ConfirmButton
              message={`Record the selected horses’ saved rations for ${dateLabel(past.date)}? Stock will be deducted once for each missing horse and feeding time. Review current rations before continuing.`}
            >
              Save missed feedings
            </ConfirmButton>
          ) : (
            <SubmitButton>Confirm selected horses fed</SubmitButton>
          )}
        </div>
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
  pastDate,
}: {
  horses: Horse[];
  products: ProductOption[];
  units: UnitOption[];
  date: string;
  request: string;
  pastDate?: string;
  times?: FeedingTime[];
}) {
  const [selectedUnit, setSelectedUnit] = useState<UnitOption>();
  return (
    <form action={recordBulkFeeding} className="record-form">
      <input name="request_id" type="hidden" value={request} />
      {pastDate && (
        <>
          <input name="return_to" type="hidden" value="past-feeding" />
          <input name="feeding_date" type="hidden" value={pastDate} />
          <p className="notice">
            Actual quantities fed on <strong>{dateLabel(pastDate)}</strong>.
            These entries are additional consumption and do not mark a scheduled
            feeding complete.
          </p>
        </>
      )}
      <p>
        Record one product for several horses, with a separate quantity for
        each. Use this for extras or partial feedings; it does not confirm saved
        daily rations. Leave a quantity blank to skip that horse.
      </p>
      <div className="form-grid">
        {!pastDate && (
          <Field
            name="feeding_date"
            label="Actual feeding date"
            type="date"
            required
            defaultValue={date}
            max={date}
          />
        )}
        <label>
          Feeding time
          <AppSelect name="feeding_time_id" defaultValue="">
            <option value="">Unscheduled extra / partial feeding</option>
            {times
              .filter((t) => !t.archived)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {feedingTimeLabel(t)}
                </option>
              ))}
          </AppSelect>
        </label>
        <ProductUnitFields
          products={products}
          units={units}
          onUnitChange={setSelectedUnit}
        />
      </div>
      <div className="batch-horse-list">
        {horses.map((h) => (
          <label className="batch-horse-row" key={h.id}>
            <strong>{h.barn_name}</strong>
            <span>
              Quantity
              <FormInput
                key={`${h.id}-${selectedUnit?.id ?? "no-unit"}`}
                suffix={selectedUnit?.label}
                controls={servingStepper(selectedUnit?.label ?? "")}
                aria-label={`${h.barn_name} quantity${selectedUnit ? ` (${selectedUnit.label})` : ""}`}
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
      <div className="form-actions">
        {pastDate ? (
          <ConfirmButton
            message={`Record these actual quantities as additional consumption on ${dateLabel(pastDate)}? They deduct stock and do not confirm a saved feeding schedule. Do not enter quantities already logged.`}
          >
            Save actual quantities
          </ConfirmButton>
        ) : (
          <SubmitButton>Record these feedings</SubmitButton>
        )}
      </div>
    </form>
  );
}
