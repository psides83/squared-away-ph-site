import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  dateValue,
  choice,
  identifier,
  text,
} from "../src/lib/validation.ts";

function form(key: string, value: string) {
  const data = new FormData();
  data.set(key, value);
  return data;
}

test("rates preserve exact cents including zero and single-decimal values", () => {
  for (const [input, expected] of [
    ["0", 0],
    ["0.29", 29],
    ["1250.5", 125050],
    ["1000000", 100000000],
  ] as const)
    assert.equal(cents(form("rate", input), "rate"), expected);
});
test("rates reject negative, malformed, over-precise, and excessive amounts", () => {
  for (const value of ["-1", "1.999", "NaN", "1e3", "1,200", "1000000.01", ""])
    assert.throws(() => cents(form("rate", value), "rate"));
});
test("dates reject impossible calendar dates while accepting leap days", () => {
  assert.equal(
    dateValue(form("date", "2028-02-29"), "date", true),
    "2028-02-29",
  );
  for (const value of [
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "10/21/2026",
    "",
  ])
    assert.throws(() => dateValue(form("date", value), "date", true));
  assert.equal(dateValue(form("date", ""), "date"), null);
});
test("foreign record IDs and enum values reject arbitrary input", () => {
  assert.throws(() => identifier(form("id", "other-record"), "id", true));
  assert.throws(() =>
    choice(form("sex", "unexpected"), "sex", ["mare", "gelding"]),
  );
  assert.equal(identifier(form("id", ""), "id"), null);
});
test("required and bounded text is validated on the server", () => {
  assert.equal(text(form("name", "  Dusty  "), "name", true), "Dusty");
  assert.throws(() => text(form("name", "  "), "name", true));
  assert.throws(() => text(form("name", "long"), "name", true, 3));
});
