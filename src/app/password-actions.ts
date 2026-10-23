"use server";
import { redirect } from "next/navigation";
import { hasSupabaseConfig, supabaseServer } from "@/lib/supabase/server";
import {
  recoveryOrigin,
  recoveryEmail,
  recoveryToken,
  newPassword,
  sendRecovery,
  changeRecoveredPassword,
} from "@/lib/password-recovery";
export async function requestPasswordReset(form: FormData) {
  let issue: string | undefined;
  try {
    if (!hasSupabaseConfig())
      throw Error(
        "Account recovery is not configured yet. Contact the business owner.",
      );
    const origin = recoveryOrigin(
      process.env.NEXT_PUBLIC_SITE_URL,
      process.env.VERCEL_ENV === "production",
    );
    const email = recoveryEmail(form);
    const db = await supabaseServer();
    await sendRecovery(db.auth, email, origin);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Could not request a reset link.";
  }
  redirect(
    issue
      ? `/forgot-password?error=${encodeURIComponent(issue)}`
      : "/forgot-password?sent=1",
  );
}
export async function confirmRecovery(form: FormData) {
  let issue: string | undefined;
  try {
    const token = recoveryToken(form.get("token_hash"), form.get("type"));
    if (!hasSupabaseConfig())
      throw Error(
        "Account recovery is not configured yet. Contact the business owner.",
      );
    const db = await supabaseServer();
    const { error } = await db.auth.verifyOtp({
      token_hash: token,
      type: "recovery",
    });
    if (error)
      throw Error("This reset link is invalid or expired. Request a new link.");
  } catch {
    issue = "This reset link is invalid or expired. Request a new link.";
  }
  redirect(
    issue
      ? `/forgot-password?error=${encodeURIComponent(issue)}`
      : "/reset-password",
  );
}
export async function saveRecoveredPassword(form: FormData) {
  let issue: string | undefined;
  try {
    const password = newPassword(form);
    if (!hasSupabaseConfig())
      throw Error(
        "Account recovery is not configured yet. Contact the business owner.",
      );
    const db = await supabaseServer();
    await changeRecoveredPassword(db.auth, password);
  } catch (e) {
    issue =
      e instanceof Error
        ? e.message
        : "Password could not be updated. Request a new link.";
  }
  redirect(
    issue
      ? `/reset-password?error=${encodeURIComponent(issue)}`
      : "/login?success=Password+updated.+Sign+in+with+your+new+password.",
  );
}
