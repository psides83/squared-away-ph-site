"use client";
import { startTransition, useActionState, useState } from "react";
import { saveRidingSchedule } from "@/app/admin/riding-actions";
import {
  ridingWeekdays,
  type RidingDay,
  type RidingSchedule,
} from "@/lib/riding-schedule";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
export function RidingScheduleEditor({
  horse,
  schedule,
}: {
  horse: { id: string; barn_name: string };
  schedule?: RidingSchedule | null;
}) {
  const [state, action, pending] = useActionState(saveRidingSchedule, {});
  const [initialVersion] = useState(schedule?.version ?? "");
  const [days, setDays] = useState<(RidingDay | null)[]>(
    schedule?.days ?? Array(7).fill(null),
  );
  return (
    <>
      <form
        action={action}
        className="record-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const submitter = (e.nativeEvent as SubmitEvent)
            .submitter as HTMLButtonElement | null;
          if (submitter?.value) data.set("operation", submitter.value);
          startTransition(() => action(data));
        }}
      >
        <Notice error={state.error} success={state.success} />
        <fieldset
          disabled={pending || Boolean(state.success)}
          className="stack"
        >
          <input type="hidden" name="horse_id" value={horse.id} />
          <input type="hidden" name="expected" value={initialVersion} />
          <input type="hidden" name="days" value={JSON.stringify(days)} />
          <p>
            {horse.barn_name} · Choose training or off for each day. This
            recurring plan does not record sessions or change billing.
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                setDays([
                  "training",
                  "training",
                  "training",
                  "training",
                  "training",
                  "off",
                  "off",
                ])
              }
            >
              Weekdays training
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setDays(Array(7).fill("off"))}
            >
              All off
            </button>
          </div>
          <div className="riding-day-editor">
            {ridingWeekdays.map((day, i) => (
              <div className="riding-day-row" key={day}>
                <strong>{day}</strong>
                <div
                  className="riding-day-options"
                  role="group"
                  aria-label={day}
                >
                  {(["training", "off"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={days[i] === value}
                      onClick={() =>
                        setDays(
                          days.map((d, index) => (index === i ? value : d)),
                        )
                      }
                    >
                      {value === "training" ? "Training" : "Off"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <label className="field quick-training-notes">
            <span className="field-label">Plan notes (optional)</span>
            <textarea
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={schedule?.notes ?? ""}
              placeholder="Goals or routine details for this horse."
            />
          </label>
          <div className="form-actions">
            {days.every(Boolean) ? (
              <SubmitButton>Save weekly plan</SubmitButton>
            ) : (
              <p className="muted">Choose a plan for all seven days to save.</p>
            )}
          </div>
        </fieldset>
      </form>
      {schedule?.days && (
        <form action={action} className="record-form">
          <input type="hidden" name="horse_id" value={horse.id} />
          <input type="hidden" name="expected" value={initialVersion} />
          <input type="hidden" name="operation" value="clear" />
          <fieldset disabled={pending || Boolean(state.success)}>
            <ConfirmButton
              className="button secondary"
              destructive
              message="Clear this horse’s recurring riding plan? Actual training and billing records will be kept."
            >
              Clear weekly plan
            </ConfirmButton>
          </fieldset>
        </form>
      )}
    </>
  );
}
