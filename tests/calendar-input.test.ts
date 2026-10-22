import { test } from "node:test";
import assert from "node:assert/strict";
import {
  temporalError,
  monthDays,
  shiftMonth,
} from "../src/lib/calendar-input.ts";
test("calendar text accepts actual dates and rejects normalized impossible dates", () => {
  for (const value of [
    "2024-02-29",
    "2000-02-29",
    "2026-12-31",
    "2026-03-08",
    "2026-11-01",
  ])
    assert.equal(temporalError(value, "date"), "");
  for (const value of [
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-1-1",
    "2026-02",
    "abc",
  ])
    assert.ok(temporalError(value, "date"));
  assert.equal(temporalError("", "date"), "");
});
test("date, month, and time pickers enforce inclusive bounds", () => {
  assert.equal(
    temporalError("2026-10-22", "date", "2026-10-22", "2026-10-22"),
    "",
  );
  assert.ok(temporalError("2026-10-21", "date", "2026-10-22"));
  assert.ok(temporalError("2026-10-23", "date", undefined, "2026-10-22"));
  assert.equal(temporalError("2026-10", "month", "2026-10", "2026-10"), "");
  assert.ok(temporalError("2026-09", "month", "2026-10"));
  assert.equal(temporalError("07:00", "time", "07:00", "19:00"), "");
  assert.ok(temporalError("06:59", "time", "07:00"));
});
test("clock and month text rejects malformed and out-of-range values", () => {
  for (const value of ["00:00", "07:00", "19:30", "23:59"])
    assert.equal(temporalError(value, "time"), "");
  for (const value of ["24:00", "12:60", "7:00", "19:1", "12:00 PM"])
    assert.ok(temporalError(value, "time"));
  for (const value of ["2026-00", "2026-13", "26-01", "2026-1"])
    assert.ok(temporalError(value, "month"));
});
test("calendar grids and month navigation handle leap years and year boundaries", () => {
  const leap = monthDays("2024-02");
  assert.equal(leap.filter(Boolean).length, 29);
  assert.equal(
    leap.slice(0, 4).every((v) => v === null),
    true,
  );
  assert.equal(leap.at(-1), "2024-02-29");
  assert.equal(monthDays("2026-02").filter(Boolean).length, 28);
  assert.equal(monthDays("2026-11")[0], "2026-11-01");
  assert.deepEqual(monthDays("invalid"), []);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2024-02", 12), "2025-02");
});
