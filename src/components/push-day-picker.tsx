"use client";
import { PUSH_DAYS } from "@/lib/push-days";
export function PushDayPicker({
  days,
  onChange,
  disabled = false,
}: {
  days: number[];
  onChange: (days: number[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="stack push-day-picker" disabled={disabled}>
      <legend className="field-label">Supplier reminder days</legend>
      <div
        className="push-day-options"
        role="group"
        aria-label="Supplier reminder days"
      >
        {PUSH_DAYS.map((day) => (
          <button
            className={`button ${days.includes(day.id) ? "" : "secondary"}`}
            type="button"
            aria-pressed={days.includes(day.id)}
            key={day.id}
            onClick={() =>
              onChange(
                days.includes(day.id)
                  ? days.filter((d) => d !== day.id)
                  : [...days, day.id].sort((a, b) => a - b),
              )
            }
          >
            {day.label}
          </button>
        ))}
      </div>
      <div className="row-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => onChange([1, 2, 3, 4, 5, 6, 7])}
        >
          Every day
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => onChange([1, 2, 3, 4, 5])}
        >
          Weekdays
        </button>
      </div>
      {days.map((day) => (
        <input type="hidden" name="supplier_days" value={day} key={day} />
      ))}
      {!days.length && (
        <p className="notice">Select at least one reminder day.</p>
      )}
      <p className="muted">
        Reminders run during the daily scheduled check on selected days in
        Central Time. This changes reminder days, not the scheduler’s check
        time.
      </p>
    </fieldset>
  );
}
