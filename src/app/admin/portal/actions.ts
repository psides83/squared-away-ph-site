"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { identifier, dateValue, text } from "@/lib/validation";
export async function portalAccessAction(operation: string, form: FormData) {
  const { db } = await requireAdmin();
  let issue: string | undefined;
  let customer: string | null = null;
  try {
    customer = identifier(form, "customer_id", true);
    let rpc: string;
    let args: Record<string, unknown>;
    if (operation === "account") {
      rpc = "grant_customer_portal";
      args = {
        p_request: identifier(form, "request_id", true),
        p_customer: customer,
        p_email: text(form, "email", true, 254),
        p_reason: text(form, "reason", true, 2000),
      };
    } else if (operation === "disable") {
      rpc = "disable_customer_portal";
      args = {
        p_customer: customer,
        p_reason: text(form, "reason", true, 2000),
      };
    } else if (operation === "horse") {
      rpc = "set_customer_horse_access";
      args = {
        p_request: identifier(form, "request_id", true),
        p_customer: customer,
        p_horse: identifier(form, "horse_id", true),
        p_from: dateValue(form, "visible_from"),
        p_active: form.get("active") === "yes",
        p_reason: text(form, "reason", true, 2000),
      };
    } else throw new Error("Unknown access change.");
    const result = await db.rpc(rpc, args);
    if (result.error)
      throw new Error(
        result.error.code === "P0001"
          ? result.error.message
          : "Customer access could not be saved. Confirm the account and latest migration.",
      );
  } catch (e) {
    issue = e instanceof Error ? e.message : "Unable to save customer access.";
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/portal", "layout");
  redirect(
    `/admin/portal?${customer ? `customer=${customer}&` : ""}${issue ? `error=${encodeURIComponent(issue)}` : "success=Portal+access+updated."}`,
  );
}
