"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { cents, choice, dateValue, identifier, text } from "@/lib/validation";
export async function recurringExpenseAction(
  operation: string,
  form: FormData,
) {
  const { db } = await requireAdmin();
  let error: string | undefined;
  let expense: string | undefined;
  try {
    const revision = Number(form.get("revision"));
    if (!Number.isInteger(revision) || revision < 0)
      throw Error("Reload this schedule before continuing.");
    if (operation === "save") {
      const horse = identifier(form, "horse_id");
      const reimbursable = form.get("reimbursable") === "on";
      if (reimbursable && !horse)
        throw Error("Choose a horse for customer charge-back.");
      const result = await db.rpc("save_recurring_expense", {
        p_id: identifier(form, "id", true),
        p_revision: revision,
        p_data: {
          name: text(form, "name", true, 200),
          category_id: identifier(form, "category_id", true),
          horse_id: horse,
          vendor: text(form, "vendor", false, 200),
          amount_cents: cents(form, "amount"),
          reimbursable,
          notes: text(form, "notes", false, 5000),
          cadence: choice(form, "cadence", [
            "weekly",
            "monthly",
            "quarterly",
            "yearly",
          ]),
          starts_on: dateValue(form, "starts_on", true),
          ends_on: dateValue(form, "ends_on"),
          active: form.get("active") === "on",
        },
      });
      if (result.error)
        throw Error(
          result.error.code === "P0001"
            ? result.error.message
            : "Schedule could not save. Check the fields and latest migration.",
        );
    } else if (operation === "prepare" || operation === "skip") {
      const result = await db.rpc("prepare_recurring_expense", {
        p_request: identifier(form, "request_id", true),
        p_template: identifier(form, "id", true),
        p_revision: revision,
        p_date: dateValue(form, "next_date", true),
        p_skip_reason:
          operation === "skip" ? text(form, "reason", true, 2000) : null,
      });
      if (result.error)
        throw Error(
          result.error.code === "P0001"
            ? result.error.message
            : "This occurrence could not be prepared. Refresh and try again.",
        );
      expense = result.data ?? undefined;
    } else throw Error("Unknown schedule action.");
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not update this schedule.";
  }
  revalidatePath("/admin", "layout");
  if (!error && expense)
    redirect(
      `/admin/expenses/${expense}?success=Unpaid+recurring+bill+created.+Review+the+amount+and+attach+its+receipt.`,
    );
  redirect(
    `/admin/expenses/recurring?${error ? `error=${encodeURIComponent(error)}` : `success=${operation === "skip" ? "Occurrence+skipped.+No+expense+created." : "Recurring+expense+schedule+saved."}`}`,
  );
}
