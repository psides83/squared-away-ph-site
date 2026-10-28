"use client";
import { AppSelect } from "@/components/app-select";
import { FormInput } from "@/components/form-input";
export function PushReminderTime({
  value,
  onChange,
  available,
  disabled = false,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  available: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="stack">
      <label className="field">
        Supplier and care reminder time
        <AppSelect
          name="reminder_mode"
          aria-label="Supplier and care reminder time"
          value={value === null ? "daily" : "custom"}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.value === "daily" ? null : "09:00")
          }
        >
          <option value="daily">Use the daily check</option>
          <option value="custom" disabled={!available}>
            Choose a time
          </option>
        </AppSelect>
      </label>
      {value !== null && (
        <label className="field">
          Time of day (Central)
          <FormInput
            name="reminder_time"
            aria-label="Time of day (Central)"
            type="time"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required
            disabled={disabled || !available}
          />
        </label>
      )}
      <p className="form-hint muted">
        {available
          ? "Supplier and care reminders wait until this time, then use the next scheduled check. Delivery is approximate. Scheduler failures do not wait for this time."
          : "Custom times need the frequent notification check set up first. The existing daily check remains available. A saved custom time will still wait for an eligible check; switch to daily if frequent checks are turned off."}
      </p>
    </div>
  );
}
