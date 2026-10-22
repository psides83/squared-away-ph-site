"use client";
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
        This assigns all current and future receipts on this invoice to one
        horse. An optional stay must match the horse and the invoice’s billing
        customer. Use horse-only when no stay applies. Multi-horse invoice
        receipt splits are not available yet.
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
          Training stay (optional)
          <select
            name="stay_id"
            value={stay}
            onChange={(e) => setStay(e.target.value)}
          >
            <option value="">Horse only / no stay</option>
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
        Reason
        <textarea name="reason" required maxLength={2000} rows={3} />
      </label>
      <SubmitButton>Save income assignment</SubmitButton>
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
        Split this horse’s {money(amount)} cost among its stays. Enter zero
        where none belongs. Any remainder stays assigned to the horse but
        unassigned to a stay. Choose the stay the cost actually belongs to, even
        if the expense was paid later.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Stay</th>
              <th>Assign ($)</th>
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
                      Amount for stay starting {s.arrival_date}
                    </span>
                    <input
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
          ? `${money(assigned)} assigned · ${money(amount - assigned)} unassigned to a stay`
          : "Enter dollar amounts with at most two decimal places."}
      </p>
      <label>
        Reason
        <textarea name="reason" required maxLength={2000} rows={3} />
      </label>
      <SubmitButton>Save stay cost split</SubmitButton>
    </form>
  );
}
