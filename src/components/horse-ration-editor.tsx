"use client";
import { useActionState, useEffect, useState, startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { AppSelect } from "@/components/app-select";
import { ActionPanel } from "@/components/action-panel";
import { ConfirmButton } from "@/components/confirm-button";
import {
  ProductQuantityFields,
  type ProductOption,
  type UnitOption,
} from "@/components/stock-forms";
import { saveHorseFeedSchedule } from "@/app/admin/inventory/actions";
import { feedingTimeLabel, type FeedingTime } from "@/lib/feeding-times";
import type { FeedScheduleState } from "@/lib/feed-schedules";
import type { Ration } from "@/components/saved-rations";
type Draft = {
  id: string;
  product_id?: string;
  unit_id?: string;
  quantity?: number | string;
  active: boolean;
  notes?: string | null;
};
export function HorseFeedTimeForm({
  horse,
  rations,
  sourceTime,
  isNew,
  products,
  units,
  times,
  request,
  newRowId,
}: {
  horse: { id: string };
  rations: Ration[];
  sourceTime: string | null;
  isNew: boolean;
  request: string;
  newRowId: string;
  products: ProductOption[];
  units: UnitOption[];
  times: FeedingTime[];
}) {
  const router = useRouter();
  const [initial] = useState(() =>
    rations
      .filter((r) => r.feeding_time_id === sourceTime)
      .sort((a, b) =>
        (products.find((p) => p.id === a.product_id)?.name ?? "").localeCompare(
          products.find((p) => p.id === b.product_id)?.name ?? "",
        ),
      ),
  );
  const [requestId] = useState(request);
  const [rows, setRows] = useState<Draft[]>(() =>
    isNew ? [{ id: newRowId, active: true }] : initial,
  );
  const [target, setTarget] = useState(isNew ? "" : (sourceTime ?? ""));
  const [state, save, pending] = useActionState(
    saveHorseFeedSchedule.bind(null, horse.id),
    {} as FeedScheduleState,
  );
  useEffect(() => {
    if (state.ok)
      router.push(
        `/admin/horses/${horse.id}?schedule_saved=${requestId}&success=Feeding+time+saved.+Past+feedings+and+stock+are+unchanged.#horse-rations`,
      );
  }, [state, router, horse.id, requestId]);
  const occupied = new Set(
    rations
      .filter((r) => r.feeding_time_id !== sourceTime || isNew)
      .map((r) => r.feeding_time_id),
  );
  const disabled = pending || state.ok;
  return (
    <form
      className="record-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => save(data));
      }}
    >
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="mode" value={isNew ? "new" : "edit"} />
      <input type="hidden" name="source_time" value={sourceTime ?? ""} />
      <input
        type="hidden"
        name="expected"
        value={JSON.stringify(isNew ? [] : initial)}
      />
      <p>
        Set every ration for this feeding time, then save the whole time slot.
        Changes apply to future feeding confirmations.
      </p>
      {!isNew && sourceTime === null && (
        <p className="notice">
          These are older whole-day totals. Enter the amount for the selected
          feeding time; do not assign a whole day’s quantity to just one
          feeding.
        </p>
      )}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <fieldset disabled={Boolean(disabled)} className="feed-schedule-fields">
        <label>
          Feeding time <span className="required">*</span>
          <AppSelect
            name="feeding_time_id"
            required={rows.length > 0}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="" disabled>
              Choose a feeding time
            </option>
            {times
              .filter((t) => !t.archived || t.id === sourceTime)
              .map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  disabled={
                    occupied.has(t.id) || (t.archived && t.id !== sourceTime)
                  }
                >
                  {feedingTimeLabel(t)}
                  {occupied.has(t.id)
                    ? " (already scheduled)"
                    : t.archived
                      ? " (archived)"
                      : ""}
                </option>
              ))}
          </AppSelect>
        </label>
        <div className="feed-schedule-lines">
          {rows.map((row, index) => (
            <section className="feed-schedule-line" key={row.id}>
              <div className="feed-schedule-line-heading">
                <h3>Ration {index + 1}</h3>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setRows((current) => current.filter((r) => r.id !== row.id))
                  }
                  aria-label={`Remove ration ${index + 1} from this draft`}
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              </div>
              <input type="hidden" name="row_key" value={row.id} />
              <div className="form-grid">
                <ProductQuantityFields
                  products={products}
                  units={units}
                  initialProduct={row.product_id}
                  initialUnit={row.unit_id}
                  initialQuantity={row.quantity}
                />
              </div>
              <label className="inline-checkbox">
                <input
                  type="checkbox"
                  name={`active_${row.id}`}
                  defaultChecked={row.active}
                />
                Include in this feeding
              </label>
              <details>
                <summary>Ration notes</summary>
                <label>
                  Notes
                  <textarea
                    name="notes"
                    rows={2}
                    maxLength={2000}
                    defaultValue={row.notes ?? ""}
                  />
                </label>
              </details>
            </section>
          ))}
        </div>
        {!rows.length && (
          <p className="notice">
            {isNew
              ? "Add a ration to start this feeding time."
              : "Saving will remove this feeding time from the horse’s plan. Recorded feedings stay unchanged."}
          </p>
        )}
        <div className="row-actions">
          <button
            type="button"
            className="button secondary"
            disabled={rows.length >= 100}
            onClick={() =>
              setRows((current) => [
                ...current,
                { id: crypto.randomUUID(), active: true },
              ])
            }
          >
            <Plus size={17} />
            Add ration
          </button>
          {!isNew && rows.length > 0 && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRows([])}
            >
              Clear this time slot
            </button>
          )}
        </div>
        <div className="form-actions">
          {rows.length ? (
            <button type="submit" className="button primary">
              {pending ? "Saving…" : "Save feeding time"}
            </button>
          ) : !isNew ? (
            <ConfirmButton
              destructive
              message="Remove this entire feeding time and its rations from this horse’s plan? Past feeding records will be retained."
            >
              Remove feeding time
            </ConfirmButton>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}
export function HorseRationEditor({
  horse,
  rations,
  sourceTime,
  isNew,
  products,
  units,
  times,
  request,
  newRowId,
}: {
  horse: { id: string };
  rations: Ration[];
  sourceTime?: string | null;
  isNew: boolean;
  request: string;
  newRowId: string;
  products: ProductOption[];
  units: UnitOption[];
  times: FeedingTime[];
}) {
  const editing =
    sourceTime !== undefined &&
    !isNew &&
    rations.some((r) => r.feeding_time_id === sourceTime);
  return (
    <ActionPanel
      id="ration-form"
      label={editing ? "Edit feeding time" : "Add feeding time"}
      defaultOpen={editing || isNew}
      closeHref={`/admin/horses/${horse.id}#horse-rations`}
    >
      {times.some(
        (t) => !t.archived && !rations.some((r) => r.feeding_time_id === t.id),
      ) || editing ? (
        <HorseFeedTimeForm
          key={editing ? (sourceTime ?? "legacy") : "new"}
          horse={horse}
          rations={rations}
          sourceTime={sourceTime ?? null}
          request={request}
          newRowId={newRowId}
          isNew={!editing}
          products={products}
          units={units}
          times={times}
        />
      ) : (
        <p className="record-form muted">
          Each active feeding time already has a schedule, or no feeding times
          are available. Edit a saved time below, or{" "}
          <Link className="inline-link" href="/admin/feeding#feeding-times">
            manage feeding times
          </Link>{" "}
          to add another.
        </p>
      )}
    </ActionPanel>
  );
}
