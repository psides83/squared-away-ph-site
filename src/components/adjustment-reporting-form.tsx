"use client";
import { useState, useActionState, startTransition } from "react";
import { saveAdjustmentReporting } from "@/app/admin/training/reporting-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { Field, Notice } from "@/components/ui";
import { money } from "@/lib/format";
import type { ReportingAdjustment } from "@/lib/package-reporting";
export function AdjustmentReportingForm({
  adjustment: a,
}: {
  adjustment: ReportingAdjustment;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [current] = useState(a.allocation?.id ?? "");
  const [state, action, pending] = useActionState(saveAdjustmentReporting, {});
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(() => action(f));
      }}
    >
      <Notice {...state} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input name="request_id" type="hidden" value={request} />
        <input name="adjustment_id" type="hidden" value={a.id} />
        <input name="current" type="hidden" value={current} />
        <p>
          Assign the full {money(Math.abs(a.amount_cents))}{" "}
          {a.amount_cents < 0 ? "reduction" : "increase"} manually. Enter
          positive portions, including explicit zeros. No proportions are
          suggested.
        </p>
        <div className="form-grid">
          {(
            [
              ["training", "Training"],
              ["feed", "Feed"],
              ["board", "Board"],
              ["other", "Other charges"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              name={key}
              label={`${label} ($)`}
              type="number"
              min="0"
              max={Math.abs(a.amount_cents) / 100}
              step="0.01"
              required
              defaultValue={
                a.allocation
                  ? (a.allocation[`${key}_cents`] / 100).toFixed(2)
                  : undefined
              }
            />
          ))}
        </div>
        <Field
          name="reason"
          label="Private allocation reason"
          required
          maxLength={2000}
        />
        <div className="form-actions">
          <ConfirmButton message="Save this manual reporting allocation? It will restate this invoice’s reporting split without changing money, charges or payments.">
            {pending ? "Saving…" : "Save allocation"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
