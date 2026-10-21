import { cents, choice, dateValue, identifier, text } from "./validation.ts";

export function quantity(form: FormData, name = "quantity") {
  const value = text(form, name, true, 20)!;
  if (
    !/^\d+(\.\d{1,6})?$/.test(value) ||
    Number(value) <= 0 ||
    Number(value) > 1000000000
  )
    throw new Error("Enter a positive quantity with up to six decimal places.");
  return value;
}
export function expenseValues(form: FormData) {
  const horse = identifier(form, "horse_id");
  const reimbursable = form.get("reimbursable") === "on";
  if (reimbursable && !horse)
    throw new Error("Select a horse for a customer charge-back.");
  return {
    expense_date: dateValue(form, "expense_date", true),
    paid_on: dateValue(form, "paid_on"),
    category_id: identifier(form, "category_id", true),
    horse_id: horse,
    vendor: text(form, "vendor", false, 200),
    amount_cents: cents(form, "amount"),
    reimbursable,
    notes: text(form, "notes", false, 5000),
  };
}
export function stockValues(form: FormData) {
  const kind = choice(form, "kind", [
    "purchase",
    "opening",
    "feeding",
    "waste",
    "adjustment_in",
    "adjustment_out",
  ]);
  const horse = identifier(form, "horse_id");
  if (kind === "feeding" && !horse)
    throw new Error("Choose a horse for feeding.");
  return {
    p_request: identifier(form, "request_id", true),
    p_product: identifier(form, "product_id", true),
    p_unit: identifier(form, "unit_id", true),
    p_quantity: quantity(form),
    p_kind: kind,
    p_date: dateValue(form, "movement_date", true),
    p_cost_cents: ["purchase", "opening", "adjustment_in"].includes(kind)
      ? cents(form, "cost")
      : null,
    p_horse: horse,
    p_notes: text(form, "notes", kind.startsWith("adjustment"), 5000),
    p_vendor: text(form, "vendor", false, 200),
    p_paid_on: dateValue(form, "paid_on"),
  };
}
export const receiptLimit = 3 * 1024 * 1024;
export function receiptType(bytes: Uint8Array) {
  if (bytes.length > receiptLimit || !bytes.length)
    throw new Error("Choose a nonempty receipt up to 3 MB.");
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mime: "image/jpeg", extension: "jpg" };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return { mime: "image/png", extension: "png" };
  const head = new TextDecoder().decode(bytes.slice(0, 12));
  if (head.startsWith("%PDF-"))
    return { mime: "application/pdf", extension: "pdf" };
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP")
    return { mime: "image/webp", extension: "webp" };
  throw new Error("Receipt must be a JPEG, PNG, WebP, or PDF file.");
}
