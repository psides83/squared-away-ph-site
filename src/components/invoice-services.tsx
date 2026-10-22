import Link from "next/link";
import { dateLabel, money } from "@/lib/format";
import { SubmitButton } from "@/components/submit-button";
import { invoiceAction } from "@/app/admin/invoices/actions";
type BoardingSource = {
  split_id: string;
  vendor: string | null;
  expense_date: string;
  amount_cents: number;
  kind: string;
};
export function InvoiceServices({
  invoice,
  stay,
  options,
}: {
  invoice: string;
  stay: { feed_billing: string; boarding_billing: string };
  options: {
    feed: { count: number; amount_cents: number };
    boarding: BoardingSource[];
  } | null;
}) {
  const hidden = <input name="invoice_id" type="hidden" value={invoice} />;
  return (
    <>
      <div className="separated">
        <h3>Feed billing</h3>
        {stay.feed_billing === "separate_monthly" ? (
          <form action={invoiceAction.bind(null, "monthly-feed")}>
            {hidden}
            <SubmitButton>Generate monthly feed</SubmitButton>
            <p className="muted">
              Recorded monthly feed rate × every physical boarding day ÷ days in
              that calendar month. Requires one elapsed calendar-month period.
            </p>
          </form>
        ) : stay.feed_billing === "at_cost" ? (
          <form action={invoiceAction.bind(null, "actual-feed")}>
            {hidden}
            <p>
              {options?.feed.count ?? 0} unbilled feeding records in this period
              · {money(Number(options?.feed.amount_cents ?? 0))} at saved
              weighted cost. Only actual consumption counts; purchases and waste
              do not. Reversed feeding is excluded. Costs are summed before
              rounding once to cents.
            </p>
            <SubmitButton>Add actual feed consumption cost</SubmitButton>
          </form>
        ) : (
          <p>
            {stay.feed_billing === "included"
              ? "Feed is included; no separate service line is generated."
              : stay.feed_billing === "not_provided"
                ? "Feed is not provided."
                : "Record the feed agreement on the training stay before generating a service charge."}
          </p>
        )}
      </div>
      <div className="separated">
        <h3>Boarding billing</h3>
        {stay.boarding_billing === "separate_monthly" ? (
          <form action={invoiceAction.bind(null, "monthly-boarding")}>
            {hidden}
            <SubmitButton>Generate monthly boarding</SubmitButton>
            <p className="muted">
              Recorded monthly boarding rate × every physical boarding day ÷
              days in that calendar month. Requires one elapsed calendar-month
              period.
            </p>
          </form>
        ) : stay.boarding_billing === "at_cost" ? (
          <form action={invoiceAction.bind(null, "actual-boarding")}>
            {hidden}
            <label>
              Reviewed stay cost
              <select name="split_id" required defaultValue="">
                <option value="" disabled>
                  Select a boarding cost
                </option>
                {options?.boarding.map((c) => (
                  <option value={c.split_id} key={c.split_id}>
                    {dateLabel(c.expense_date)} · {c.vendor ?? "Provider"} ·{" "}
                    {money(c.amount_cents)} · {c.kind}
                  </option>
                ))}
              </select>
            </label>
            <p className="notice">
              Select only the portion that belongs to boarding for this invoice
              period. This list uses your stay cost assignments and is not
              automatically filtered by expense date. Do not select feed
              purchases recovered through consumed feed, or unrelated
              vet/farrier costs.{" "}
              <Link href="/admin/attribution">Review cost assignments</Link>{" "}
              first.
            </p>
            <SubmitButton>Add selected boarding cost</SubmitButton>
          </form>
        ) : (
          <p>
            {stay.boarding_billing === "included"
              ? "Boarding is included; no separate service line is generated."
              : stay.boarding_billing === "not_provided"
                ? "Boarding is not provided."
                : "Record the boarding agreement on the training stay before generating a service charge."}
          </p>
        )}
      </div>
    </>
  );
}
export type ServiceSnapshot = {
  basis: string;
  monthly_rate_cents?: number;
  boarding_days?: number;
  calendar_days?: number;
  period_from: string;
  period_to: string;
  sources?: {
    movement_id: string;
    date: string;
    product: string;
    quantity: number;
    unit: string;
    cost_cents: number;
  }[];
};
export function InvoiceServiceDetail({
  snapshot,
}: {
  snapshot: ServiceSnapshot;
}) {
  const exactCost = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(Number(value) / 100);
  return (
    <>
      <small className="cell-secondary">
        {snapshot.basis === "physical_days"
          ? `${money(snapshot.monthly_rate_cents ?? 0)} × ${snapshot.boarding_days} physical boarding days ÷ ${snapshot.calendar_days}; rounded once to cents.`
          : snapshot.basis === "consumption"
            ? "Saved weighted consumption costs, summed and rounded once to cents."
            : "Reviewed stay cost at its recorded amount."}{" "}
        {dateLabel(snapshot.period_from)} – {dateLabel(snapshot.period_to)}
      </small>
      {snapshot.basis === "consumption" && (
        <details>
          <summary>Feed cost sources</summary>
          {snapshot.sources?.map((r) => (
            <p key={r.movement_id}>
              {dateLabel(r.date)} · {r.product} · {r.quantity} {r.unit} ·{" "}
              {exactCost(r.cost_cents)}
            </p>
          ))}
        </details>
      )}
    </>
  );
}
