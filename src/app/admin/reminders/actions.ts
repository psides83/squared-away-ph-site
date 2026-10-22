"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { choice, dateValue, identifier, text } from "@/lib/validation";
import { today } from "@/lib/format";
import { reminderMoveDate } from "@/lib/reminders";
export async function updateReminder(operation: string, form: FormData) {
  const { db } = await requireAdmin();
  let error: string | undefined;
  let horse: string | null = null;
  const view = new URLSearchParams();
  try {
    const id = identifier(form, "id", true)!;
    const bucket = text(form, "view_bucket", false, 20);
    if (
      bucket &&
      ["overdue", "today", "upcoming", "completed"].includes(bucket)
    )
      view.set("bucket", bucket);
    for (const key of ["horse", "category"]) {
      const value = text(form, `view_${key}`, false, 40);
      if (value) {
        if (
          (key === "horse" && value === "general") ||
          (key === "category" && value === "none")
        )
          view.set(key, value);
        else {
          const check = new FormData();
          check.set("id", value);
          view.set(key, identifier(check, "id", true)!);
        }
      }
    }
    const q = text(form, "view_q", false, 200);
    if (q) view.set("q", q);

    horse = identifier(form, "horse_context");
    let query = db
      .from("reminders")
      .select("id,completed_at,due_date")
      .eq("id", id);
    if (horse) query = query.eq("horse_id", horse);
    const current = await query.single();
    if (current.error || !current.data)
      throw new Error(
        "This reminder could not be found. Refresh and try again.",
      );
    let change: { completed_at?: string | null; due_date?: string };
    if (operation === "complete") {
      const completed = choice(form, "complete", ["yes", "no"]) === "yes";
      if (completed === Boolean(current.data.completed_at)) change = {};
      else
        change = { completed_at: completed ? new Date().toISOString() : null };
    } else if (operation === "postpone") {
      const days = Number(choice(form, "days", ["1", "7"])) as 1 | 7;
      const expected = dateValue(form, "expected_due_date", true)!;
      if (
        current.data.completed_at ||
        current.data.due_date !== expected ||
        current.data.due_date > today()
      )
        throw new Error(
          "This reminder changed or is no longer due. Refresh or edit its date.",
        );
      change = { due_date: reminderMoveDate(today(), days) };
    } else throw new Error("Unknown reminder action.");
    if (Object.keys(change).length) {
      let write = db.from("reminders").update(change).eq("id", id);
      if (horse) write = write.eq("horse_id", horse);
      if (operation === "complete")
        write =
          form.get("complete") === "yes"
            ? write.is("completed_at", null)
            : write.not("completed_at", "is", null);
      if (operation === "postpone")
        write = write
          .eq("due_date", current.data.due_date)
          .is("completed_at", null);
      const result = await write.select("id").single();
      if (result.error)
        throw new Error(
          "The reminder changed or could not be saved. Refresh and try again.",
        );
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not update this reminder.";
  }
  revalidatePath("/admin", "layout");
  if (error) view.set("error", error);
  else view.set("success", "Reminder updated.");
  redirect(
    `${horse ? `/admin/horses/${horse}` : "/admin/reminders"}?${view}${horse ? "#horse-reminders" : view.get("bucket") ? `#reminders-${view.get("bucket")}` : ""}`,
  );
}
