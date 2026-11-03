"use server";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { identifier, text } from "@/lib/validation";
export async function resolveFeedAbsorptionInvoice(
  _state: { error?: string; success?: string },
  f: FormData,
): Promise<{ error?: string; success?: string }> {
  const { db } = await requireAdmin();
  try {
    const token = text(f, "source_token", true, 32)!;
    if (!/^[a-f0-9]{32}$/.test(token))
      throw Error("Reopen the current invoice review.");
    const { error } = await db.rpc("resolve_feed_absorption_invoice", {
      p_invoice: identifier(f, "invoice_id", true),
      p_token: token,
      p_reason: text(f, "reason", true, 2000),
    });
    if (error)
      throw Error(
        error.code === "P0001"
          ? error.message
          : "Manual invoice review could not save. Check the latest migration.",
      );
    revalidatePath("/admin", "layout");
    return {
      success:
        "Manual review recorded. No invoice adjustment, refund or payment was created.",
    };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Could not record manual invoice review.",
    };
  }
}
