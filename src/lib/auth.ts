import "server-only";
import { redirect } from "next/navigation";
import { hasSupabaseConfig, supabaseServer } from "@/lib/supabase/server";

export async function requireAdmin() {
  if (!hasSupabaseConfig())
    redirect("/login?error=Connection+settings+are+missing.");
  const db = await supabaseServer();
  const {
    data: { user },
    error: userError,
  } = await db.auth.getUser();
  if (userError || !user) redirect("/login");
  const { data: allowed, error } = await db.rpc("is_admin");
  if (error || !allowed) redirect("/access");
  return { db, user };
}
