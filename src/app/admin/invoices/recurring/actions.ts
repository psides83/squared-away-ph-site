"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dateValue, identifier, text } from "@/lib/validation";
export async function prepareRecurring(form: FormData) {
  const { db } = await requireAdmin();
  let error: string | undefined;
  let invoice: string | undefined;
  let state: string | undefined;
  try {
    const result = await db.rpc("prepare_recurring_invoice", {
      p_stay: identifier(form, "stay_id", true),
      p_expected_from: dateValue(form, "period_from", true),
      p_expected_to: dateValue(form, "period_to", true),
    });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Could not prepare this cycle. Check the latest migration and refresh.",
      );
    invoice = result.data.invoice_id;
    state = result.data.state;
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not prepare billing.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    error
      ? `/admin/invoices/recurring?error=${encodeURIComponent(error)}`
      : `/admin/invoices/${invoice}?success=${state === "issued" ? "Completed+cycle+invoice+finalized." : "Draft+prepared.+Review+the+recurring+billing+status+below."}#invoice-charges`,
  );
}
export async function skipVoidedCycle(form: FormData) {
  const { db } = await requireAdmin();
  let error: string | undefined;
  try {
    const result = await db.rpc("skip_voided_recurring_cycle", {
      p_cycle: identifier(form, "cycle_id", true),
      p_reason: text(form, "reason", true, 2000),
    });
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Could not skip this cycle.",
      );
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not skip this cycle.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `/admin/invoices/recurring?${error ? `error=${encodeURIComponent(error)}` : "success=Voided+cycle+skipped.+No+replacement+bill+was+created."}`,
  );
}

export async function configureAutomation(form: FormData) {
  const { db } = await requireAdmin();
  const value = form.get("enabled");
  let error: string | undefined;
  if (value !== "true" && value !== "false")
    error = "Choose whether automatic billing should be enabled.";
  else if (
    value === "true" &&
    !(
      process.env.VERCEL_ENV === "production" &&
      (process.env.CRON_SECRET?.length ?? 0) >= 32 &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
    )
  )
    error =
      "Complete the production scheduler setup before enabling automatic billing.";
  else {
    const result = await db.rpc("configure_billing_automation", {
      p_enabled: value === "true",
    });
    if (result.error)
      error =
        "Automatic billing settings could not save. Check the latest migration.";
  }
  revalidatePath("/admin/invoices/recurring");
  redirect(
    `/admin/invoices/recurring?${error ? `error=${encodeURIComponent(error)}` : "success=Automatic+billing+setting+saved."}#recurring-automation`,
  );
}
