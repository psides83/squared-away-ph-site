import { money, dateLabel } from "@/lib/format";
export type PublicAccountCredit = {
  id: string;
  event_date: string;
  amount_cents: number;
  kind: "applied" | "transferred";
  reversed: boolean;
};
export function InvoiceCreditSummary({
  rows,
}: {
  rows: PublicAccountCredit[];
}) {
  if (!rows.length) return null;
  return (
    <div className="invoice-notes">
      <h3>Account credit history</h3>
      {rows.map((r) => (
        <p key={r.id}>
          {dateLabel(r.event_date)} · {money(r.amount_cents)} ·{" "}
          {r.kind === "applied"
            ? "Account credit applied"
            : "Moved to customer account credit"}
          {r.reversed ? " · Record reversed" : ""}
        </p>
      ))}
    </div>
  );
}
