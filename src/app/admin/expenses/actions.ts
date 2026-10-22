"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dateValue, identifier, text } from "@/lib/validation";
import { preparedReceipt, attachReceipt } from "@/lib/receipt-storage";
import { expenseValues } from "@/lib/inventory";

export async function saveExpense(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let saved: string | undefined;
  try {
    const { data, error } = await db.rpc("save_expense", {
      p_id: identifier(form, "id"),
      p_data: expenseValues(form),
      p_request: identifier(form, "request_id", true),
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Expense could not be saved. Inventory purchases must be corrected through their stock history.",
      );
    saved = data;
  } catch (e) {
    issue = e instanceof Error ? e.message : "Unable to save expense.";
  }
  if (issue) redirect(`/admin/expenses?error=${encodeURIComponent(issue)}`);
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/expenses?edit=${saved}&success=Expense+saved.+You+can+attach+receipts+below.#record-form`,
  );
}
export async function expenseStatus(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  try {
    const { error } = await db.rpc("set_expense_status", {
      p_id: identifier(form, "id", true),
      p_paid_on: dateValue(form, "paid_on"),
      p_void: form.get("void") === "yes",
    });
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "Unable to update expense. Inventory purchases cannot be voided separately from stock.",
      );
  } catch (e) {
    issue = e instanceof Error ? e.message : "Unable to update expense.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/expenses?${issue ? `error=${encodeURIComponent(issue)}` : "success=Expense+updated."}`,
  );
}
export async function saveCategory(form: FormData) {
  const { db } = await requireAdmin();
  let issue = false;
  try {
    const id = identifier(form, "id");
    const name = text(form, "name", true, 100);
    const result = id
      ? await db
          .from("expense_categories")
          .update({ name })
          .eq("id", id)
          .select()
          .single()
      : await db.from("expense_categories").insert({ name });
    issue = Boolean(result.error);
  } catch {
    issue = true;
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/expenses?${issue ? "error=Category+could+not+be+saved.+Names+must+be+unique." : "success=Category+saved."}`,
  );
}
export async function deleteCategory(form: FormData) {
  const { db } = await requireAdmin();
  let issue = false;
  try {
    const { error } = await db
      .from("expense_categories")
      .delete()
      .eq("id", identifier(form, "id", true))
      .select()
      .single();
    issue = Boolean(error);
  } catch {
    issue = true;
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/expenses?${issue ? "error=Category+is+in+use+or+could+not+be+removed." : "success=Category+removed."}`,
  );
}

export async function uploadReceipt(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let expense: string | null = null;
  try {
    expense = identifier(form, "expense_id", true);
    const receipt = await preparedReceipt(form.get("receipt"));
    if (!receipt) throw new Error("Select a receipt first.");
    const { data: record, error: lookup } = await db
      .from("expenses")
      .select("id")
      .eq("id", expense)
      .single();
    if (lookup || !record) throw new Error("Expense not found.");
    await attachReceipt(db, expense!, receipt);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Receipt could not be uploaded.";
  }
  revalidatePath("/admin/expenses");
  redirect(
    `/admin/expenses?${expense ? `edit=${expense}&` : ""}${issue ? `error=${encodeURIComponent(issue)}` : "success=Receipt+attached."}#receipts`,
  );
}
export async function removeReceipt(form: FormData) {
  const { db } = await requireAdmin();
  let issue = false;
  try {
    const id = identifier(form, "id", true);
    const { data, error } = await db
      .from("expense_receipts")
      .select("object_path")
      .eq("id", id)
      .single();
    if (error || !data) throw new Error();
    const deleted = await db.storage
      .from("expense-receipts")
      .remove([data.object_path]);
    if (deleted.error) throw new Error();
    const result = await db.from("expense_receipts").delete().eq("id", id);
    issue = Boolean(result.error);
  } catch {
    issue = true;
  }
  revalidatePath("/admin/expenses");
  redirect(
    `/admin/expenses?${issue ? "error=Receipt+could+not+be+removed.+Try+again." : "success=Receipt+removed."}`,
  );
}
