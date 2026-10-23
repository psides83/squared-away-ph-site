import Link from "next/link";
import { AccountScreen } from "@/components/account-screen";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { hasSupabaseConfig, supabaseServer } from "@/lib/supabase/server";
import { saveRecoveredPassword } from "@/app/password-actions";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const query = await searchParams;
  const db = hasSupabaseConfig() ? await supabaseServer() : null;
  const result = await db?.auth.getUser().catch(() => null);
  const valid = Boolean(result?.data.user && !result?.error);
  return (
    <AccountScreen
      title="Choose a new password"
      description="Use 12–128 characters. A longer, unique passphrase is a good choice."
    >
      <Notice error={query.error} />
      {valid ? (
        <form action={saveRecoveredPassword} className="stack">
          <label>
            New password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm new password
            <input
              name="confirmation"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <SubmitButton>Save new password</SubmitButton>
        </form>
      ) : (
        <>
          <p className="notice">
            Open a valid reset link from your email to set your password. If the
            link has expired, request a new one.
          </p>
          <Link className="button" href="/forgot-password">
            Request a reset link
          </Link>
        </>
      )}
    </AccountScreen>
  );
}
