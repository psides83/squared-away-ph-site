import { cents, choice, text } from "./validation.ts";

export const settingsFields = [
  "business_phone",
  "business_email",
  "default_monthly_rate",
  "default_feed_monthly_rate",
  "default_boarding_monthly_rate",
  "default_billing_day",
  "default_proration",
  "default_invoice_due_days",
  "payment_instructions",
  "venmo_url",
  "paypal_url",
  "apple_cash_instructions",
] as const;
export type SettingsFormValues = Record<
  (typeof settingsFields)[number],
  string
>;
export type SettingsActionState = { error?: string; success?: string };

export function wholeNumber(
  form: FormData,
  name: string,
  min: number,
  max: number,
) {
  const value = text(form, name, true, 6)!;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
    throw new Error(
      `${name.replaceAll("_", " ")} must be a whole number from ${min} to ${max}.`,
    );
  return Number(value);
}
function paymentUrl(form: FormData, name: string) {
  const value = text(form, name, false, 500);
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Payment links must be complete HTTPS URLs.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error(
      "Payment links must use HTTPS and must not contain login credentials.",
    );
  return url.href;
}
export function businessSettingsValues(form: FormData) {
  const email = text(form, "business_email", false, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Please enter a valid business email address.");
  const rate = text(form, "default_monthly_rate", false, 12);
  return {
    business_phone: text(form, "business_phone", false, 50),
    business_email: email,
    default_monthly_rate_cents:
      rate === null ? null : cents(form, "default_monthly_rate"),
    default_feed_monthly_cents:
      text(form, "default_feed_monthly_rate", false, 12) === null
        ? null
        : cents(form, "default_feed_monthly_rate"),
    default_boarding_monthly_cents:
      text(form, "default_boarding_monthly_rate", false, 12) === null
        ? null
        : cents(form, "default_boarding_monthly_rate"),
    default_billing_day: wholeNumber(form, "default_billing_day", 1, 28),
    default_proration: choice(form, "default_proration", [
      "manual",
      "calendar_days",
      "none",
    ]),
    default_invoice_due_days: wholeNumber(
      form,
      "default_invoice_due_days",
      0,
      365,
    ),
    payment_instructions: text(form, "payment_instructions", false, 5000),
    venmo_url: paymentUrl(form, "venmo_url"),
    paypal_url: paymentUrl(form, "paypal_url"),
    apple_cash_instructions: text(form, "apple_cash_instructions", false, 2000),
  };
}

export type BusinessSettings = ReturnType<typeof businessSettingsValues>;
export type StayDefaults = {
  monthly_rate_cents: number;
  billing_day: number;
  proration: string;
  invoice_due_days: number | null;
};
export function stayFormDefaults(
  stay: StayDefaults | undefined,
  settings: BusinessSettings,
) {
  if (stay)
    return {
      monthlyRate: (stay.monthly_rate_cents / 100).toFixed(2),
      billingDay: stay.billing_day,
      proration: stay.proration,
      invoiceDueDays: stay.invoice_due_days ?? "",
    };
  return {
    monthlyRate:
      settings.default_monthly_rate_cents === null
        ? ""
        : (settings.default_monthly_rate_cents / 100).toFixed(2),
    billingDay: settings.default_billing_day,
    proration: settings.default_proration,
    invoiceDueDays: settings.default_invoice_due_days,
  };
}

export function settingsFormValues(
  settings: BusinessSettings,
): SettingsFormValues {
  return {
    business_phone: settings.business_phone ?? "",
    business_email: settings.business_email ?? "",
    default_monthly_rate:
      settings.default_monthly_rate_cents === null
        ? ""
        : (settings.default_monthly_rate_cents / 100).toFixed(2),
    default_feed_monthly_rate:
      settings.default_feed_monthly_cents == null
        ? ""
        : (settings.default_feed_monthly_cents / 100).toFixed(2),
    default_boarding_monthly_rate:
      settings.default_boarding_monthly_cents == null
        ? ""
        : (settings.default_boarding_monthly_cents / 100).toFixed(2),
    default_billing_day: String(settings.default_billing_day),
    default_proration: settings.default_proration,
    default_invoice_due_days: String(settings.default_invoice_due_days),
    payment_instructions: settings.payment_instructions ?? "",
    venmo_url: settings.venmo_url ?? "",
    paypal_url: settings.paypal_url ?? "",
    apple_cash_instructions: settings.apple_cash_instructions ?? "",
  };
}

export function stayServiceFormDefaults(
  stay:
    | {
        feed_billing: string;
        feed_monthly_cents: number | null;
        boarding_billing: string;
        boarding_monthly_cents: number | null;
      }
    | undefined,
  settings: BusinessSettings,
) {
  return stay
    ? {
        feedMode: stay.feed_billing,
        feedCents: stay.feed_monthly_cents,
        boardingMode: stay.boarding_billing,
        boardingCents: stay.boarding_monthly_cents,
      }
    : {
        feedMode:
          settings.default_feed_monthly_cents == null
            ? "unrecorded"
            : "separate_monthly",
        feedCents: settings.default_feed_monthly_cents ?? null,
        boardingMode:
          settings.default_boarding_monthly_cents == null
            ? "unrecorded"
            : "separate_monthly",
        boardingCents: settings.default_boarding_monthly_cents ?? null,
      };
}
