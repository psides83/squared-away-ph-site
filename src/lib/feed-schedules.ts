import { choice, identifier, text } from "./validation.ts";
import { quantity } from "./inventory.ts";
export type FeedScheduleState = { error?: string; ok?: boolean };
export function feedScheduleValues(horse: string, form: FormData) {
  const horseForm = new FormData();
  horseForm.set("horse_id", horse);
  const target = identifier(form, "feeding_time_id");
  const mode = choice(form, "mode", ["new", "edit"]);
  let expected: unknown;
  try {
    expected = JSON.parse(text(form, "expected", true, 300000)!);
  } catch {
    throw new Error("Reload the feeding schedule before saving.");
  }
  if (!Array.isArray(expected) || expected.length > 100)
    throw new Error("Reload the feeding schedule before saving.");
  const keys = form.getAll("row_key");
  const products = form.getAll("product_id"),
    units = form.getAll("unit_id"),
    quantities = form.getAll("quantity"),
    notes = form.getAll("notes");
  if (
    keys.length > 100 ||
    [products, units, quantities, notes].some((v) => v.length !== keys.length)
  )
    throw new Error("Complete each ration before saving this feeding time.");
  const rows = keys.map((key, index) => {
    const values = new FormData();
    for (const [name, value] of Object.entries({
      id: key,
      product_id: products[index],
      unit_id: units[index],
      quantity: quantities[index],
      notes: notes[index],
    })) {
      if (typeof value !== "string") throw new Error("Invalid ration values.");
      values.set(name, value);
    }
    const id = identifier(values, "id", true)!;
    return {
      id,
      product_id: identifier(values, "product_id", true),
      unit_id: identifier(values, "unit_id", true),
      quantity: quantity(values),
      active: form.get(`active_${id}`) === "on",
      notes: text(values, "notes", false, 2000),
    };
  });
  if (
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    new Set(rows.map((r) => r.product_id)).size !== rows.length
  )
    throw new Error("Use one ration per product in this feeding time.");
  if (rows.length && !target) throw new Error("Choose a feeding time.");
  if (mode === "new" && !rows.length)
    throw new Error("Add at least one ration.");
  return {
    p_request: identifier(form, "request_id", true),
    p_horse: identifier(horseForm, "horse_id", true),
    p_source_time: mode === "new" ? target : identifier(form, "source_time"),
    p_target_time: target,
    p_expected: expected,
    p_rows: rows,
  };
}
