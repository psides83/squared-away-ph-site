"use client";
import { AppSelect } from "@/components/app-select";

import { SectionTabs } from "@/components/section-tabs";
import { FormInput } from "@/components/form-input";
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
    <label className={`field field-${options.type ?? "text"}`}>
      <span className="field-label">
        {options.type === "number" ? label.replace(/\s*\(\$\)/g, "") : label}
        {options.required && <span className="required"> *</span>}
      </span>
      <FormInput
        aria-label={label}
        prefix={
          options.type === "number" && options.step === "0.01" ? "$" : undefined
        }
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
        <SectionTabs
          id="settings"
          label="Business settings sections"
          sections={[
            {
              id: "contact",
              label: "Contact",
              content: (
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
                      Store the contact information to use on future invoices
                      and public pages. Leave fields blank until you’re ready.
                    </p>
                  </div>
                </section>
              ),
            },
            {
              id: "billing",
              label: "Training & billing",
              content: (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">
                        A STARTING POINT, NOT A LOCKED RATE
                      </p>
                      <h2>Training, feed, board & payment defaults</h2>
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
                      {field(
                        "default_feed_monthly_rate",
                        "Default monthly feed charge ($)",
                        {
                          type: "number",
                          min: 0,
                          max: 1000000,
                          step: "0.01",
                          placeholder: "Not set",
                        },
                      )}
                      {field(
                        "default_boarding_monthly_rate",
                        "Default monthly board charge ($)",
                        {
                          type: "number",
                          min: 0,
                          max: 1000000,
                          step: "0.01",
                          placeholder: "Not set",
                        },
                      )}
                      {field(
                        "default_billing_day",
                        "Default custom billing day (1–31)",
                        {
                          type: "number",
                          min: 1,
                          max: 31,
                          step: "1",
                          required: true,
                        },
                      )}
                      <label>
                        Default partial-month policy
                        <AppSelect
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
                        </AppSelect>
                      </label>
                      {field(
                        "default_invoice_due_days",
                        "Payment due within days (0 = upon receipt)",
                        {
                          type: "number",
                          min: 0,
                          max: 365,
                          step: "1",
                          required: true,
                        },
                      )}
                    </div>
                    <p className="muted form-hint">
                      New training stays start with these defaults and can be
                      adjusted individually. A feed or board charge starts a new
                      stay with that separate monthly rate; you can choose
                      included or actual-cost billing instead. Existing stays
                      keep their recorded terms. These customer charges do not
                      record business expenses.
                    </p>
                  </div>
                </section>
              ),
            },
            {
              id: "payments",
              label: "Payment methods",
              content: (
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
                    {notes(
                      "apple_cash_instructions",
                      "Apple Cash instructions",
                      2000,
                    )}
                    <p className="muted form-hint">
                      These instructions appear on finalized invoices. No
                      payment is collected or confirmed here.
                    </p>
                  </div>
                </section>
              ),
            },
          ]}
        />
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
