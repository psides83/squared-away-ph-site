import { identifier } from "./validation.ts";
import { expenseValues } from "./inventory.ts";
export function bulkExpenseValues(form: FormData) {
  const rows = form.getAll("row_id");
  if (rows.length < 1 || rows.length > 20)
    throw new Error("Enter between 1 and 20 expenses.");
  const seen = new Set<string>();
  return rows.map((row, index) => {
    try {
      const idForm = new FormData();
      idForm.set("id", row);
      const id = identifier(idForm, "id", true)!;
      if (seen.has(id)) throw new Error("This entry appears twice.");
      seen.add(id);
      const single = new FormData();
      for (const field of [
        "expense_date",
        "paid_on",
        "category_id",
        "horse_id",
        "vendor",
        "amount",
        "reimbursable",
        "notes",
      ]) {
        const value = form.get(`row.${id}.${field}`);
        if (value !== null) single.set(field, value);
      }
      return { id, ...expenseValues(single) };
    } catch (error) {
      throw new Error(
        `Entry ${index + 1}: ${error instanceof Error ? error.message : "Check the expense details."}`,
      );
    }
  });
}
