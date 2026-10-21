"use client";

import { useActionState, useState } from "react";
import { saveBusinessSettings } from "@/app/admin/settings/actions";
import { type SettingsFormValues } from "@/lib/business-settings";
import { Notice } from "@/components/ui";

export function BusinessSettingsForm({
  initialValues,
}: {
  initialValues: SettingsFormValues;
}) {
  const [values, setValues] = useState(initialValues);
  const [state, action, pending] = useActionState(saveBusinessSettings, {});
  const field = (
    name: keyof SettingsFormValues,
    label: string,
    options: {
      type?: string;
      maxLength?: number;
      min?: number;
      max?: number;
      step?: string;
      required?: boolean;
      placeholder?: string;
    } = {},
  ) => (
    <label>
      {label}
      {options.required && <span className="required"> *</span>}
      <input
        name={name}
        value={values[name]}
        onChange={(event) =>
          setValues((current) => ({ ...current, [name]: event.target.value }))
        }
        type={options.type ?? "text"}
        maxLength={options.maxLength ?? 200}
        min={options.min}
        max={options.max}
        step={options.step}
        required={options.required}
        placeholder={options.placeholder}
      />
    </label>
  );
  const notes = (
    name: keyof SettingsFormValues,
    label: string,
    maxLength: number,
  ) => (
    <label>
      {label}
      <textarea
        name={name}
        rows={3}
        value={values[name]}
        onChange={(event) =>
          setValues((current) => ({ ...current, [name]: event.target.value }))
        }
        maxLength={maxLength}
      />
    </label>
  );
  return (
    <form action={action} className="settings-form">
      <Notice error={state.error} success={state.success} />
      <fieldset disabled={pending} className="settings-fieldset">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">HOW CUSTOMERS REACH YOU</p>
              <h2>Business contact</h2>
            </div>
          </div>
          <div className="record-form">
            <div className="form-grid">
              {field("business_phone", "Public phone number", {
                type: "tel",
                maxLength: 50,
              })}
              {field("business_email", "Public email address", {
                type: "email",
                maxLength: 254,
              })}
            </div>
            <p className="muted form-hint">
              Store the contact information to use on future invoices and public
              pages. Leave fields blank until you’re ready.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">A STARTING POINT, NOT A LOCKED RATE</p>
              <h2>Training & payment defaults</h2>
            </div>
          </div>
          <div className="record-form">
            <div className="form-grid">
              {field(
                "default_monthly_rate",
                "Default monthly training rate ($)",
                {
                  type: "number",
                  min: 0,
                  max: 1000000,
                  step: "0.01",
                  placeholder: "Not set",
                },
              )}
              {field("default_billing_day", "Default billing day (1–28)", {
                type: "number",
                min: 1,
                max: 28,
                step: "1",
                required: true,
              })}
              <label>
                Default partial-month policy
                <select
                  name="default_proration"
                  value={values.default_proration}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      default_proration: event.target.value,
                    }))
                  }
                >
                  <option value="calendar_days">
                    Prorate using calendar days
                  </option>
                  <option value="manual">Decide manually</option>
                  <option value="none">No proration</option>
                </select>
              </label>
              {field(
                "default_invoice_due_days",
                "Payment due within days (0 = upon receipt)",
                { type: "number", min: 0, max: 365, step: "1", required: true },
              )}
            </div>
            <p className="muted form-hint">
              New training stays start with these defaults and can be adjusted
              individually. Existing stays keep their recorded terms. Invoice
              creation and worked/rest-day billing calculations are still being
              built.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">MAKE IT EASY TO SETTLE UP</p>
              <h2>Payment instructions</h2>
            </div>
          </div>
          <div className="record-form">
            {notes(
              "payment_instructions",
              "General payment instructions",
              5000,
            )}
            <div className="form-grid">
              {field("venmo_url", "Venmo payment link", {
                type: "url",
                maxLength: 500,
                placeholder: "https://…",
              })}
              {field("paypal_url", "PayPal payment link", {
                type: "url",
                maxLength: 500,
                placeholder: "https://…",
              })}
            </div>
            {notes("apple_cash_instructions", "Apple Cash instructions", 2000)}
            <p className="muted form-hint">
              These are saved instructions for the upcoming billing screens. No
              payment is collected or confirmed here.
            </p>
          </div>
        </section>
        <div className="settings-save">
          <button className="button" type="submit" disabled={pending}>
            {pending ? "Saving settings…" : "Save settings"}
          </button>
          <span className="muted form-hint">
            Only your administrator account can change these settings.
          </span>
        </div>
      </fieldset>
    </form>
  );
}
