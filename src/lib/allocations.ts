import { dateValue, identifier, text } from "./validation.ts";

export type AllocationBasis = {
  horse_id: string;
  horse_name: string;
  board_days: number;
};
export type AllocationRow = { horse_id: string; board_days: number };

export function allocationValues(form: FormData) {
  const from = dateValue(form, "period_from", true)!;
  const to = dateValue(form, "period_to", true)!;
  const length = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (length < 1 || length > 366)
    throw new Error("Choose an allocation period of 1–366 days.");
  const rows: AllocationRow[] = [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("days_")) continue;
    const id = new FormData();
    id.set("horse_id", key.slice(5));
    const horse = identifier(id, "horse_id", true)!;
    if (
      typeof value !== "string" ||
      !/^\d{1,3}$/.test(value) ||
      Number(value) > length
    )
      throw new Error("Boarding days must be whole numbers within the period.");
    if (Number(value) > 0)
      rows.push({ horse_id: horse, board_days: Number(value) });
  }
  if (
    !rows.length ||
    rows.length > 1000 ||
    new Set(rows.map((r) => r.horse_id)).size !== rows.length
  )
    throw new Error(
      "Choose each horse once, with at least one boarding day in total.",
    );
  return {
    p_request: identifier(form, "request_id", true),
    p_expense: identifier(form, "expense_id", true),
    p_from: from,
    p_to: to,
    p_rows: rows,
    p_reason: text(form, "reason", true, 2000),
  };
}

export function splitAllocation(amount: number, rows: AllocationRow[]) {
  const total = rows.reduce((sum, r) => sum + r.board_days, 0);
  if (!total) return new Map<string, number>();
  const split = rows.map((r) => ({
    id: r.horse_id,
    amount: Math.floor((amount * r.board_days) / total),
    remainder: (amount * r.board_days) % total,
  }));
  const remaining = amount - split.reduce((sum, r) => sum + r.amount, 0);
  split.sort(
    (a, b) =>
      b.remainder - a.remainder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (let i = 0; i < remaining; i++) split[i].amount++;
  return new Map(split.map((r) => [r.id, r.amount]));
}
