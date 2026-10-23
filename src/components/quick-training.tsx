"use client";
import { startTransition, useActionState, useState } from "react";
import { logQuickTraining } from "@/app/admin/quick-actions";
import { Field, Notice } from "@/components/ui";
import { TrainingFocusField } from "@/components/training-entry-fields";
import { SubmitButton } from "@/components/submit-button";
export function QuickTraining({
  horses,
  date,
  request,
}: {
  horses: { id: string; barn_name: string }[];
  date: string;
  request: string;
}) {
  const [state, action, pending] = useActionState(logQuickTraining, {});
  const [selected, setSelected] = useState<string[]>(
    horses.length === 1 ? [horses[0].id] : [],
  );
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Notice error={state.error} success={state.success} />
      <fieldset disabled={pending || Boolean(state.success)} className="stack">
        <input type="hidden" name="request_id" value={request} />
        <input type="hidden" name="kind" value="session" />
        <p>
          Select only horses actually worked. These details create a separate
          private training entry for each selected horse; billing days are
          managed separately.
        </p>
        {horses.length > 1 && (
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setSelected(
                selected.length === horses.length
                  ? []
                  : horses.map((h) => h.id),
              )
            }
          >
            {selected.length === horses.length
              ? "Clear selection"
              : "Select all horses"}
          </button>
        )}
        <div className="batch-horse-list">
          {horses.map((h) => (
            <label className="batch-horse-row" key={h.id}>
              <strong>{h.barn_name}</strong>
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
        <div className="form-grid">
          <Field
            name="entry_date"
            label="Session date"
            type="date"
            defaultValue={date}
            max={date}
            required
          />
          <Field
            name="duration_minutes"
            label="Minutes per horse (optional)"
            type="number"
            min={1}
            max={1440}
            step="1"
          />
          <TrainingFocusField />
        </div>
        <label className="field quick-training-notes">
          <span className="field-label">Session notes</span>
          <textarea
            name="notes"
            required
            rows={3}
            maxLength={5000}
            placeholder="Work completed and progress observed. For different details, log horses individually."
          />
        </label>
        <div className="form-actions">
          {selected.length > 0 ? (
            <SubmitButton>
              Save training for {selected.length}{" "}
              {selected.length === 1 ? "horse" : "horses"}
            </SubmitButton>
          ) : (
            <p className="muted">Select a horse to continue.</p>
          )}
        </div>
      </fieldset>
    </form>
  );
}
