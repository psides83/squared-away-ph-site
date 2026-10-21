"use client";

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
        <select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="session">Training session</option>
          <option value="note">Progress note</option>
        </select>
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
