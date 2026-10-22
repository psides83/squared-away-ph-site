"use client";
import { useState } from "react";
import { dateLabel } from "@/lib/format";
export function InvoiceOriginFields({
  customers,
  stays,
  horses,
  date,
  defaultDueDays,
  initialCustomer = "",
}: {
  initialCustomer?: string;
  customers: { id: string; name: string }[];
  stays: {
    id: string;
    horse_id: string;
    billing_customer_id: string;
    arrival_date: string;
    invoice_due_days: number | null;
  }[];
  horses: { id: string; barn_name: string }[];
  date: string;
  defaultDueDays: number;
}) {
  const [customer, setCustomer] = useState(initialCustomer);
  const [stay, setStay] = useState("");
  const [issue, setIssue] = useState(date);
  const dueFor = (value: string, days: number | null) =>
    days === null || !value
      ? ""
      : new Date(Date.parse(value) + days * 86400000)
          .toISOString()
          .slice(0, 10);
  const [due, setDue] = useState(dueFor(date, defaultDueDays));
  const termsFor = (id: string) =>
    id
      ? (stays.find((s) => s.id === id)?.invoice_due_days ?? null)
      : defaultDueDays;
  return (
    <>
      <label>
        Billing customer <span className="required">*</span>
        <select
          name="customer_id"
          required
          value={customer}
          onChange={(e) => {
            setCustomer(e.target.value);
            setStay("");
            setDue(dueFor(issue, defaultDueDays));
          }}
        >
          <option value="" disabled>
            Select a customer
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Training stay (optional)
        <select
          name="stay_id"
          value={stay}
          onChange={(e) => {
            setStay(e.target.value);
            setDue(dueFor(issue, termsFor(e.target.value)));
          }}
        >
          <option value="">Manual invoice / no training stay</option>
          {stays
            .filter((s) => s.billing_customer_id === customer)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {horses.find((h) => h.id === s.horse_id)?.barn_name ?? "Horse"}{" "}
                · arrived {dateLabel(s.arrival_date)}
              </option>
            ))}
        </select>
      </label>
      <label>
        Invoice date <span className="required">*</span>
        <input
          name="issue_date"
          type="date"
          required
          value={issue}
          onChange={(e) => {
            setIssue(e.target.value);
            setDue(dueFor(e.target.value, termsFor(stay)));
          }}
        />
      </label>
      <label>
        Payment due date <span className="required">*</span>
        <input
          name="due_date"
          type="date"
          required
          min={issue}
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <span className="muted form-hint">
          {stay && termsFor(stay) === null
            ? "This legacy stay has no recorded payment terms. Choose the due date explicitly."
            : "Starts from the stay’s recorded terms, or business defaults for a manual invoice. Review before saving."}
        </span>
      </label>
    </>
  );
}
