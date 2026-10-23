import { AccountScreen } from "@/components/account-screen";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { requestPasswordReset } from "@/app/password-actions";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const query = await searchParams;
  return (
    <AccountScreen
      title="Reset your password"
      description="Enter the email address used for your Barn Office account."
    >
      <Notice error={query.error} />
      {query.sent === "1" ? (
        <p className="notice success" role="status">
          If an account uses that email, reset instructions will arrive shortly.
          Check spam as well. If nothing arrives, contact the business owner
          before requesting another link.
        </p>
      ) : (
        <form action={requestPasswordReset} className="stack">
          <label>
            Email address
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          <SubmitButton>Send reset instructions</SubmitButton>
        </form>
      )}
    </AccountScreen>
  );
}
