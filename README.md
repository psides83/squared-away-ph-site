# Squared Away Performance Horses

Private barn office for Squared Away Performance Horses in Granbury, Texas.

Built with Next.js App Router, TypeScript, Tailwind CSS, and Supabase. Designed for deployment to Vercel from this GitHub repository.

## Run locally

Use Node.js **22 or newer** (the Supabase dependency requires it).

```sh
npm ci
cp .env.example .env.local
# Fill in the two public Supabase connection values in .env.local.
npm run dev
```

If an existing `.env` already contains those values, Next.js reads it; copying another file is unnecessary. Environment files are ignored by Git. Never add a service-role key to a `NEXT_PUBLIC_` variable.

Open http://127.0.0.1:3000. The root opens the admin area, which requires sign-in. The public marketing site is a later phase.

## Set up Supabase

1. Apply the files in `supabase/migrations/` in filename order through your configured migration workflow, or through the Supabase SQL Editor (once per file). **Do not rerun migrations the GitHub integration has already applied.** The foundation migration creates tables, constraints, default reminder categories, and row-level security policies. The horse/customer migration adds the atomic save function. The training-log migration adds private session/note history. No customer or horse data is seeded. Installations already using horse/customer selection only need the new `20261021000300_training_log.sql` migration.
2. In Supabase Authentication → Users, create your administrator account with an email and password. Confirm its email through the dashboard if needed. There is no public sign-up flow.
3. Grant administrator access from the SQL Editor, replacing the example email with the exact account email:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'YOUR_EMAIL_HERE'
on conflict (user_id) do nothing;
```

Verify the statement inserts one user (or that the user already exists in `admin_users`). Only this trusted SQL process can grant administrator status; app users cannot grant it to themselves.

4. Sign in at `/login`.

You can use the app without the Supabase GitHub integration; that integration manages database deployment and branching rather than the app's runtime connection. Configure its working directory as `.` when `supabase/` lives at the repository root. Do not enable automatic production migrations until the migration workflow is understood and reviewed.

## Included in this increment

- Admin-only dashboard, live record counts, and empty states.
- Create, view, edit, and delete customers and horse profiles.
- Require at least one customer when saving a horse. Support shared ownership, editable customer links after a sale, and linked horses in the customer list. Horse/customer saves are atomic; changing ownership does not change existing training stays or billing responsibility. Existing horses without a customer can be linked by editing their profile.
- Training stays with one billing customer, dates, a monthly rate stored in cents, billing day, and a recorded partial-month policy.
- Database-enforced prevention of overlapping stays for one horse.
- Reminder and category CRUD, completion/reopening, optional horse links, and overdue status.
- Private training log with dated sessions and progress notes, optional session duration, create/edit/delete, horse filtering, and 25-entry pagination. Quick entry links are available on the dashboard and horse cards. Training history remains with the horse after sales and prevents accidental horse deletion.
- Mobile layouts, accessible form labels, pending submission states, and delete confirmations.
- Server-side authorization and database row-level security.

Billing days currently support 1–28. End-of-month billing conventions can be added when billing is implemented. Dashboard active stays include arrival and departure dates and exclude future stays. Business dates use America/Chicago.

## Deliberately not implemented yet

Ownership transfer history, invoices/payments, expense receipts and file storage, profitability reports, customer accounts/customer-visible updates, public marketing pages, and PWA installation/offline features. Training stay policies are recorded only; no charges or proration are calculated. Reminders do not send messages or notifications. No fake records are displayed.

## Verify

```sh
npm run test
npm run typecheck
npm run build
```

The tests cover server-side validation and run the actual SQL migrations in a local PostgreSQL runtime (PGlite) with simulated Supabase auth roles. Database tests verify shared customer links, ownership changes, retained billing responsibility, rollback on failed saves, training log CRUD and retained history, duration constraints, and denial of non-admin access. They do not replace live Supabase/browser end-to-end testing.

Development and production builds use Next.js's webpack engine because Turbopack's worker port binding is restricted in the local execution environment.

## Vercel

Import `psides83/squared-away-ph-site`, select the Next.js framework, and use Node 22+ (24 is also supported). Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the appropriate environment. Redeploy after changing public variables. Use a separate development/preview database rather than pointing previews at production.

No service worker caches private records. Authentication routes send private/no-store headers. The marketing website can receive its own public metadata when added.

See [the product roadmap](docs/product-plan.md) for the larger scope.
