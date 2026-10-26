export type CashLedgerRow = {
  cash_date: string;
  kind:
    "advance" | "payment" | "expense" | "supplier_refund" | "customer_refund";
  source_id: string;
  related_id: string | null;
  party: string | null;
  category: string | null;
  invoice_number: string | null;
  method: string | null;
  reference: string | null;
  cash_in_cents: number;
  cash_out_cents: number;
  gross_expense_cents: number;
  credit_cents: number;
};
export type CashLedgerExport = {
  from: string;
  to: string;
  currency: "USD";
  generated_at: string;
  row_count: number;
  rows: CashLedgerRow[];
  totals: {
    received_cents: number;
    spent_cents: number;
    supplier_refunds_cents: number;
    customer_refunds_cents: number;
    supplier_credit_used_cents: number;
    net_cents: number;
  };
};
export function validCashExportPeriod(from: string, to: string) {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value.slice(0, 4) !== "0000" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  return (
    valid(from) &&
    valid(to) &&
    from <= to &&
    Date.parse(to) - Date.parse(from) <= 3660 * 86400000
  );
}
/** Quote all text and neutralize spreadsheet formulas, including whitespace prefixes. */
export function csvText(value: string | null) {
  const text = (value ?? "").replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    "",
  );
  const safe =
    /^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
function decimal(cents: number) {
  if (!Number.isSafeInteger(cents))
    throw Error("Invalid cash amount in export.");
  return `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}
const labels = {
  payment: "Customer payment",
  advance: "Customer advance payment",
  expense: "Paid expense",
  supplier_refund: "Supplier refund",
  customer_refund: "Customer refund",
};
export function cashLedgerCsv(data: CashLedgerExport) {
  if (
    !validCashExportPeriod(data.from, data.to) ||
    data.currency !== "USD" ||
    !Array.isArray(data.rows) ||
    data.row_count !== data.rows.length ||
    data.rows.length > 10000
  )
    throw Error("The cash export could not be verified.");
  const totals = {
    received_cents: 0,
    spent_cents: 0,
    supplier_refunds_cents: 0,
    customer_refunds_cents: 0,
    supplier_credit_used_cents: 0,
    net_cents: 0,
  };
  const rows = data.rows.map((row) => {
    if (
      !Object.hasOwn(labels, row.kind) ||
      row.cash_date < data.from ||
      row.cash_date > data.to ||
      !validCashExportPeriod(row.cash_date, row.cash_date)
    )
      throw Error("Invalid cash activity in export.");
    for (const value of [
      row.cash_in_cents,
      row.cash_out_cents,
      row.gross_expense_cents,
      row.credit_cents,
    ])
      if (!Number.isSafeInteger(value) || value < 0)
        throw Error("Invalid cash amount in export.");
    totals.received_cents +=
      row.kind === "payment" || row.kind === "advance" ? row.cash_in_cents : 0;
    totals.spent_cents += row.kind === "expense" ? row.cash_out_cents : 0;
    totals.supplier_refunds_cents +=
      row.kind === "supplier_refund" ? row.cash_in_cents : 0;
    totals.customer_refunds_cents +=
      row.kind === "customer_refund" ? row.cash_out_cents : 0;
    totals.supplier_credit_used_cents += row.credit_cents;
    totals.net_cents += row.cash_in_cents - row.cash_out_cents;
    return [
      row.cash_date,
      labels[row.kind],
      row.party,
      row.category,
      row.invoice_number,
      row.method?.replaceAll("_", " ") ?? null,
      row.reference,
    ]
      .map(csvText)
      .concat([
        decimal(row.cash_in_cents),
        decimal(row.cash_out_cents),
        decimal(row.cash_in_cents - row.cash_out_cents),
        decimal(row.gross_expense_cents),
        decimal(row.credit_cents),
        csvText(row.source_id),
        csvText(row.related_id),
      ])
      .join(",");
  });
  for (const key of Object.keys(totals) as (keyof typeof totals)[])
    if (!Number.isSafeInteger(totals[key]) || totals[key] !== data.totals[key])
      throw Error("Cash export totals do not reconcile.");
  const header = [
    "Cash date",
    "Activity",
    "Customer or supplier",
    "Expense category",
    "Invoice number",
    "Payment method",
    "Reference",
    "Cash in (USD)",
    "Cash out (USD)",
    "Net cash (USD)",
    "Gross expense (USD)",
    "Store credit applied (USD)",
    "Source record ID",
    "Related invoice or return ID",
  ]
    .map(csvText)
    .join(",");
  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}
