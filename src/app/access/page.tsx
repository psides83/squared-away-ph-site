import { Brand } from "@/components/brand";
import { signOut } from "@/app/auth-actions";
import { redirect } from "next/navigation";
import { supabaseServer, hasSupabaseConfig } from "@/lib/supabase/server";

export default async function Access() {
  if (!hasSupabaseConfig()) redirect("/login");
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  const customer = await db.rpc("current_customer_id");
  if (customer.data && !customer.error) redirect("/portal");
  return (
    <main className="access-page">
      <div className="panel access-card">
        <Brand />
        <p className="eyebrow">ONE MORE STEP</p>
        <h1>Your account needs access.</h1>
        <p className="muted">
          Access has not been assigned to this account yet.
        </p>
        <p>
          Contact Squared Away Performance Horses to activate your customer
          access.
        </p>
        <p className="notice">Signed in as {user.email}</p>
        <form action={signOut}>
          <button className="button secondary">Sign out</button>
        </form>
      </div>
    </main>
  );
}
