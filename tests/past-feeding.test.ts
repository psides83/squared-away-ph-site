import { test } from "node:test";
import assert from "node:assert/strict";
import {
  feedingDate,
  previousFeedingDay,
  missedFeedingDate,
  feedingResultUrl,
} from "../src/lib/past-feeding.ts";
test("past feeding dates default to yesterday across month, leap-year and year boundaries and reject future/invalid days", () => {
  assert.equal(missedFeedingDate(undefined, "2026-10-26"), "2026-10-25");
  assert.equal(previousFeedingDay("2024-03-01"), "2024-02-29");
  assert.equal(previousFeedingDay("2026-01-01"), "2025-12-31");
  assert.equal(missedFeedingDate("2026-10-26", "2026-10-26"), "2026-10-26");
  for (const date of ["2026-02-30", "2026-10-27", "bad", "0000-01-01", ""])
    assert.throws(
      () => missedFeedingDate(date, "2026-10-26"),
      /actual feeding date/,
    );
  assert.equal(feedingDate("2026-10-25"), "2026-10-25");
});
test("past feeding save/error navigation preserves the chosen day and extras tab without permitting arbitrary redirects", () => {
  const success = new URL(
    feedingResultUrl("past-feeding", "2026-10-12", undefined, false),
    "https://example.test",
  );
  assert.equal(success.pathname, "/admin/feeding/past");
  assert.equal(success.searchParams.get("date"), "2026-10-12");
  assert.match(success.searchParams.get("success")!, /not deducted again/);
  const error = new URL(
    feedingResultUrl("past-feeding", "2026-10-12", "Not enough stock", true),
    "https://example.test",
  );
  assert.equal(error.searchParams.get("date"), "2026-10-12");
  assert.equal(error.searchParams.get("error"), "Not enough stock");
  assert.equal(error.hash, "#past-feeding-extras");
  assert.equal(
    new URL(
      feedingResultUrl("https://evil.test", "bad", undefined, false),
      "https://example.test",
    ).pathname,
    "/admin/feeding",
  );
  assert.equal(
    new URL(
      feedingResultUrl("home", "2026-10-12", undefined, false),
      "https://example.test",
    ).pathname,
    "/admin",
  );
});
