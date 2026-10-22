"use client";
import { FormInput } from "@/components/form-input";
import { useState } from "react";
import { dateLabel, money } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import { reportingAction } from "@/app/admin/attribution/actions";
export type ReportingStay = {
  id: string;
  horse_id: string;
  billing_customer_id: string;
  arrival_date: string;
  departure_date: string | null;
  customer_name?: string;
};
export function InvoiceReportingForm({
  invoice,
  customer,
  horses,
  stays,
  current,
  request,
}: {
  invoice: string;
  customer: string;
  horses: { id: string; barn_name: string }[];
  stays: ReportingStay[];
  current?: { horse_id: string; stay_id: string | null };
  request: string;
}) {
  const [horse, setHorse] = useState(current?.horse_id ?? "");
  const [stay, setStay] = useState(current?.stay_id ?? "");
  return (
    <form
      action={reportingAction.bind(null, "invoice")}
      className="record-form"
    >
      <input name="request_id" type="hidden" value={request} />
      <input name="invoice_id" type="hidden" value={invoice} />
      <p>
        Choose the horse this invoice was for. Its payments will count as income
        for that horse. You can also choose a training visit for the same horse
        and billing customer. One invoice can currently be matched to one horse.
      </p>
      <div className="form-grid">
        <label>
          Horse
          <select
            name="horse_id"
            required
            value={horse}
            onChange={(e) => {
              setHorse(e.target.value);
              setStay("");
            }}
          >
            <option value="" disabled>
              Select a horse
            </option>
            {horses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.barn_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Training visit (optional)
          <select
            name="stay_id"
            value={stay}
            onChange={(e) => setStay(e.target.value)}
          >
            <option value="">Horse only — no particular visit</option>
            {stays
              .filter(
                (s) =>
                  s.horse_id === horse && s.billing_customer_id === customer,
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {dateLabel(s.arrival_date)} –{" "}
                  {s.departure_date ? dateLabel(s.departure_date) : "ongoing"}
                </option>
              ))}
          </select>
        </label>
      </div>
      <label>
        Why does this belong here?
        <textarea name="reason" required maxLength={2000} rows={3} />
      </label>
      <SubmitButton>Save horse match</SubmitButton>
    </form>
  );
}
export function CostStayForm({
  expense,
  horse,
  allocation,
  amount,
  stays,
  current,
  request,
}: {
  expense: string;
  horse: string;
  allocation: string | null;
  amount: number;
  stays: ReportingStay[];
  current?: { stay_id: string; amount_cents: number }[];
  request: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      stays.map((s) => [
        s.id,
        (
          (current?.find((r) => r.stay_id === s.id)?.amount_cents ?? 0) / 100
        ).toFixed(2),
      ]),
    ),
  );
  const valid = Object.values(values).every((v) => /^\d+(\.\d{1,2})?$/.test(v));
  const assigned = Object.values(values).reduce(
    (sum, v) => sum + Math.round(Number(v) * 100),
    0,
  );
  return (
    <form action={reportingAction.bind(null, "cost")} className="record-form">
      <input name="request_id" type="hidden" value={request} />
      <input name="expense_id" type="hidden" value={expense} />
      <input name="horse_id" type="hidden" value={horse} />
      <input name="allocation_id" type="hidden" value={allocation ?? ""} />
      <p>
        This expense already counts toward the horse’s total costs. Enter how
        much of the {money(amount)} belongs to each training visit below. Put
        the full amount against one visit, or divide it between visits. Leave
        other visits at $0.00. Any amount left over stays in the horse’s report
        without being tied to a visit.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Training visit</th>
              <th>Cost for this visit ($)</th>
            </tr>
          </thead>
          <tbody>
            {stays.map((s) => (
              <tr key={s.id}>
                <td>
                  {dateLabel(s.arrival_date)} –{" "}
                  {s.departure_date ? dateLabel(s.departure_date) : "ongoing"}
                  <small className="cell-secondary">{s.customer_name}</small>
                </td>
                <td>
                  <label>
                    <span className="sr-only">
                      Cost for visit starting {s.arrival_date}
                    </span>
                    <FormInput
                      prefix="$"
                      name={`amount_${s.id}`}
                      type="number"
                      required
                      min="0"
                      max={amount / 100}
                      step="0.01"
                      value={values[s.id]}
                      onChange={(e) =>
                        setValues({ ...values, [s.id]: e.target.value })
                      }
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={!valid || assigned > amount ? "notice error" : "notice"}>
        {valid
          ? `${money(assigned)} matched to visits · ${money(amount - assigned)} left without a visit`
          : "Enter dollar amounts with at most two decimal places."}
      </p>
      <label>
        Why does this belong here?
        <textarea name="reason" required maxLength={2000} rows={3} />
      </label>
      <SubmitButton>Save visit amounts</SubmitButton>
    </form>
  );
}
