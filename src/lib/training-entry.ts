import { choice, dateValue, identifier, text } from "./validation.ts";

export function trainingEntryValues(form: FormData) {
  const kind = choice(form, "kind", ["session", "note"]);
  const duration =
    kind === "session" ? text(form, "duration_minutes", false, 4) : null;
  if (
    duration &&
    (!/^\d+$/.test(duration) || Number(duration) < 1 || Number(duration) > 1440)
  ) {
    throw new Error(
      "Session duration must be a whole number from 1 to 1,440 minutes.",
    );
  }
  return {
    horse_id: identifier(form, "horse_id", true),
    kind,
    entry_date: dateValue(form, "entry_date", true),
    title: text(form, "title", true, 200),
    notes: text(form, "notes", true, 5000),
    duration_minutes: duration ? Number(duration) : null,
  };
}
