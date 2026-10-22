"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { cents, dateValue, identifier, text } from "@/lib/validation";
import {
  invoiceHeaderValues,
  paymentValues,
  signedAmount,
} from "@/lib/invoices";

export async function createInvoice(form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let id: string | null = null;
  try {
    const result = await db.rpc("create_invoice", invoiceHeaderValues(form));
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Draft could not be created. Check the dates, customer, and latest migration.",
      );
    id = result.data;
  } catch (e) {
    issue = e instanceof Error ? e.message : "Draft could not be created.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    issue
      ? `/admin/invoices?new=1&error=${encodeURIComponent(issue)}`
      : `/admin/invoices/${id}?success=Draft+created.+Add+and+review+its+lines.`,
  );
}

export async function invoiceAction(operation: string, form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let invoice: string | null = null;
  try {
    invoice = identifier(form, "invoice_id", true);
    let rpc: string;
    let args: Record<string, unknown>;
    switch (operation) {
      case "header": {
        const issueDate = dateValue(form, "issue_date", true)!;
        const due = dateValue(form, "due_date", true)!;
        if (due < issueDate)
          throw new Error("Due date must follow the invoice date.");
        rpc = "update_invoice_header";
        args = {
          p_invoice: invoice,
          p_issue: issueDate,
          p_due: due,
          p_notes: text(form, "notes", false, 5000),
        };
        break;
      }
      case "line":
        rpc = "add_invoice_line";
        args = {
          p_request: identifier(form, "request_id", true),
          p_invoice: invoice,
          p_description: text(form, "description", true, 500),
          p_amount: signedAmount(form),
        };
        break;
      case "expense":
        rpc = "add_expense_chargeback";
        args = {
          p_invoice: invoice,
          p_expense: identifier(form, "expense_id", true),
          p_markup: cents(form, "markup"),
        };
        break;
      case "training":
        rpc = "add_calendar_training";
        args = { p_invoice: invoice };
        break;
      case "remove":
        rpc = "remove_invoice_line";
        args = { p_line: identifier(form, "line_id", true) };
        break;
      case "finalize":
        rpc = "finalize_invoice";
        args = { p_invoice: invoice };
        break;
      case "payment":
        rpc = "record_invoice_payment";
        args = paymentValues(form);
        break;
      case "reverse":
        rpc = "reverse_invoice_payment";
        args = {
          p_payment: identifier(form, "payment_id", true),
          p_reason: text(form, "reason", true, 2000),
        };
        break;
      case "adjust":
        rpc = "adjust_invoice";
        args = {
          p_request: identifier(form, "request_id", true),
          p_invoice: invoice,
          p_amount: signedAmount(form),
          p_date: dateValue(form, "adjustment_date", true),
          p_description: text(form, "description", true, 500),
        };
        break;
      case "void":
        rpc = "void_invoice";
        args = {
          p_invoice: invoice,
          p_reason: text(form, "reason", true, 2000),
        };
        break;
      default:
        throw new Error("Unknown invoice operation");
    }
    const { error } = await db.rpc(rpc, args);
    if (error)
      throw new Error(
        error.code === "P0001"
          ? error.message
          : error.code === "23505"
            ? "That expense or billing day is already reserved on an invoice. Review the original invoice first."
            : "Could not save. Check the values and latest database migration.",
      );
  } catch (e) {
    issue = e instanceof Error ? e.message : "Invoice could not be updated.";
  }
  revalidatePath("/admin", "layout");
  redirect(
    `${invoice ? `/admin/invoices/${invoice}` : "/admin/invoices"}?${issue ? `error=${encodeURIComponent(issue)}` : "success=Invoice+updated."}`,
  );
}
