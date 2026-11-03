# Customer invitation setup

The app accepts owner-issued Supabase invitation links at `/auth/invite`. It does not yet send invitations or create accounts from the customer record. No invitation was sent or live account created during implementation.

## Current delivery limitation

The owner confirmed on November 3, 2026 that the project still uses Supabase’s default email service. Supabase documents that this service sends only to project-team email addresses and is intended for testing. Customer invitation and password-reset delivery to ordinary customer addresses requires a configured custom SMTP sender (or another separately implemented delivery integration). Do not treat the acceptance route as production-ready email delivery. No sender/account was configured and no email was sent during this work.

Reference: [Supabase custom SMTP and default-service restrictions](https://supabase.com/docs/guides/auth/auth-smtp).

## Provider setup

1. Keep the Supabase Site URL aligned with the production app’s canonical HTTPS origin, currently `https://squaredawayperformancehorses.vercel.app`.
2. In Authentication → Email Templates → Invite user, use `supabase/templates/invite.html`. It points directly to `/auth/invite?token_hash=…&type=invite` using `SiteURL` and `TokenHash`. Default confirmation URLs with browser-fragment sessions are not handled by this flow.
3. If the provider invitation operation supplies a redirect, allow only the exact production `/auth/invite` URL. Use a separate test project for localhost testing. Verify mail delivery settings and provider limits before inviting real customers.
4. Issue an invitation using the provider’s administrator tools. The customer opens the email, deliberately accepts, chooses a matching 12–128 character password, then signs in. Tokens expire and are single-use under Supabase’s rules; a reused/expired link requires a new invitation from the owner.
5. Assign the verified account to its customer using the existing admin access workflow. Grant horse access deliberately. Accepting an invitation does not create a customer link, horse grant or administrator role. Unassigned accounts reach the existing access-needed screen.

## Safety and limitations

- GET only displays a confirmation form; it does not verify or consume the token. Explicit submission accepts only invite-type bounded hashes and requires a provider-verified user and session before redirecting to the fixed password screen.
- Recovery links retain their separate recovery-only route. Caller-controlled redirects are not accepted. Failures return to a token-free fixed URL with a generic message.
- The session proxy covers `/auth/invite` with private/no-store, no-referrer and noindex headers. Keep token pages free from analytics, and never copy real tokens/passwords into logs or screenshots.
- Existing password setup verifies the current identity, attempts global sign-out after a successful update and returns to sign-in. Existing signed-in accounts can also set their own password; this is not an additional role or permission grant.
- In-app invitation sending, customer account provisioning, delivery history/resend and email changes remain separate future work. No service-role credential is added to the browser.
- Production template configuration, actual invitation/expiry/reuse behavior, email delivery, customer assignment and physical-device checks remain unverified. No database migration is required for this route.

References: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [Supabase OTP verification](https://supabase.com/docs/reference/javascript/auth-verifyotp).
