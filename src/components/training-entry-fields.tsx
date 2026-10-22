"use client";
import { AppSelect } from "@/components/app-select";

import { FormInput } from "@/components/form-input";
import { useState } from "react";
import { Field } from "@/components/ui";

export function TrainingEntryFields({
  initialKind,
  duration,
}: {
  initialKind: string;
  duration?: number | null;
}) {
  const [kind, setKind] = useState(initialKind);
  return (
    <>
      <label>
        Entry type <span className="required">*</span>
        <AppSelect
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="session">Training session</option>
          <option value="note">Progress note</option>
        </AppSelect>
      </label>
      {kind === "session" && (
        <Field
          label="Duration in minutes (optional)"
          name="duration_minutes"
          type="number"
          min={1}
          max={1440}
          step="1"
          defaultValue={duration}
        />
      )}
    </>
  );
}

export function TrainingFocusField({
  initialTitle = "",
  showShortcuts = true,
}: {
  initialTitle?: string;
  showShortcuts?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  return (
    <div className="training-focus-field">
      <label className="field">
        Focus / title <span className="required">*</span>
        <FormInput
          name="title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What did you work on?"
        />
      </label>
      {showShortcuts && (
        <div className="focus-shortcuts" aria-label="Common training focuses">
          {["Cow work", "Calf roping", "Colt starting", "Conditioning"].map(
            (focus) => (
              <button
                type="button"
                className="focus-chip"
                key={focus}
                onClick={() => setTitle(focus)}
              >
                {focus}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
