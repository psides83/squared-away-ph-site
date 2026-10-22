import { test } from "node:test";
import assert from "node:assert/strict";
import {
  businessSettingsValues,
  settingsFormValues,
  stayFormDefaults,
} from "../src/lib/business-settings.ts";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    default_monthly_rate: "1250.25",
    default_billing_day: "1",
    default_proration: "calendar_days",
    default_invoice_due_days: "0",
    business_phone: "",
    business_email: "",
    payment_instructions: "",
    venmo_url: "",
    paypal_url: "",
    apple_cash_instructions: "",
    ...overrides,
  }))
    data.set(name, value);
  return data;
}
test("business settings preserve an unset rate, zero rates, and exact cents", () => {
  assert.equal(
    businessSettingsValues(form()).default_monthly_rate_cents,
    125025,
  );
  assert.equal(
    businessSettingsValues(form({ default_monthly_rate: "" }))
      .default_monthly_rate_cents,
    null,
  );
  const free = businessSettingsValues(form({ default_monthly_rate: "0" }));
  assert.equal(free.default_monthly_rate_cents, 0);
  assert.equal(settingsFormValues(free).default_monthly_rate, "0.00");
});
test("settings reject invalid contacts, payment URLs, terms, and unsafe rates", () => {
  const invalid: Record<string, string>[] = [
    { business_email: "invalid" },
    { paypal_url: "javascript:alert(1)" },
    { venmo_url: "http://venmo.com/test" },
    { paypal_url: "https://user:password@example.com" },
    { default_billing_day: "32" },
    { default_invoice_due_days: "-1" },
    { default_invoice_due_days: "1.5" },
    { default_invoice_due_days: "366" },
    { default_proration: "anything" },
    { default_monthly_rate: "1.234" },
  ];
  for (const values of invalid)
    assert.throws(() => businessSettingsValues(form(values)));
});
test("new stays use settings while existing and legacy stays retain recorded values", () => {
  const settings = businessSettingsValues(
    form({ default_invoice_due_days: "14" }),
  );
  assert.deepEqual(stayFormDefaults(undefined, settings), {
    monthlyRate: "1250.25",
    billingDay: 1,
    proration: "calendar_days",
    invoiceDueDays: 14,
  });
  const existing = {
    monthly_rate_cents: 0,
    billing_day: 15,
    proration: "manual",
    invoice_due_days: 7,
  };
  assert.deepEqual(stayFormDefaults(existing, settings), {
    monthlyRate: "0.00",
    billingDay: 15,
    proration: "manual",
    invoiceDueDays: 7,
  });
  assert.equal(
    stayFormDefaults({ ...existing, invoice_due_days: null }, settings)
      .invoiceDueDays,
    "",
  );
});
