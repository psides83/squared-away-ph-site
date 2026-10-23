# Password recovery setup

The app has **Forgot password?**, an explicit link-confirmation step, and a password-setting screen. No application database migration or service-role key is required. It uses existing Supabase Auth users; it does not create accounts or change administrator/customer/horse access grants.

## Production setup

1. Set `NEXT_PUBLIC_SITE_URL=https://squaredawayperformancehorses.vercel.app` in Vercel Production (or the final canonical domain when chosen), then redeploy. This must be an HTTPS origin only, without a path, query, credentials or fragment. Recovery requests do not trust incoming Host/forwarded headers or user-supplied redirects.
2. In Supabase **Authentication → URL Configuration**, set Site URL to the same canonical origin. Allow the exact redirect URL `https://squaredawayperformancehorses.vercel.app/auth/recovery`. Use a separate development project for localhost testing; do not broaden production redirects to arbitrary sites.
3. In **Authentication → Email Templates → Reset Password**, use the provided `supabase/templates/recovery.html`. Its link sends `TokenHash` to `/auth/recovery?token_hash=…&type=recovery`, rather than the default confirmation URL. This template change is required for the implemented server-side flow; default browser-fragment/PKCE callback links are not handled here. Keep the configured Site URL and app origin aligned.
4. Configure/verify the project’s production email delivery, sender and provider limits. Supabase’s hosted default delivery may be restricted; use a suitable production SMTP provider. Delivery, rate limits, CAPTCHA/custom Auth policies, link lifetime and account existence are controlled by Supabase. This increment does not add CAPTCHA challenge handling. Restrictive custom Auth policies may need additional app work; no policy is weakened by the implementation.
5. Test with a designated test account and its actual inbox, with authorization to send email and change that account’s password. Verify desktop and phone flows, expired/reused links, password update and subsequent sign-in, and unchanged portal access grants. Local mock/browser checks alone do not confirm email delivery or production Auth configuration.

## Behavior

- Requests return the same generic sent state for known/unknown accounts and provider delivery/rate-limit failures. A sent screen does not establish delivery. No user email or password is put in redirect URLs or application logs.
- Opening a token URL only renders a Continue button. The server consumes the recovery token on explicit form submission. This reduces exposure to link-prefetch scanners that only perform GETs; aggressive scanners that submit forms are outside that protection.
- Confirmation accepts only `type=recovery`, verifies through Supabase, and redirects to a fixed `/reset-password`. Arbitrary `next` destinations and other token types are ignored/rejected. Supabase establishes the session and enforces token validity/expiry/one-time use.
- The server revalidates identity with `auth.getUser()` before `updateUser`. The new password must match its confirmation and be 12–128 characters; password whitespace is preserved. Supabase can enforce stronger additional policies. Any valid existing session can also set its own password on this screen; there is no ability to select another user.
- After a successful password update the app attempts global sign-out and asks the user to sign in again. A failure during sign-out does not pretend the already-saved password was unchanged. Provider session/JWT invalidation rules still apply; remote revocation behavior is not established by local mocks.
- Recovery pages send private/no-store and no-referrer headers through the session proxy. Keep these pages free of third-party analytics that might collect token URLs. Never paste real recovery links/tokens/passwords into logs, chat or screenshots.
- Owner-provisioned customers can use this flow to choose a password for an existing email account. In-app invitations/account creation, invite-type token handling, email changes and additional reauthentication policies remain separate planned work.

References: [Supabase password recovery](https://supabase.com/docs/guides/auth/passwords), [server-side email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
