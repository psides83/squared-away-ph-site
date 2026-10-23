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

Open http://127.0.0.1:3000. The root opens the admin area, which requires sign-in; linked customer accounts are redirected to their customer portal. The public marketing site is a later phase.

## Set up Supabase

1. Apply the files in `supabase/migrations/` in filename order through your configured migration workflow, or through the Supabase SQL Editor (once per file). **Do not rerun migrations the GitHub integration has already applied.** The migrations provide the foundation, horse/customer save, training log, settings, expenses/inventory, receipts, billing-day inputs, invoices/payments, cash reporting, shared-cost allocations, and stay-reporting links. No horse, customer, expense, or stock records are seeded. Installations already using the billing calendar need `20261021000800_invoices_payments.sql` before opening Invoices. Apply `20261021000900_cash_reporting.sql` before opening Reports. Apply `20261021001000_shared_cost_allocations.sql` for Shared costs and the updated horse-margin report. Apply `20261021001100_stay_reporting.sql` for Match income & expenses and the updated Reports screen. Apply `20261021001200_overview_expense_filters.sql` for expense filters and overview financial cards. Apply `20261021001300_service_billing.sql` before using feed/boarding invoice generation. Apply `20261021001400_customer_portal.sql` before enabling customer accounts or published updates. Apply `20261021001500_horse_files.sql` for private horse uploads and customer file sharing.
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
- Per-stay feed/boarding choices: unrecorded, included, separate monthly rate, actual cost, or not provided. Monthly prices are recorded on the stay and feed/boarding invoice tools use the agreed physical-day or actual-cost basis.

Billing days support 1–31. Shorter months use their last day, returning to the original anchor in longer months. Recurring cycle preparation supports operator-started and protected daily scheduling; see the deployment guide before enabling it. Dashboard active stays include arrival and departure dates and exclude future stays. Business dates use America/Chicago.

Open **Settings** to enter your business values. A blank default training rate means not set; a zero rate remains a valid explicit choice. Terms use whole days with 0 meaning due upon receipt. Existing stays without previously recorded payment terms show an empty term field when edited, requiring an explicit choice rather than silently adopting today's default.

## Deliberately not implemented yet

Customer refunds/account credits, invoice emailing, multi-horse manual-invoice receipt splits, video transcoding/cross-refresh resume, in-app invitation emails/account creation, public marketing pages, and offline editing/private-record caching. Calendar-day training proration and source-linked feed/boarding charges are available in reviewed drafts; other training policies require manual lines. Reminders do not send notifications. Charge-backs are added explicitly to drafts. No fake records are displayed.

## Horse photos and documents

Upload private photos or documents in **Horse files** (JPEG/PNG/WebP/PDF, up to 3 MB). Choose Document for PDF files. Review the preview and title, then explicitly publish only files appropriate for every customer with permitted access to that horse. Keep customer-specific billing documents and financial receipts in billing records. Files do not inherit publication from training notes or receipt uploads.

Customers use **Photos & docs**. Metadata and Storage policies enforce the same manual horse grants and publication-date bounds as updates. Unpublish before revising a title; archive to hide a file while retaining the owner copy/history. App-generated links expire after 60 seconds. Revocation/unpublishing blocks fresh portal requests; it does not withdraw copies already opened or downloaded. There is no customer upload feature, public file bucket, video upload, or offline private-file cache.

Actual Supabase upload/download and real customer sessions must be checked after migration. Local policy tests simulate Storage tables rather than the upload/signing service.

## Install on a phone or computer

Open `/login` and expand **Add Squared Away to your home screen**. Supported browsers can show an Install app button. Safari on iPhone/iPad uses Share → Add to Home Screen; Safari on Mac uses File → Add to Dock. The installed app opens at sign-in and routes each account to its own portal.

The app requires a network connection. It registers no service worker and does not save private records for offline use. Manifest/icons are public assets; admin and customer responses remain private/no-store. The icons use the provisional brand mark until the final logo is supplied. Device installation still needs a real-device check after deployment.

## Customer portal setup

1. Create a customer sign-in account in Supabase Authentication using your trusted owner workflow. There is no public registration or automatic email invitation in this increment. Do not share your administrator login or put a service-role key in the browser.
2. In **Portal access**, select the customer and link the exact existing sign-in email. One login maps to one customer record. Replacing or disabling that link removes the old session's customer access on subsequent reads.
3. Grant each horse explicitly. New grants default to updates published from today; clear the date only when you intend to share all published history. Ownership changes do not change these grants automatically. Review/revoke access whenever a horse is sold.
4. Write separate customer-facing text in **Customer updates**. Saving creates a draft; publish only after review. Private training/health notes are not exposed or copied. Unpublish before revising; republishing has a new publication date. Archiving hides the update and retains history.
5. Customers sign in through `/login` and use `/portal`. They see only granted horses/published updates and invoices/payments billed to their own customer record. Removing horse access does not remove their own billing history. Account disable blocks the entire portal.

Customer invoice projections omit internal payment notes/references and source-cost snapshots. Customer tables remain closed to direct reads; scoped database functions return only allowed fields. Live authentication and browser flows still need testing with owner-created customer accounts after migration. The tests simulate Supabase auth roles and do not send invitation emails or create production accounts.

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

Open **Match income & expenses**. Manual invoices can assign all their receipts to one horse and optionally a stay for the same horse and invoice billing customer. Invoice details and payments are unchanged; the reporting assignment applies to earlier and later receipts. Clear or revise with a reason. Multi-horse receipt splitting is not yet available.

Direct horse expenses and saved shared-cost horse portions can be divided among that horse's stays. Enter exact dollar amounts, leave other stays at zero, and review the unassigned remainder. The total cannot exceed the original horse cost. Payment dates determine the cash reporting period, even if the stay ended earlier. Your own horses can retain horse-level costs without a training stay.

Revisions retain history. Changing a shared-cost horse split stops its previous stay assignments contributing to current reports; review the new portions before assigning them to stays. Previous splits remain reviewable from Shared costs. Active direct-cost assignments protect the expense's amount/horse/date/void status until cleared. These reporting changes never create another expense, issue a customer bill, or transfer money.

## Invoice workflow

1. Open **Invoices** and create a draft for a customer, optionally linking a training stay and billing period. Confirm the due date; stay terms take precedence over today's defaults. Legacy stays with unknown terms require a manually chosen due date.
2. Add manual charges/credits or generate training charges from classified calendar days. Automatic training calculations require calendar-day proration and an elapsed period within one month. Review generated training and service lines before finalizing.
3. Add eligible reimbursable expenses, optionally with an explicit handling fee. A source expense or billable date cannot be claimed twice. Removing a draft line releases its source.
4. Review and finalize. The assigned number, original charges, customer, and business payment details are preserved. Use **Print / save PDF** for a printable copy.
5. Record actual payments after receiving them. Multiple partial payments reduce the remaining balance. Opening Venmo/PayPal links does not record a payment; Apple Cash uses your saved instructions.
6. Correct issued bills using adjustments or reasoned payment reversals. These records do not transfer or refund money. A void retains history and requires all payments to have been reversed; source claims are then released.

## Billing calendar workflow

Open **Billing calendar** or the link on a training stay. Choose a stay and month, then mark actual worked, billable-rest, and non-billable dates. Clear an incorrect classification to return it to unclassified; its change history remains. Unmarked dates never count as billable. Arrival/departure days count only when explicitly classified. Future dates are not eligible. Existing training notes do not imply a billing status.

Feed and boarding terms are editable on the training-stay form. Legacy stays show **Not recorded** until an agreement is chosen. Record a separate monthly price only when that mode applies. Changing a mode or rate records your agreement; use the explicit invoice tools to generate and review service charges.

## Feed and boarding invoice charges

For **Separate monthly rate**, generate feed or boarding using every physical day within the stay/invoice period, including non-training days. Divide the recorded monthly price by the actual days in that calendar month and round the result once. Use one elapsed calendar-month period per generated monthly line; arrival/departure are included, and zero rates are valid.

For **Charge actual cost**, feed uses saved weighted costs of actual unreversed feeding movements. Purchases and waste are excluded. The sum is rounded once and source documentation is retained. Boarding uses a selected, reviewed cost portion assigned to the stay through Match income & expenses. Review its purpose and invoice period; do not select feed purchases already recovered through consumed feed or unrelated costs. Expense dates are displayed, but are not used to guess the boarding period.

Included/not-provided agreements generate no separate charges. Source claims prevent duplicate billing and monthly/actual-cost overlap. Reversing billed feeding entries and revising boarding allocations require releasing the source by removing a draft line or voiding an unpaid invoice. This preserves the original bill and source snapshots. Manual lines require your own duplicate review; they do not automatically reserve source records.

## Expense and inventory workflow

1. Add products in **Inventory** and configure the actual weight of each bag, scoop, flake, or other unit. New products start with milligram, gram, kilogram, pound, weight ounce, US ton, and metric tonne conversions. After migration `20261022002900_editable_inventory_conversions.sql`, every product conversion name and assigned weight is editable, including starter units. Physical measurement references in the editor remain standard weights; configured conversion names do not override their assigned weight. Use separate batch-named units where hay/package weights differ. Cups, teaspoons, tablespoons, mL, and liters need a measured product-specific weight. Migration `20261021001600_metric_weight_units.sql` adds standard units to existing and new products, preserves old custom conversions under legacy labels, and expands base-weight precision.
2. Record existing stock as **Opening stock** with its current value (no cash expense). Record new purchases as **Purchase stock** to save the expense and inventory together. Do not separately re-enter the purchase as an expense. Purchase payment dates can be updated from Expenses.
3. Attach receipts from the saved expense/purchase record. Files are private and downloaded through authenticated routes with signed URLs that expire after 60 seconds. Actual receipt uploads require the storage migration, not just the expense tables.
4. In **Feeding**, save each horse’s ration separately for Morning, Evening, or a custom feeding time. Enter the quantity for that feeding, not the whole day. Confirm only after that feeding was actually given; repeating the same horse/date/time is safe. Use manual entries for partial feedings or extras. Ration edits affect future confirmations only.
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

### Deliberate editing and bulk feeding

Admin overviews show records first. Add/Edit/Record buttons open focused dialogs; Escape or Close dismisses the editor and resets unsaved fields. Existing direct links still open the relevant editor.

Daily feeding offers **Confirm a feeding in bulk** and **Record extras for multiple horses**. The latter uses one product/unit with a quantity per horse for extras or partial feedings. Batches save together, retain per-horse weighted costs, and are safe to retry. Apply `20261021001700_bulk_feeding.sql` before using these batch actions.

### Feeding times

Apply `20261021001800_feeding_times.sql` after the preceding migrations. Saved rations are grouped by horse and feeding time. Morning and Evening are provided; **Manage feeding times** adds custom times with optional clock times, ordering, and archive controls. The same feed or supplement can have different quantities at different times.

Existing daily totals stay unassigned. Use **Assign feeding time** to edit the unassigned group together, choosing an empty feeding time and entering each per-feeding amount. Add a separate scheduled time if the same product is fed again later. Assign all active lines for a horse before confirming scheduled rations. Historical full-day confirmations cannot be duplicated as timed confirmations on the same date. Individual and bulk confirmations record only the chosen time; extras can be tagged with a time or remain unscheduled. History retains its original label and cost when a feeding time is renamed.

### Feed/board defaults and customer invoice format

Apply `20261021001900_service_defaults_invoice_format.sql`. In Settings, monthly feed and board charges prefill new training stays; blank means unset and zero is allowed. Existing stays retain their terms. Actual business expenses are still recorded separately.

Choose **Invoice format** on each customer: itemized, or combined training/feed/board. Other charges stay separate. Manual invoice lines choose a category; generated service lines classify automatically. The invoice document and portal show the customer format, while **Review detailed charges** preserves the full internal breakdown. Finalization saves the selected format; changing a customer later does not restyle issued invoices. Existing issued invoices remain itemized.

### Mobile forms and receipt capture

Admin mobile screens use bottom navigation and full-screen editors. Inputs are compact; currency and quantities show their signs/units without changing stored numeric values. US phones display as `(123) 456-7890`. Serving-count units have touch buttons; standard numeric browser spinners are hidden. Training focus shortcuts speed up routine logs.

Stock purchases can include a private receipt from **Take photo** or **Choose file**, with larger photos prepared on the device. Purchase/expense data saves first; receipt failures direct you to the saved expense for attachment retry. Identical receipt content is attached once per expense. Existing expense attachments use the same capture controls. This increment needs no new database migration, but the existing private receipt/storage migrations must already be applied.

Automatic receipt reading is not connected. See [receipt-scanning.md](docs/receipt-scanning.md) for the extraction, product matching, review, and multi-item purchase work that remains.

## Read-only deployment check

Run `npm run verify:deployment -- https://squaredawayperformancehorses.vercel.app` after a deployment. This checks sign-in availability, signed-out protection and caching, the install manifest, and every declared icon’s PNG dimensions. It requires Node 22+ and network access, uses no credentials, and changes no records. It does not establish that migrations have applied or authenticated workflows work; those require an administrator session and separate verification.

## Ownership history

Apply `20261022002800_ownership_history.sql` in migration order. Horse records then show **Customers & ownership** with current links and recorded additions/removals or relationship changes. Existing links receive an explicit starting baseline; the app does not infer earlier sale dates. History retains the name recorded at the time, is administrator-only, and prevents horse deletion. Correct links through the horse editor; past events remain. Ownership changes do not change existing stay billing responsibility or manual portal grants.

## Shared app controls

Use the shared app controls for consistent UI: `AppSelect` for choices, `FormInput`/`TemporalInput` for formatted fields and calendar/time pickers, and `ConfirmButton` or its Delete/Invoice wrappers for confirmations. The global validation component displays inline errors while preserving HTML constraints and server validation. Pickers use styled dialogs with focus containment and Escape dismissal; closing a nested picker does not reset its surrounding editor. Native camera/file selection, installation, and printing remain system capabilities launched from app controls. Avoid new browser alert/confirm/prompt calls or visible native dropdown/date/time menus.

## App actions, conversions, and help

Inventory product names are headings. Use **Record stock**, **Manage product**, or **Conversions** on the card. Product management separates details from conversions; use each conversion’s **Edit** action to change its name or weight. Changes affect future entries and saved-ration confirmations, while current stock and past transactions keep their saved weights/costs. Names preserve capitalization and must be unique per product ignoring case. Untouched metric conversions preserve exact metric arithmetic even when renamed.

Long optional instructions use a collapsed HelpPanel. Shared workspaces use modern action styling and clear record links; customer navigation becomes a bottom bar on phones. Errors and operational warnings stay visible.

## Feed cost versus charges

Apply `20261022003000_feed_charge_comparison.sql` in migration order. In **Reports → Feed cost vs charges**, select service dates to compare each horse’s recorded feed/hay/supplement cost with generated finalized feed charges. Draft charges and actual-cost feeding not on invoices are separate. Expand agreement/invoice detail to review sources. Payments do not change this comparison.

Monthly amounts follow saved source days and calendar-month weights; actual-cost amounts follow claimed consumption. Saved invoice cents reconcile across date slices. Corrections restate original feeding dates in this report, while Feed usage follows ledger dates. Bundled feed, invoice-wide adjustments, unsupported manual charges, and missing feeding records limit comparability and are flagged. This is recorded feed margin, not cash or whole-business profit; it does not establish that every feeding was logged.

## Daily automatic billing

See [automatic-billing.md](docs/automatic-billing.md) for migration 031, required production-only server credentials, Vercel's daily schedule, explicit administrator enablement, run history, and verification. The feature defaults off. Existing calendar/actual-cost readiness checks remain mandatory; production scheduling has not been verified merely by deploying this code.

## Recurring expense bills

Apply migration `20261022003200_recurring_expenses.sql`. **Expenses → Recurring expenses** holds regular bill schedules. Create a due bill to save an unpaid expense, then review its actual amount, attach the receipt and mark it paid normally. Weekly/monthly/quarterly/yearly schedules support pause/resume and reasoned skips. Monthly anchors return to their original day after short months. Editing the schedule affects future bills; generated bills keep their saved values and can be reviewed through their expense records. Voiding one does not recreate it. No inventory receipt or payment is inferred. Daily expense creation has a separate opt-in setting after migration 034; it is independent of automatic invoice enablement.

## Correcting a purchase entry

Apply migration `20261022003300_purchase_entry_corrections.sql`. In **Inventory → Stock history**, choose **Correct purchase entry** to replace a quantity/unit/cost entry error. Only a product’s latest purchase before later stock activity is eligible; ambiguous equal recording timestamps block the change. Replacements save atomically and respect existing invoice/shared-cost source guards. The original expense becomes void but retains receipts, and both expense records link to each other. Purchase date/vendor/payment date carry over; current unit conversions apply to the replacement. Cash reports restate that original paid expense to the corrected cost. This does not record a supplier return/refund. Opening stock, inbound adjustments and purchases with downstream activity require a future correction workflow.

## Automatic unpaid expense creation

Apply `20261022003400_scheduled_expenses.sql` before deploying the updated daily endpoint. In **Expenses → Recurring expenses → Automatic creation**, explicitly enable the feature after completing [scheduler setup](docs/automatic-billing.md). It defaults off, independently of invoice automation. The daily worker creates one due unpaid occurrence per active schedule (up to 50 schedules), oldest dates first, with private run history and a stale-check warning. Backlogs advance over successive days; manual preparation and skips share the same sequence. Actual payment is always recorded separately. No production scheduling is established by code completion alone.

## Expense recovery

Apply migration `20261022003500_expense_recovery_report.sql`. In an issued invoice’s **Payments** tab, use **Assign payment to expense** to designate original expense cost repaid by a recorded active payment. Only linked expense costs are eligible. Amounts are capped by payment availability, the linked cost on that invoice, and the original expense cost overall. Edit/remove assignments deliberately with reasons; history is retained. Reversed payments stop counting automatically. Fees, credits and settled balances do not automatically assign recovery.

**Reports → Expense recovery** selects expenses paid to vendors during the report dates and shows current cumulative assigned recovery, even when a customer paid later. It separates finalized/draft billing coverage, fees and not-separately-billed costs. Missing assignments can understate recovered cost; unbilled does not establish intent to absorb a cost or allocate bundled training revenue. The latest 100 expense details are shown, with totals covering all matching expenses. These are breakdowns of existing costs and payments: cash revenue is never added again. Production migration and authenticated assignment/report behavior require separate verification.

## Account password recovery

**Forgot password?** supports existing accounts, explicit email-link confirmation, and setting a new password. It needs no new application migration. Configure the canonical `NEXT_PUBLIC_SITE_URL`, Supabase Site URL/allowed redirect, and the included reset email template before relying on production recovery. See [password-recovery.md](docs/password-recovery.md). No recovery emails or password changes are performed by build/test verification.

## Horse care records

Apply migration `20261022003600_horse_care.sql`. A horse record’s **Care** tab logs completed care, with private-by-default date/type/summary/provider/details and separate trainer-only notes. Use **Share with customers** deliberately after reviewing its preview; manual horse portal grants still determine access. The customer horses page has separate Progress updates and Care records tabs. Private notes and audit fields are excluded by the customer RPC, and direct tables remain administrator-only.

Unshare before editing. Archive removes a record from the customer view; restore returns it to private. Revisions, retry-safe requests and private before-state events retain history. Visible-from filters use the publication date, consistently with existing progress updates. Lists paginate 25 records at a time. Future tasks belong in Reminders; care entries do not generate invoices, expenses or inventory entries. Remote migration and authenticated production sharing require separate verification.

## Private horse videos

Apply `20261023003700_horse_videos.sql`. **Horse files → Upload video** accepts MP4/MOV/WebM clips up to 50 MiB, directly to a separate private video bucket with TUS resumable uploads. Keep the editor open for retry/resume; attachment retries reuse the completed object. Production Storage’s global limit must permit the bucket’s 50-MiB limit. The app server only handles metadata. The bucket and table checks preserve the existing 3-MiB photo/document limits.

Videos begin private. Review and publish them through existing horse-file controls; active manual horse portal grants determine customer access. Metadata size/type is checked at attachment, and retrying does not duplicate file/audit records. Inline playback uses the browser/device’s media capabilities; no transcoding is performed. Signed video access lasts up to five minutes, so revocation cannot invalidate a previously issued link immediately; reload requests fresh authorization. Unsupported codecs can be downloaded for viewing elsewhere.

Incomplete/abandoned uploads and prepared intents may remain private after closing an editor; automated cleanup and cross-refresh resume are not implemented. Use a designated non-production project for actual upload tests. No real media is uploaded by local build/test checks. Provider reference: [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).

### Purchase cost recalculation (migration 040)

From stock history, **Correct quantity / cost** can recalculate this product's historical weighted costs after a mistaken receipt total, including later consumption, waste and reversals. Quantities and receipt attachments stay unchanged; the expense amount changes at its original transaction/payment dates. This explicitly restates operational cost reports, unlike an ordinary later purchase. All before/after values are audited. Billed/shared-allocated purchase expenses retain their existing guards and must be released first.

**Cost corrections & invoice reviews** lists pending reviews and retained correction decisions. Source-linked actual-feed invoices and stay invoices covering changed feeding dates are flagged. Issued charges/payments never change automatically; review and record any appropriate invoice adjustment. For drafts, remove/regenerate outdated actual-feed lines, record your review, and mark actual-cost periods ready again where needed. Pending flags block finalization. Further corrections create new reviews. Manually attributed invoices without reliable feed source or stay-period links require manual review.

The correction supports at most 2,000 stock entries per product. Durable recording order supports new bulk entries. Ambiguous legacy timestamp ties and unreconciled stock are blocked for review. Quantity corrections after consumption and supplier returns are implemented in migrations 049 and 042. Production migration and authenticated live operation are not established by local verification.

### Opening stock and stock-addition values (migration 041)

**Correct quantity / cost** is available on opening stock and inbound additions, including after consumption. It uses the same audited replay and invoice-review protections as purchase cost corrections while retaining quantities and dates. It never creates or changes a cash expense. Both source types support reviewed zero-value corrections. The common replay engine is private; administrator-only entry points enforce the selected stock type. The same history-size, ambiguous-legacy-order and reconciliation limits apply. Quantity changes after consumption and supplier returns are available through the later workflows described below.

### Supplier returns and received refunds (migration 042)

**Inventory → Supplier returns & refunds** records stock physically returned to a supplier at the current weighted average cost. It does not change the original expense or assume money was received. Record each actual refund separately, with its received date and optional reference/notes; partial refunds are supported. The running refund-minus-stock-value comparison is not a second cash profit entry or a declaration of final settlement. Explicit stock cost recalculation updates the return's stock value while actual refund records stay unchanged.

Cash reports show supplier refunds separately from customer payments and gross expenses paid, including monthly values. Net cash adds received supplier refunds once. They remain unassigned business credits in horse/stay reconciliation. Refund reversals restate their original cash periods. Correcting a mistaken return restores stock at its recorded cost, retains history, and requires active refund entries to be corrected first. These are record corrections, not money transfers or supplier requests. Use them for mistaken entries only.

History pages show 25 returns, with direct return-record links and 20-row refund pagination; aggregate refund totals include all entries. Expected-refund balances are implemented below; exchange matching is implemented below. Supplier credits and return/refund documents are implemented in later increments below. Production migration and authenticated live flows remain unverified.

### Horse feeding schedules (migration 043)

Configure **Horse → Feed schedule → Feeding time → Rations**. Add a feeding time, enter all its ration rows, and save the complete time slot once. Open **Edit feeding time** to change product/unit/quantity, pause a ration, add notes, or remove draft rows. Saved summaries have one edit action per time slot rather than controls on every ration. Whole slots can move to an empty feeding time or be removed with confirmation. Existing unassigned daily totals can be assigned together to an empty named time; occupied schedules are never silently overwritten or merged.

Saves are atomic, administrator-only and protected against stale edits/repeated requests, with retained before/after rows. Inline save errors leave the draft open. Editing a schedule does not deduct inventory or rewrite past consumption; actual confirmation uses the latest active schedule, and schedule writes serialize with confirmation. Up to 100 distinct products can be configured per slot. Archived times/products can retain existing paused rows, but cannot be reactivated through a plan edit. Production migration and authenticated live saves remain unverified.

### Undo feeding confirmations (migration 044)

Apply `20261023004400_undo_feeding.sql` before using feeding confirmation undo. The feeding screen hides Confirm for active confirmations and offers a correction editor with a reason and confirmation dialog. Undo reverses the complete recorded batch atomically using existing invoice protections, retains its cancellation history and allows a new confirmation for that slot. Repeating an old undo cannot cancel a newer confirmation. No live migration or production save has been verified.

### Home quick actions (migration 045)

Admin Home now opens daily feeding/training actions; the previous dashboard remains at `/admin/overview`. Apply `20261023004500_quick_training.sql` for private atomic training batches and durable retry protection. Select only horses actually worked. Shared details create separate session records without automatically changing billing days. A current training stay must cover the entered session date. Feeding actions reuse existing stock deductions and confirmation/undo protections. Remote migration and live saves remain unverified.

### Weekly riding plans (migration 046)

Apply `20261023004600_weekly_riding_schedules.sql` for administrator-only recurring horse riding plans. Open a horse’s Riding schedule tab to choose training/off for all seven days and optionally add notes. Home’s Riding week shows current training horses; training cards show today’s planned status. Plans do not create training logs, confirmations or billable days. Saving/clearing checks the version loaded by the editor to prevent stale overwrites. Remote migration and authenticated production changes remain unverified.

### Daily feeding history (migration 047)

Apply `20261023004700_daily_feeding_history.sql` before using the redesigned Feeding → History tab. It pages through seven complete recorded days, each grouped by feeding time and confirmed horse. Undone records remain in collapsed Corrections and are excluded from active counts. Recorded/undo times use Central Time. Extras and manual stock corrections remain in stock movement history. Remote migration and production verification remain unverified.

### Supplier return documents (migration 048)

Apply `20261023004800_supplier_return_documents.sql` to create the private `supplier-return-documents` bucket, metadata, correction history and administrator-only operations. Open Inventory → Returns & refunds → Documents on a return. Supported JPEG/PNG/WebP/PDF files are limited to 3 MB; content hashes prevent duplicate attachments on the same return. Documents can be archived/restored with reasons, and remain available on cancelled returns. Downloads require admin authentication and use 60-second links. Failed metadata attachment leaves the unregistered object available for a content-verified retry rather than risking deletion during another concurrent attachment. Automatic orphan cleanup, actual uploads/signed links and remote migration remain unverified.

### Stock-source quantity corrections (migration 049)

Apply `20261023004900_source_quantity_corrections.sql` before using Inventory → History → Correct quantity / cost. Purchases, opening stock and inbound additions may be corrected after downstream activity using their original unit/conversion snapshots. Weighted-cost replay retains quantity/cost audit records and flags affected feed invoices without changing issued charges or recorded feeding quantities. Any historical shortage rejects the entire correction; a new backdated addition still follows its actual recording order and cannot silently repair an earlier shortage. Earlier stock records must support the corrected history. Existing total-cost billing/allocation guards and 2,000-entry/ambiguous-history limits remain. Remote migration and production correction/review flows remain unverified.

### Supplier credits (migration 050)

Apply `20261023005000_supplier_credits.sql`. Inventory → Supplier credits records actual credit notes and their available balances. A credit may link to an active return. Supplier names match ignoring case and repeated spaces; aliases are not inferred. On an inventory purchase expense, use Supplier credits to apply an amount actually used. Credits do not mark expenses paid: record the paid/settled date separately, including zero-cash purchases. The full expense and inventory value stay unchanged; cash reports subtract active applications only for settled purchases. Horse/stay gross-cost reports reconcile the non-cash offset separately. Reversal restates the original settlement period and restores credit availability without recording a new payment. Cancel/reissue mistaken notes after reversing their active applications. Issuing/retrying cancelled notes or reversed applications never resurrects them. Choices show up to 100 oldest available matching notes; note/history pages are paginated. Supplier-credit cash-out/conversion remains future work. Remote migration and authenticated production flows remain unverified.

### Expected supplier recovery

Apply `20261023005100_return_expectations.sql`. On an inventory return, Set expectations records optional cash and store-credit targets and due dates. Actual active refunds and issued linked credits reduce their respective outstanding amounts. Blank means unknown; zero means none expected. Targets do not create money or credit transactions. Target changes retain administrator-only, paginated history. Global overdue filtering is implemented below; delivered alerts remain planned. Remote migration and authenticated live flows remain unverified.

### Supplier exchanges

Apply `20261023005200_supplier_exchanges.sql`. Record a replacement inventory purchase separately, then open a return’s Replacement purchases and link it. Supplier names match ignoring case and repeated whitespace; aliases are not inferred. Links can describe multiple purchases/returns without allocating their costs, changing stock, applying credit or recording payment. Use the purchase’s Supplier credits tab for actual credit applications and record its settlement date separately. The purchase’s Exchanges tab links back to each return. Mistaken links require a removal reason and remain in paginated history; remove active links before cancelling a return, voiding its replacement purchase or changing the purchase supplier. Purchase choices show the latest 100 eligible same-supplier inventory purchases. Remote migration and authenticated production workflows remain unverified.

### Supplier follow-up

Apply `20261023005300_supplier_recovery_queue.sql`. Inventory → Returns & refunds → Supplier follow-up shows outstanding and overdue recovery across all active returns, with separate cash and store-credit totals. Filters cover outstanding, overdue, unset targets and all active returns; 25-row pagination does not truncate global totals. A due date is overdue only after that business date in Central Time. Unset targets stay unknown; cancelled returns are excluded, while original records stay available. Active cash refunds and issued credits satisfy their respective targets; credit use does not reopen them. Delivered notifications remain planned. Remote migration and authenticated production workflows remain unverified.
