"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { preparedReceipt, attachReceipt } from "@/lib/receipt-storage";
import { requireAdmin } from "@/lib/auth";
import { choice, dateValue, identifier, text } from "@/lib/validation";
import { weightInOunces } from "@/lib/weight-units";
import { quantity, stockValues } from "@/lib/inventory";

function message(error: { message: string; code?: string } | null) {
  if (!error) return;
  return error.code === "P0001"
    ? error.message
    : "Could not save. Check the values and latest Supabase migrations.";
}
export async function saveProduct(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let product: string | null = null;
  try {
    product = identifier(form, "id");
    const values = {
      name: text(form, "name", true, 200),
      category: choice(form, "category", ["feed", "hay", "supplement"]),
      expense_category_id: identifier(form, "expense_category_id", true),
    };
    if (product) {
      const result = await db
        .from("inventory_products")
        .update({ ...values, archived: form.get("archived") === "on" })
        .eq("id", product)
        .select()
        .single();
      issue = message(result.error);
    } else {
      const result = await db.rpc("create_inventory_product", {
        p_name: values.name,
        p_category: values.category,
        p_expense_category: values.expense_category_id,
      });
      issue = message(result.error);
      product = result.data;
    }
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not save product.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/inventory?${product ? `product=${product}&` : ""}${issue ? `error=${encodeURIComponent(issue)}` : "success=Product+saved."}`,
  );
}
export type UnitSaveState = {
  error?: string;
  success?: string;
  revision?: string;
};
export async function saveUnit(
  _state: UnitSaveState,
  form: FormData,
): Promise<UnitSaveState> {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let product: string | null = null;
  try {
    product = identifier(form, "product_id", true);
    const label = text(form, "label", true, 40)!;
    const ounces = weightInOunces(
      text(form, "weight", true, 30)!,
      text(form, "weight_unit", true, 10)!,
    );
    const { id, ...rest } = {
      id: identifier(form, "id"),
      product_id: product,
      label,
      ounces_per_unit: ounces,
    };
    const result = id
      ? await db
          .from("inventory_units")
          .update(rest)
          .eq("id", id)
          .eq("product_id", product)
          .select()
          .single()
      : await db.from("inventory_units").insert(rest);
    issue =
      result.error?.code === "23505"
        ? "A conversion with that name already exists for this product. Choose a different name."
        : message(result.error);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not save conversion.";
  }
  if (issue) return { error: issue };
  revalidatePath("/admin", "layout");
  return {
    success:
      "Conversion saved. Past transactions and current stock are unchanged; future entries use this weight.",
    revision: crypto.randomUUID(),
  };
}
export async function recordStock(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let product: string | null = null;
  let expense: string | null = null;
  let receiptAttached = false;
  try {
    const values = stockValues(form);
    product = values.p_product;
    const receipt =
      values.p_kind === "purchase"
        ? await preparedReceipt(form.get("receipt"))
        : null;
    if (values.p_kind === "feeding") {
      const result = await db.rpc("record_bulk_extra_feeding", {
        p_request: values.p_request,
        p_product: values.p_product,
        p_unit: values.p_unit,
        p_date: values.p_date,
        p_entries: [{ horse_id: values.p_horse, quantity: values.p_quantity }],
        p_notes: values.p_notes,
        p_feeding_time: identifier(form, "feeding_time_id"),
      });
      issue = message(result.error);
    } else {
      const result = await db.rpc("record_stock_movement", values);
      issue = message(result.error);
      expense = result.data?.expense_id;
      if (expense && !issue && receipt) {
        await attachReceipt(db, expense, receipt);
        receiptAttached = true;
      }
    }
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not record stock.";
  }
  revalidatePath("/admin", "layout");
  if (expense && issue)
    redirect(
      `/admin/expenses?edit=${expense}&error=${encodeURIComponent(issue)}#receipts`,
    );
  if (expense && !issue && receiptAttached)
    redirect(`/admin/inventory?success=Purchase,+stock,+and+receipt+saved.`);
  if (expense && !issue)
    redirect(
      `/admin/expenses?edit=${expense}&success=Purchase+and+stock+saved.+Attach+the+receipt+below.#receipts`,
    );
  redirect(
    `/admin/inventory?${product ? `product=${product}&` : ""}${issue ? `error=${encodeURIComponent(issue)}` : "success=Stock+transaction+recorded."}`,
  );
}
export async function saveHorseRation(horseId: string, form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  try {
    const values = {
      horse_id: horseId,
      product_id: identifier(form, "product_id", true),
      feeding_time_id: identifier(form, "feeding_time_id", true),
      unit_id: identifier(form, "unit_id", true),
      quantity: quantity(form),
      active: form.get("active") === "on",
      notes: text(form, "notes", false, 2000),
    };
    const id = identifier(form, "id");
    const { error } = id
      ? await db
          .from("feed_rations")
          .update(values)
          .eq("id", id)
          .eq("horse_id", horseId)
          .select()
          .single()
      : await db.from("feed_rations").insert(values);
    issue =
      error?.code === "23505"
        ? "This horse already has this product at that feeding time. Edit the existing ration line instead."
        : message(error);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not save ration.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/horses/${horseId}?${issue ? `ration=${encodeURIComponent(String(form.get("id") ?? ""))}&new=1&error=${encodeURIComponent(issue)}` : "success=Ration+saved.+No+stock+was+deducted."}#${issue ? "ration-form" : "horse-rations"}`,
  );
}
export async function deleteRation(horseId: string, form: FormData) {
  const { db } = await requireAdmin();
  let issue = false;
  try {
    const { error } = await db
      .from("feed_rations")
      .delete()
      .eq("id", identifier(form, "id", true))
      .eq("horse_id", horseId)
      .select()
      .single();
    issue = Boolean(error);
  } catch {
    issue = true;
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/horses/${horseId}?${issue ? "error=Ration+could+not+be+removed." : "success=Ration+removed.+Past+feedings+remain+unchanged."}#horse-rations`,
  );
}
export async function confirmFeeding(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  try {
    const { error } = await db.rpc("confirm_scheduled_feeding", {
      p_horse: identifier(form, "horse_id", true),
      p_date: dateValue(form, "feeding_date", true),
      p_feeding_time: identifier(form, "feeding_time_id", true),
    });
    issue = message(error);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not confirm feeding.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/feeding?${issue ? `error=${encodeURIComponent(issue)}` : "success=Feeding+confirmed.+Repeated+confirmation+does+not+deduct+stock+again."}`,
  );
}
export async function reverseConsumption(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  try {
    const { error } = await db.rpc("reverse_stock_consumption", {
      p_movement: identifier(form, "id", true),
      p_reason: text(form, "reason", true, 5000),
    });
    issue = message(error);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not reverse entry.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/inventory?${issue ? `error=${encodeURIComponent(issue)}` : "success=Correction+recorded.+Use+a+manual+feeding+entry+if+needed."}`,
  );
}

export async function confirmBulkFeeding(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  try {
    const horses = form.getAll("horse_id").map((value) => {
      const row = new FormData();
      row.set("horse_id", value);
      return identifier(row, "horse_id", true)!;
    });
    if (!horses.length || horses.length > 100)
      throw new Error("Choose between 1 and 100 horses.");
    const { error } = await db.rpc("confirm_bulk_scheduled_feeding", {
      p_horses: horses,
      p_feeding_time: identifier(form, "feeding_time_id", true),
      p_date: dateValue(form, "feeding_date", true),
    });
    issue = message(error);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not confirm this batch.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/feeding?${issue ? `error=${encodeURIComponent(issue)}` : "success=Selected+feeding-time+rations+confirmed.+Already+confirmed+horses+were+not+deducted+again."}`,
  );
}
export async function recordBulkFeeding(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  try {
    const entries = [];
    for (const [name, value] of form.entries()) {
      if (!name.startsWith("quantity_") || value === "") continue;
      const row = new FormData();
      row.set("horse_id", name.slice(9));
      row.set("quantity", value);
      entries.push({
        horse_id: identifier(row, "horse_id", true),
        quantity: quantity(row),
      });
    }
    if (!entries.length || entries.length > 100)
      throw new Error("Enter quantities for between 1 and 100 horses.");
    const { error } = await db.rpc("record_bulk_extra_feeding", {
      p_request: identifier(form, "request_id", true),
      p_product: identifier(form, "product_id", true),
      p_unit: identifier(form, "unit_id", true),
      p_date: dateValue(form, "feeding_date", true),
      p_entries: entries,
      p_feeding_time: identifier(form, "feeding_time_id"),
      p_notes: text(form, "notes", false, 5000),
    });
    issue = message(error);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not record these feedings.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/feeding?${issue ? `error=${encodeURIComponent(issue)}` : "success=All+feeding+entries+recorded+together."}`,
  );
}
