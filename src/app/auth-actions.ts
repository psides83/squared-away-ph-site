"use server";
import { redirect } from "next/navigation";
import { hasSupabaseConfig, supabaseServer } from "@/lib/supabase/server";

export async function signIn(form: FormData) {
  if (!hasSupabaseConfig())
    redirect("/login?error=Connection+settings+are+missing.");
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password)
    redirect("/login?error=Enter+your+email+and+password.");
  const db = await supabaseServer();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error)
    redirect(
      "/login?error=Unable+to+sign+in.+Check+your+details+and+try+again.",
    );
  redirect("/admin");
}
export async function signOut() {
  const db = await supabaseServer();
  await db.auth.signOut();
  redirect("/login");
}
