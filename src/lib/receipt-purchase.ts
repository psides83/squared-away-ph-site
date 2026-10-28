import { cents, choice, dateValue, identifier, text } from "./validation.ts";
import { quantity } from "./inventory.ts";
export type ReceiptItemDraft = {
  id: string;
  kind: "inventory" | "expense";
  description: string;
  product_id: string;
  unit_id: string;
  quantity: string;
  subtotal: string;
  discount: string;
  tax: string;
  discountEligible: boolean;
  taxEligible: boolean;
};
export function moneyCents(value: string) {
  const f = new FormData();
  f.set("amount", value);
  return cents(f, "amount");
}
export function allocateReceiptCents(total: number, weights: number[]) {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    total > 100000000 ||
    weights.some((w) => !Number.isSafeInteger(w) || w < 0 || w > 100000000)
  )
    throw Error("Review adjustment amounts and item subtotals.");
  const sum = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (!total) return weights.map(() => 0);
  if (!sum)
    throw Error(
      "Select eligible items with a positive subtotal, or enter allocations manually.",
    );
  const shares = weights.map((w, i) => ({
    i,
    cents: Number((BigInt(total) * BigInt(w)) / sum),
    remainder: (BigInt(total) * BigInt(w)) % sum,
  }));
  let remaining = total - shares.reduce((s, v) => s + v.cents, 0);
  for (const share of [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.i - b.i
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (!remaining) break;
    share.cents++;
    remaining--;
  }
  return shares.map((v) => v.cents);
}
export function suggestReceiptAllocations(
  items: ReceiptItemDraft[],
  discount: number,
  tax: number,
) {
  const bases = items.map((i) => moneyCents(i.subtotal));
  const weights = bases.map((v, i) => (items[i].discountEligible ? v : 0));
  if (discount > weights.reduce((a, b) => a + b, 0))
    throw Error("Discount exceeds eligible item subtotals.");
  const discounts = allocateReceiptCents(discount, weights);
  const taxes = allocateReceiptCents(
    tax,
    bases.map((v, i) => (items[i].taxEligible ? v - discounts[i] : 0)),
  );
  return items.map((item, i) => ({
    ...item,
    discount: (discounts[i] / 100).toFixed(2),
    tax: (taxes[i] / 100).toFixed(2),
  }));
}
export function receiptPurchaseValues(form: FormData) {
  if (form.get("reviewed") !== "on")
    throw Error("Review the item allocations and receipt total before saving.");
  const raw = JSON.parse(text(form, "items", true, 50000)!);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20)
    throw Error("Enter 1 to 20 receipt items.");
  const lines = raw.map((row: ReceiptItemDraft) => {
    if (!row || typeof row !== "object") throw Error("Invalid receipt item.");
    const f = new FormData();
    for (const key of [
      "id",
      "kind",
      "description",
      "product_id",
      "unit_id",
      "quantity",
      "subtotal",
      "discount",
      "tax",
    ] as const) {
      if (typeof row[key] !== "string") throw Error("Invalid receipt item.");
      f.set(key, row[key]);
    }
    const kind = choice(f, "kind", ["inventory", "expense"]);
    const subtotal = cents(f, "subtotal"),
      discount = cents(f, "discount"),
      tax = cents(f, "tax");
    if (discount > subtotal)
      throw Error("An item discount exceeds its subtotal.");
    return {
      id: identifier(f, "id", true),
      kind,
      description: text(f, "description", true, 200),
      product_id:
        kind === "inventory" ? identifier(f, "product_id", true) : null,
      unit_id: kind === "inventory" ? identifier(f, "unit_id", true) : null,
      quantity: kind === "inventory" ? quantity(f) : null,
      subtotal_cents: subtotal,
      discount_cents: discount,
      tax_cents: tax,
      discount_eligible: row.discountEligible === true,
      tax_eligible: row.taxEligible === true,
    };
  });
  if (new Set(lines.map((l) => l.id)).size !== lines.length)
    throw Error("Receipt items must have unique identifiers.");
  const header = {
    expense_date: dateValue(form, "expense_date", true),
    paid_on: dateValue(form, "paid_on"),
    vendor: text(form, "vendor", true, 200),
    category_id: identifier(form, "category_id", true),
    notes: text(form, "notes", false, 5000),
    total_cents: cents(form, "total"),
    discount_cents: cents(form, "discount"),
    tax_cents: cents(form, "tax"),
  };
  const sum = (key: "discount_cents" | "tax_cents") =>
    lines.reduce((a, l) => a + l[key], 0);
  if (
    sum("discount_cents") !== header.discount_cents ||
    sum("tax_cents") !== header.tax_cents ||
    lines.reduce(
      (a, l) => a + l.subtotal_cents - l.discount_cents + l.tax_cents,
      0,
    ) !== header.total_cents
  )
    throw Error(
      "Item allocations must match the discount, tax and printed receipt total exactly.",
    );
  return {
    p_request: identifier(form, "request_id", true),
    p_header: header,
    p_lines: lines,
  };
}
