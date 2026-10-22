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
  if (error || !allowed) {
    const customer = await db.rpc("current_customer_id");
    if (customer.data && !customer.error) redirect("/portal");
    redirect("/access");
  }
  return { db, user };
}

export async function requireCustomer() {
  if (!hasSupabaseConfig())
    redirect("/login?error=Connection+settings+are+missing.");
  const db = await supabaseServer();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const result = await db.rpc("current_customer_id");
  if (result.error || !result.data) redirect("/access");
  return { db, user };
}
