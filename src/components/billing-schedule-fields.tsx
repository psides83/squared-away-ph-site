"use client";
import { useState } from "react";
import { Field } from "@/components/ui";
export function BillingScheduleFields({
  schedule = "custom",
  day = 1,
  enabled = false,
  start = "",
}: {
  schedule?: string;
  day?: number;
  enabled?: boolean;
  start?: string;
}) {
  const [mode, setMode] = useState(schedule),
    [recurring, setRecurring] = useState(enabled);
  return (
    <>
      <label>
        Billing schedule
        <select
          name="billing_schedule"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="first_of_month">First of month</option>
          <option value="arrival_anniversary">Arrival anniversary</option>
          <option value="custom">Custom day of month</option>
        </select>
      </label>
      {mode === "custom" ? (
        <Field
          name="billing_day"
          label="Custom billing day (1–31)"
          type="number"
          min={1}
          max={31}
          step="1"
          required
          defaultValue={day}
        />
      ) : (
        <p className="muted">
          {mode === "first_of_month"
            ? "Bill on the first."
            : "Use the arrival date’s original day."}{" "}
          Shorter months use their last day, then return to the original day.
        </p>
      )}
      <label className="inline-checkbox">
        <input
          name="recurring_enabled"
          type="checkbox"
          checked={recurring}
          onChange={(e) => setRecurring(e.target.checked)}
        />
        Enable recurring invoice preparation
      </label>
      {!recurring && (
        <input type="hidden" name="recurring_start_date" value={start} />
      )}{" "}
      {recurring && (
        <Field
          name="recurring_start_date"
          label="First period starts (before first cycle)"
          type="date"
          required
          defaultValue={start}
        />
      )}
      <p className="muted">
        Bill completed cycles ending the day before the billing date. A final
        partial cycle is ready the day after departure. Enable only after
        checking the first period date; preparation is started from Invoices →
        Recurring billing. After the first saved cycle, periods continue from
        the last covered date.
      </p>
    </>
  );
}
