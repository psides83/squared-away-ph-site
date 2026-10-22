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

1. Apply the files in `supabase/migrations/` in filename order through your configured migration workflow, or through the Supabase SQL Editor (once per file). **Do not rerun migrations the GitHub integration has already applied.** The migrations provide the foundation, horse/customer save, training log, settings, expenses/inventory, receipts, billing-day inputs, invoices/payments, cash reporting, shared-cost allocations, and stay-reporting links. No horse, customer, expense, or stock records are seeded. Installations already using the billing calendar need `20261021000800_invoices_payments.sql` before opening Invoices. Apply `20261021000900_cash_reporting.sql` before opening Reports. Apply `20261021001000_shared_cost_allocations.sql` for Shared costs and the updated horse-margin report. Apply `20261021001100_stay_reporting.sql` for Income & cost links and the updated Reports screen. Apply `20261021001200_overview_expense_filters.sql` for expense filters and overview financial cards.
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
- Admin-only business settings for contact information, optional default monthly rate, billing day, partial-month policy, payment terms, and payment instructions/links. New stays prefill from those settings while existing stays retain recorded values. Finalized invoices preserve these contact/payment details. Payment links do not collect or confirm payments.
- Expenses with user-managed categories, horse/shared-barn assignments, paid dates, charge-back flags, editing/voids of standalone costs, and private receipt attachments (JPEG/PNG/WebP/PDF, 3 MB maximum).
- Feed/hay/supplement inventory with product-specific weight conversions, purchases/opening stock, weighted average valuation, waste/adjustments, and retained transaction snapshots. Stock purchases create their expense and quantity/value movement atomically; repeated requests cannot duplicate them.
- Saved daily rations and once-per-horse/date confirmation. Extras and partial feeding use manual inventory entries. Insufficient stock rolls back every line of a confirmation; saving a ration does not deduct anything. Outgoing stock reversals retain history and restore original cost once.
- Billing calendar with worked, billable-rest, and non-billable days, plus unclassified dates. Only elapsed days within a physical stay can be classified; only worked/rest count as billable. Corrections/clearing retain private audit history. Training logs do not automatically classify dates.
- Per-stay feed/boarding choices: unrecorded, included, separate monthly rate, actual cost, or not provided. Monthly prices are recorded on the stay; cost allocation and invoice calculation remain future work.

Billing days currently support 1–28. End-of-month billing conventions remain planned. Dashboard active stays include arrival and departure dates and exclude future stays. Business dates use America/Chicago.

Open **Settings** to enter your business values. A blank default training rate means not set; a zero rate remains a valid explicit choice. Terms use whole days with 0 meaning due upon receipt. Existing stays without previously recorded payment terms show an empty term field when edited, requiring an explicit choice rather than silently adopting today's default.

## Deliberately not implemented yet

Ownership transfer history, scheduled invoice generation, automatic feed/boarding invoice calculations, refunds/account credits, invoice emailing, multi-horse manual-invoice receipt splits, recurring expenses, purchase-cost/inbound-stock corrections, customer accounts/customer-visible updates, public marketing pages, and PWA installation/offline features. Calendar-day training proration is available in reviewed invoice drafts; other policies and feed/boarding lines need manual review and entry. Reminders do not send notifications. Charge-backs are added explicitly to drafts. No fake records are displayed.

## Overview and expense filters

The overview shows current invoice balances, overdue counts, month-to-date receipts/net cash, and recent invoice/payment/expense/training records. Financial cards use Chicago business dates and exclude voided/reversed activity from cash totals. The recent list is not a complete audit log.

Use Expenses filters to search literal vendor/note text and narrow by expense date, direct horse/shared-barn assignment, category, or payment/void status. Filters stay in place across pages. These dates refer to when the expense occurred; cash reports use its paid date. Shared allocations remain under Shared barn in the expense book.

## Cash reports

Open **Reports** and choose an inclusive date range (defaults to the current year through today). View payments received, expenses paid, net cash profit, monthly results, and paid expense categories. Unpaid and reversed records are excluded; corrections update historical results. Feed consumption is not deducted again after its purchase expense. Totals include every matching record, even beyond API list limits.

Outstanding and overdue invoices show current balances across all dates, separate from the cash period. Shared expenses are included once in business totals. Horse cash margins show receipts on stay-linked invoices, direct paid costs, and allocated shared paid costs. Manual invoices use explicit reporting assignments or remain visibly unassigned. Unallocated shared expenses are shown separately. Stay margins use original invoice stays or reporting links, plus reviewed direct/shared cost splits. Unassigned remainders remain visible. Business, horse, and stay summaries use the same database snapshot and reconcile to business net cash profit. Reports cover recorded activity only and do not move money.

## Shared barn costs

1. Record a cost assigned to **Shared barn** in Expenses, or record a stock purchase in Inventory. Open **Shared costs**, select the expense, and choose the actual boarding period it covers (up to 366 elapsed days).
2. Review the physical training-stay day defaults. Enter actual days for your own horse profiles and boarding outside training stays; zero excludes a horse. Your own horses use their existing horse profiles, with you recorded as owner. They do not need a training stay or invoice to receive an allocation.
3. Review the dollar preview and enter a reason confirming the period, participants, and any overrides. Save the split. Every penny is distributed by boarding days using largest remainder; the original expense remains the only business cost.
4. Review saved counts and history from the expense. Revising retains the earlier split; clearing requires a reason. Source amounts/assignments/date/void status are protected while an allocation is active. Later training-stay changes do not change saved splits.
5. Open Reports. Shared costs appear in horse margins on the original expense's paid date, not the boarding-period dates. Unpaid costs stay outside cash results. Unassigned receipts and unallocated costs remain visible, so partial margins are not presented as complete horse profitability.

## Income and stay cost assignments

Open **Income & cost links**. Manual invoices can assign all their receipts to one horse and optionally a stay for the same horse and invoice billing customer. Invoice details and payments are unchanged; the reporting assignment applies to earlier and later receipts. Clear or revise with a reason. Multi-horse receipt splitting is not yet available.

Direct horse expenses and saved shared-cost horse portions can be divided among that horse's stays. Enter exact dollar amounts, leave other stays at zero, and review the unassigned remainder. The total cannot exceed the original horse cost. Payment dates determine the cash reporting period, even if the stay ended earlier. Your own horses can retain horse-level costs without a training stay.

Revisions retain history. Changing a shared-cost horse split stops its previous stay assignments contributing to current reports; review the new portions before assigning them to stays. Previous splits remain reviewable from Shared costs. Active direct-cost assignments protect the expense's amount/horse/date/void status until cleared. These reporting changes never create another expense, issue a customer bill, or transfer money.

## Invoice workflow

1. Open **Invoices** and create a draft for a customer, optionally linking a training stay and billing period. Confirm the due date; stay terms take precedence over today's defaults. Legacy stays with unknown terms require a manually chosen due date.
2. Add manual charges/credits or generate training charges from classified calendar days. Automatic training calculations currently require calendar-day proration and an elapsed period within one month. Review the calculation and enter any feed/boarding charges manually from the agreement.
3. Add eligible reimbursable expenses, optionally with an explicit handling fee. A source expense or billable date cannot be claimed twice. Removing a draft line releases its source.
4. Review and finalize. The assigned number, original charges, customer, and business payment details are preserved. Use **Print / save PDF** for a printable copy.
5. Record actual payments after receiving them. Multiple partial payments reduce the remaining balance. Opening Venmo/PayPal links does not record a payment; Apple Cash uses your saved instructions.
6. Correct issued bills using adjustments or reasoned payment reversals. These records do not transfer or refund money. A void retains history and requires all payments to have been reversed; source claims are then released.

## Billing calendar workflow

Open **Billing calendar** or the link on a training stay. Choose a stay and month, then mark actual worked, billable-rest, and non-billable dates. Clear an incorrect classification to return it to unclassified; its change history remains. Unmarked dates never count as billable. Arrival/departure days count only when explicitly classified. Future dates are not eligible. Existing training notes do not imply a billing status.

Feed and boarding terms are editable on the training-stay form. Legacy stays show **Not recorded** until an agreement is chosen. Record a separate monthly price only when that mode applies. Changing a mode or rate records your agreement; it does not issue an invoice or calculate actual-cost reimbursement.

## Expense and inventory workflow

1. Add products in **Inventory** and configure the actual weight of each bag, scoop, flake, or other unit. Pounds and ounces are fixed weight units; custom serving units need their own conversion. Use separate batch-named units where hay/package weights differ.
2. Record existing stock as **Opening stock** with its current value (no cash expense). Record new purchases as **Purchase stock** to save the expense and inventory together. Do not separately re-enter the purchase as an expense. Purchase payment dates can be updated from Expenses.
3. Attach receipts from the saved expense/purchase record. Files are private and downloaded through authenticated routes with signed URLs that expire after 60 seconds. Actual receipt uploads require the storage migration, not just the expense tables.
4. Save each horse's daily ration in **Feeding**, then confirm only after the whole daily ration was actually fed. Confirming the same horse/date again is safe. Use manual feeding entries for partial rations or extras. A ration edit changes future confirmations only.
5. Correct feeding/waste/reductions from stock history with a reason. Reversals return stock at the original cost once, and retain the original entry. Reversing a daily entry does not reset that day's confirmation; record corrected feeding manually.

Inventory quantities and values use six-decimal precision, with weighted average valuation in recording order. A backdated entry does not replay previous valuations. Purchase costs/inbound entries are protected and cannot yet be reversed or edited; do not use an unrelated cash expense to silently change stock value. Cash reports (when added) must use expenses paid; they must not also deduct feeding consumption cost.

## Verify

```sh
npm run test
npm run typecheck
npm run build
```

The tests cover server-side validation and run actual SQL migrations in a local PostgreSQL runtime (PGlite) with simulated Supabase auth roles. They cover horse/customer history, private training records and settings, weighted inventory costing, insufficient-stock rollback, purchase/expense atomicity, idempotent daily confirmations and reversals, fixed unit conversions, receipt type/size checks, and non-admin denial. Local receipt policy tests use simulated storage tables; they do not exercise Supabase's upload service or replace authenticated browser testing.

Development and production builds use Next.js's webpack engine because Turbopack's worker port binding is restricted in the local execution environment.

## Vercel

Import `psides83/squared-away-ph-site`, select the Next.js framework, and use Node 22+ (24 is also supported). Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the appropriate environment. Redeploy after changing public variables. Use a separate development/preview database rather than pointing previews at production.

No service worker caches private records. Authentication routes send private/no-store headers. The marketing website can receive its own public metadata when added.

See [the product roadmap](docs/product-plan.md) for the larger scope.
