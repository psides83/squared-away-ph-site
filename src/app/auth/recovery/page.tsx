import Link from "next/link";
import { AccountScreen } from "@/components/account-screen";
import { SubmitButton } from "@/components/submit-button";
import { confirmRecovery } from "@/app/password-actions";
import { recoveryToken } from "@/lib/password-recovery";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const query = await searchParams;
  let token: string | undefined;
  try {
    token = recoveryToken(query.token_hash, query.type);
  } catch {}
  return (
    <AccountScreen
      title="Continue password reset"
      description="Continue to verify this link and choose a new password."
    >
      {token ? (
        <form action={confirmRecovery} className="stack">
          <input type="hidden" name="token_hash" value={token} />
          <input type="hidden" name="type" value="recovery" />
          <SubmitButton>Continue to new password</SubmitButton>
        </form>
      ) : (
        <>
          <p className="notice error">This reset link is invalid or expired.</p>
          <Link className="button" href="/forgot-password">
            Request a new reset link
          </Link>
        </>
      )}
    </AccountScreen>
  );
}
