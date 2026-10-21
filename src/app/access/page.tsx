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
  return (
    <main className="access-page">
      <div className="panel access-card">
        <Brand />
        <p className="eyebrow">ONE MORE STEP</p>
        <h1>Your office is protected.</h1>
        <p className="muted">
          This account does not have administrator access yet, or the database
          setup has not been applied.
        </p>
        <p>
          The project owner needs to apply the database migration and grant this
          account access using the setup guide in the repository.
        </p>
        <p className="notice">Signed in as {user.email}</p>
        <form action={signOut}>
          <button className="button secondary">Sign out</button>
        </form>
      </div>
    </main>
  );
}
