import { test } from "node:test";
import assert from "node:assert/strict";
import {
  phoneDisplay,
  phoneInput,
  servingStepper,
} from "../src/lib/input-format.ts";
test("US phones format consistently while international numbers and extensions stay intact", () => {
  assert.equal(phoneDisplay("1234567890"), "(123) 456-7890");
  assert.equal(phoneDisplay("+1 123 456 7890"), "(123) 456-7890");
  assert.equal(phoneInput("1234"), "(123) 4");
  assert.equal(phoneInput("(123) 4567"), "(123) 456-7");
  assert.equal(phoneInput("12"), "12");
  assert.equal(phoneInput("+44 20 1234 5678"), "+44 20 1234 5678");
  assert.equal(phoneInput("1234567890 ext 2"), "1234567890 ext 2");
  assert.equal(phoneDisplay("1234567890 ext 2"), "1234567890 ext 2");
  assert.equal(phoneDisplay("+44 12345678"), "+44 12345678");
  assert.equal(phoneDisplay(null), "");
});
test("serving controls are for countable units, not money or fixed weights", () => {
  for (const unit of ["scoop", "flakes", "bag", "bales", "cup", "tsp"])
    assert.equal(servingStepper(unit), true);
  for (const unit of ["lb", "g", "mg", "oz", "kg", "USD", ""])
    assert.equal(servingStepper(unit), false);
});
