"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { trainingEntryValues } from "@/lib/training-entry";
import {
  cents,
  choice,
  customerIdentifiers,
  dateValue,
  identifier,
  text,
} from "@/lib/validation";

type Entity =
  | "customers"
  | "horses"
  | "training_stays"
  | "training_entries"
  | "reminders"
  | "reminder_categories";
const routes: Record<Entity, string> = {
  customers: "/admin/customers",
  horses: "/admin/horses",
  training_stays: "/admin/training",
  training_entries: "/admin/log",
  reminders: "/admin/reminders",
  reminder_categories: "/admin/reminders",
};

export async function saveRecord(entity: Entity, form: FormData) {
  const { db } = await requireAdmin();
  if (!Object.hasOwn(routes, entity)) throw new Error("Unknown record type.");
  let problem: string | null = null;
  try {
    const id = identifier(form, "id");
    let values: Record<string, unknown> = {};
    let customerIds: string[] = [];
    switch (entity) {
      case "training_entries":
        values = trainingEntryValues(form);
        break;
      case "customers": {
        const email = text(form, "email", false, 254);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new Error("Please enter a valid email address.");
        values = {
          name: text(form, "name", true, 200),
          email,
          phone: text(form, "phone", false, 50),
          notes: text(form, "notes", false, 5000),
        };
        break;
      }
      case "horses": {
        customerIds = customerIdentifiers(form);
        const birth = text(form, "birth_year", false, 4);
        if (
          birth &&
          (!/^\d{4}$/.test(birth) ||
            Number(birth) < 1900 ||
            Number(birth) > new Date().getFullYear())
        )
          throw new Error("Please enter a valid birth year.");
        values = {
          barn_name: text(form, "barn_name", true, 200),
          registered_name: text(form, "registered_name", false, 200),
          registration_number: text(form, "registration_number", false, 100),
          birth_year: birth ? Number(birth) : null,
          sex: choice(form, "sex", ["unknown", "mare", "gelding", "stallion"]),
          breed: text(form, "breed", false, 100),
          training_goals: text(form, "training_goals", false, 5000),
          feeding_instructions: text(form, "feeding_instructions", false, 5000),
          health_notes: text(form, "health_notes", false, 5000),
        };
        break;
      }
      case "training_stays": {
        const arrival = dateValue(form, "arrival_date", true)!;
        const departure = dateValue(form, "departure_date");
        if (departure && departure < arrival)
          throw new Error("Departure must be on or after arrival.");
        const billingDay = Number(text(form, "billing_day", true, 2));
        if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28)
          throw new Error("Choose a billing day from 1 to 28.");
        values = {
          horse_id: identifier(form, "horse_id", true),
          billing_customer_id: identifier(form, "billing_customer_id", true),
          arrival_date: arrival,
          departure_date: departure,
          monthly_rate_cents: cents(form, "monthly_rate"),
          billing_day: billingDay,
          proration: choice(form, "proration", [
            "manual",
            "calendar_days",
            "none",
          ]),
          notes: text(form, "notes", false, 5000),
        };
        break;
      }
      case "reminders":
        values = {
          title: text(form, "title", true, 200),
          horse_id: identifier(form, "horse_id"),
          category_id: identifier(form, "category_id"),
          due_date: dateValue(form, "due_date", true),
          notes: text(form, "notes", false, 5000),
        };
        break;
      case "reminder_categories":
        values = { name: text(form, "name", true, 100) };
        break;
    }
    const result =
      entity === "horses"
        ? await db.rpc("save_horse_with_customers", {
            p_id: id,
            p_horse: values,
            p_customer_ids: customerIds,
          })
        : id
          ? await db
              .from(entity)
              .update(values)
              .eq("id", id)
              .select("id")
              .single()
          : await db.from(entity).insert(values).select("id").single();
    if (result.error) {
      problem = ["23505", "23P01"].includes(result.error.code)
        ? "That record overlaps or duplicates an existing record. Check existing entries."
        : "Could not save this record. Check your entries and database setup, then try again.";
    }
  } catch (error) {
    problem =
      error instanceof Error ? error.message : "Could not save this record.";
  }
  if (problem)
    redirect(`${routes[entity]}?error=${encodeURIComponent(problem)}`);
  revalidatePath("/admin", "layout");
  redirect(`${routes[entity]}?success=Record+saved.`);
}

export async function deleteRecord(entity: Entity, form: FormData) {
  const { db } = await requireAdmin();
  if (!Object.hasOwn(routes, entity)) throw new Error("Unknown record type.");
  let problem: string | null = null;
  try {
    const id = identifier(form, "id", true)!;
    const { error } = await db
      .from(entity)
      .delete()
      .eq("id", id)
      .select("id")
      .single();
    if (error)
      problem =
        error.code === "23503"
          ? "This record is linked to another record and cannot be deleted. Keep it to preserve your history."
          : "Could not delete this record. Refresh and try again.";
  } catch {
    problem = "Could not delete this record.";
  }
  if (problem)
    redirect(`${routes[entity]}?error=${encodeURIComponent(problem)}`);
  revalidatePath("/admin", "layout");
  redirect(`${routes[entity]}?success=Record+deleted.`);
}

export async function toggleReminder(form: FormData) {
  const { db } = await requireAdmin();
  let problem = false;
  try {
    const id = identifier(form, "id", true)!;
    const { error } = await db
      .from("reminders")
      .update({
        completed_at:
          form.get("complete") === "yes" ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .select("id")
      .single();
    problem = Boolean(error);
  } catch {
    problem = true;
  }
  revalidatePath("/admin", "layout");
  redirect(
    problem
      ? "/admin/reminders?error=Could+not+update+the+reminder."
      : "/admin/reminders?success=Reminder+updated.",
  );
}
