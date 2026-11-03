"use server";
import { redirect } from "next/navigation";
import { hasSupabaseConfig, supabaseServer } from "@/lib/supabase/server";
import { acceptInvitation } from "@/lib/customer-invitation";

export async function confirmInvitation(form: FormData) {
  let failed = false;
  try {
    if (!hasSupabaseConfig()) throw Error();
    const db = await supabaseServer();
    await acceptInvitation(db.auth, form.get("token_hash"), form.get("type"));
  } catch {
    failed = true;
  }
  redirect(failed ? "/auth/invite?error=invalid" : "/reset-password");
}
