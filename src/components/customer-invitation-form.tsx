"use client";
import { startTransition, useActionState, useRef } from "react";
import { inviteCustomer } from "@/app/admin/portal/invitation-actions";
import { ConfirmButton } from "@/components/confirm-button";
export function CustomerInvitationForm({
  customer,
  email,
  ready,
}: {
  customer: string;
  email: string;
  ready: boolean;
}) {
  const request = useRef<string | null>(null);
  const [state, action, pending] = useActionState(inviteCustomer, {});
  return (
    <form
      className="record-form stack"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set("request_id", (request.current ??= crypto.randomUUID()));
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="customer_id" value={customer} />
      <input type="hidden" name="email" value={email} />
      <p>
        Send an account invitation to{" "}
        <strong>{email || "the saved customer email"}</strong>.
      </p>
      <p className="muted">
        This creates a sign-in account if the provider accepts it. Link that
        account and grant horse access separately. Existing accounts should use
        password recovery.
      </p>
      {!ready && (
        <p className="notice">
          Email setup required. Customer invitations are disabled until a custom
          sender and invitation template are configured.
        </p>
      )}
      {!email && (
        <p className="notice">
          Save an email address on the customer record first.
        </p>
      )}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      <fieldset disabled={!ready || !email || pending} className="video-fields">
        <div className="form-actions">
          <ConfirmButton
            message={`Send an account invitation to ${email}? No customer or horse access will be granted automatically.`}
          >
            Send customer invitation
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
