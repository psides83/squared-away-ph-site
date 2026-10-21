import { test } from "node:test";
import assert from "node:assert/strict";
import { trainingEntryValues } from "../src/lib/training-entry.ts";

function entry(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    horse_id: "10000000-0000-4000-8000-000000000001",
    kind: "session",
    entry_date: "2026-10-21",
    title: "Rating cattle",
    notes: "Quieter through the turn.",
    duration_minutes: "40",
    ...overrides,
  }))
    form.set(name, value);
  return form;
}
test("training entries record optional duration only for sessions", () => {
  assert.equal(trainingEntryValues(entry()).duration_minutes, 40);
  assert.equal(
    trainingEntryValues(entry({ duration_minutes: "" })).duration_minutes,
    null,
  );
  assert.equal(
    trainingEntryValues(entry({ kind: "note" })).duration_minutes,
    null,
  );
});
test("training entries validate actual dates, linked horses, notes, and whole-minute durations", () => {
  const invalidCases: Record<string, string>[] = [
    { duration_minutes: "0" },
    { duration_minutes: "1441" },
    { duration_minutes: "1.5" },
    { duration_minutes: "1e2" },
    { horse_id: "" },
    { horse_id: "invalid" },
    { notes: " " },
    { title: "" },
    { entry_date: "2026-02-30" },
    { kind: "public_update" },
  ];
  for (const overrides of invalidCases)
    assert.throws(() => trainingEntryValues(entry(overrides)));
});
