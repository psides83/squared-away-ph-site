"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier, text } from "@/lib/validation";
import { costSplitValues, invoiceReportingValues } from "@/lib/reporting-links";

export async function reportingAction(operation: string, form: FormData) {
  const { db } = await requireAdmin();
  let destination = "/admin/attribution";
  let issue: string | undefined;
  try {
    let rpc: string;
    let args: Record<string, unknown>;
    if (operation === "invoice" || operation === "clear-invoice") {
      const invoice = identifier(form, "invoice_id", true)!;
      destination += `?invoice=${invoice}`;
      if (operation === "invoice") {
        rpc = "set_invoice_reporting_link";
        args = invoiceReportingValues(form);
      } else {
        rpc = "clear_invoice_reporting_link";
        args = {
          p_invoice: invoice,
          p_reason: text(form, "reason", true, 2000),
        };
      }
    } else if (operation === "cost" || operation === "clear-cost") {
      const expense = identifier(form, "expense_id", true)!;
      const horse = identifier(form, "horse_id", true)!;
      const allocation = identifier(form, "allocation_id");
      destination += `?expense=${expense}&horse=${horse}${allocation ? `&allocation=${allocation}` : ""}`;
      if (operation === "cost") {
        rpc = "save_cost_stay_split";
        args = costSplitValues(form);
      } else {
        rpc = "clear_cost_stay_split";
        args = {
          p_expense: expense,
          p_allocation: allocation,
          p_horse: horse,
          p_reason: text(form, "reason", true, 2000),
        };
      }
    } else throw new Error("Unknown reporting action.");
    const { error } = await db.rpc(rpc, args);
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : "The reporting assignment could not be saved. Check the latest migration and reload.",
      );
  } catch (e) {
    issue = e instanceof Error ? e.message : "Unable to save assignment.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `${destination}${destination.includes("?") ? "&" : "?"}${issue ? `error=${encodeURIComponent(issue)}` : "success=Reporting+assignment+updated.+Invoices+and+business+totals+are+unchanged."}`,
  );
}
