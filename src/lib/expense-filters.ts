import { choice, dateValue, identifier, text } from "./validation.ts";
export type ExpenseFilterQuery = {
  from?: string;
  to?: string;
  horse?: string;
  category?: string;
  status?: string;
  q?: string;
  page?: string;
};
export function expenseFilters(params: ExpenseFilterQuery) {
  const f = new FormData();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) f.set(k, v);
  const from = dateValue(f, "from"),
    to = dateValue(f, "to");
  if (from && to && from > to)
    throw new Error("Expense start date must be on or before the end date.");
  const horse = text(f, "horse", false, 36);
  f.set("horse", horse === "shared" ? "" : (horse ?? ""));
  f.set("status", params.status || "all");
  return {
    p_from: from,
    p_to: to,
    p_horse: identifier(f, "horse"),
    p_shared: horse === "shared",
    p_category: identifier(f, "category"),
    p_status: choice(f, "status", ["all", "paid", "unpaid", "voided"]),
    p_query: text(f, "q", false, 200),
    p_page: Math.max(1, Math.min(10000, Math.floor(Number(params.page) || 1))),
  };
}
export function expenseListHref(params: ExpenseFilterQuery, page = 1) {
  const search = new URLSearchParams();
  for (const key of ["from", "to", "horse", "category", "status", "q"] as const)
    if (params[key]) search.set(key, params[key]!);
  if (page > 1) search.set("page", String(page));
  return `/admin/expenses${search.size ? `?${search}` : ""}`;
}
