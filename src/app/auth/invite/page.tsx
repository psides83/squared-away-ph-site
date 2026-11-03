import { AccountScreen } from "@/components/account-screen";
import { SubmitButton } from "@/components/submit-button";
import { confirmInvitation } from "@/app/invitation-actions";
import { invitationToken } from "@/lib/customer-invitation";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; error?: string }>;
}) {
  const query = await searchParams;
  let token: string | undefined;
  try {
    token = invitationToken(query.token_hash, query.type);
  } catch {}
  return (
    <AccountScreen
      title="Welcome to your customer portal"
      description="Accept your invitation, then choose a password for your account."
    >
      {token && !query.error ? (
        <form action={confirmInvitation} className="stack">
          <input type="hidden" name="token_hash" value={token} />
          <input type="hidden" name="type" value="invite" />
          <p>
            Your horse and billing access is assigned separately by the business
            owner.
          </p>
          <SubmitButton>Accept invitation</SubmitButton>
        </form>
      ) : (
        <div className="stack">
          <p className="notice error">
            This invitation is invalid or expired. Contact the business owner
            for a new invitation.
          </p>
        </div>
      )}
    </AccountScreen>
  );
}
