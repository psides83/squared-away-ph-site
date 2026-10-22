import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderStatus, reminderMoveDate } from "../src/lib/reminders.ts";
test("reminder urgency respects business-date boundaries and completed tasks stay in history", () => {
  assert.equal(
    reminderStatus(
      { due_date: "2026-10-21", completed_at: null },
      "2026-10-22",
    ),
    "overdue",
  );
  assert.equal(
    reminderStatus(
      { due_date: "2026-10-22", completed_at: null },
      "2026-10-22",
    ),
    "today",
  );
  assert.equal(
    reminderStatus(
      { due_date: "2026-10-23", completed_at: null },
      "2026-10-22",
    ),
    "upcoming",
  );
  assert.equal(
    reminderStatus(
      { due_date: "2026-10-21", completed_at: "2026-10-22T12:00:00Z" },
      "2026-10-22",
    ),
    "completed",
  );
});
test("reminder quick moves cross month, leap-day, year, and daylight-saving boundaries as calendar days", () => {
  assert.equal(reminderMoveDate("2026-12-31", 1), "2027-01-01");
  assert.equal(reminderMoveDate("2028-02-28", 1), "2028-02-29");
  assert.equal(reminderMoveDate("2026-02-28", 1), "2026-03-01");
  assert.equal(reminderMoveDate("2026-10-31", 7), "2026-11-07");
  assert.equal(reminderMoveDate("2026-03-07", 1), "2026-03-08");
});
