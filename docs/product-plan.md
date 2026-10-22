# Squared Away Performance Horses

## Direction

Traditional western branding for a Granbury, Texas horse training business. Services: full-time training, colt starting, calf roping training and seasoning, and sale horses. Public calls to action: call/text and training inquiry. Logo, media, and a custom domain are still to be supplied. No data import was needed at kickoff.

Build the admin experience first, for one administrator and up to ten horses in training. Use Next.js, TypeScript, Tailwind CSS, Supabase, GitHub, and Vercel. Customer access and the marketing site follow. No offline editing requirement.

## Implemented

Features in this section are present in the application source. A feature being implemented does not by itself confirm that its database migration or Vercel deployment has completed. Move only the delivered portion of a feature here; leave unfinished portions under Planned.

### App foundation and security

- Next.js App Router, TypeScript, Tailwind CSS, a traditional western design, and responsive admin layouts.
- Email/password sign-in and sign-out, trusted administrator provisioning, server-side authorization on pages and actions, and session refresh.
- Supabase migrations in version control, admin-only row-level security, and environment files excluded from Git.
- Live dashboard counts for active training stays, horses, and customers; upcoming/overdue reminders; useful empty states and quick actions.
- GitHub repository and Vercel/Supabase integrations connected by the owner. Production address: https://squaredawayperformancehorses.vercel.app/.

### Customers and horses

- Customer create/view/edit/delete with contact details and private notes.
- Horse create/view/edit/delete with barn name, registered name, registration number, birth year, sex, breed, training goals, feeding instructions, and private health notes.
- Required customer selection on horse saves, multiple horses per customer, and multiple customers per horse.
- Editable customer relationships after a sale, saved atomically with the horse profile. Existing training stays keep their billing responsibility.
- Customer names on horse cards, linked horses in the customer list, and deletion restrictions for retained history.

### Training stays

- Create/view/edit/delete stays with arrival/departure dates, one billing customer, individual monthly rates, billing day (1–28), private agreement notes, and a recorded partial-month policy.
- Database prevention of overlapping stays for a horse and retention of historical billing assignments.
- Stay terms support reviewed invoice drafts. Automatic scheduling remains planned.

### Reminders

- Create/view/edit/delete reminders and categories; complete or reopen reminders.
- Optional horse links, private notes, due dates, and overdue status.
- Editable default categories for farrier, vaccinations, deworming, dental, medications, and general tasks. Notification delivery remains planned.

### Training log

- Create/view/edit/delete dated training sessions and progress notes linked to a horse.
- Session focus/title, notes, and optional duration in whole minutes. Progress notes have no session duration.
- Quick entry from the dashboard and horse cards, horse-specific history, horse filtering, and paginated history (25 entries per page).
- Entries remain tied to the horse after ownership changes. Horses with training entries cannot be deleted accidentally.
- Entries are private to administrators; customer-visible publishing is not implemented.

### Master admin settings

- Admin-only Settings page for public business phone/email, optional default monthly training, feed, and board charges, billing day (1–28), partial-month policy, and invoice payment terms in days (0 means due upon receipt).
- Saved general payment instructions, HTTPS Venmo/PayPal links, and Apple Cash instructions. Finalized invoices snapshot these details; public-page display remains planned.
- New training stays prefill training and feed/board charges from settings and allow individual overrides. A set feed/board default starts that service as separately billed monthly; included, actual-cost, and other policies remain available. The rate, billing day, partial-month policy, and payment terms are stored on the stay; changing defaults does not change existing agreements.
- Legacy stays retain their recorded values. Previously unrecorded payment terms remain unknown until explicitly entered when editing.
- No business dollar rate or contact detail is hard-coded. Settings validation preserves blank or zero rates, validates payment links, and retains typed form values when saving fails.

### Expenses and private receipts

- Paginated expense book with date, vendor, category, amount, horse/shared-barn assignment, paid date, and customer charge-back flag. Categories can be added, renamed, or removed when unused.
- Standalone expenses can be edited or voided while retaining the record. Purchase expense amounts are protected because they are linked to inventory; purchase payment dates remain editable.
- Private JPEG/PNG/WebP/PDF receipt attachments up to 3 MB, with signature/type checks, authenticated downloads using short-lived signed links, and removal. Attach receipts after saving an expense or stock purchase.
- Stock purchases create their expense and inventory movement together. Opening inventory, feeding, waste, and inventory corrections do not create another cash expense. Eligible charge-backs can be added to invoice drafts with their source expense retained.

### Feed inventory and daily feeding

- Feed, hay, and supplement products, editable metadata, and archival that retains history.
- Fixed milligrams, grams, kilograms, weight ounces, pounds (16 oz per lb), US tons (2,000 lb), and metric tonnes (1,000 kg), plus configurable product-specific units for bags, bales, scoops, flakes, tubs, or other named measures. Separate batch-named conversions handle differing weights; no universal scoop/flake weight is assumed.
- Opening stock, purchases, manual feeding/extras, waste, and reasoned stock additions/reductions. Balances cannot become negative.
- Metric purchase/feeding quantities and custom serving weights are supported. Metric ledger conversion uses the exact 28.349523125 g per weight ounce relationship before rounding. Standard weight conversions are protected. Existing custom units named like the new standards retain their IDs and weights under a legacy label; saved rations and transaction history are preserved. Cups, teaspoons, tablespoons, milliliters, and liters can be added with product-specific measured weights.
- Weighted average inventory value, quantity on hand, and transaction history. Inventory uses weight ounces as its base unit, twelve-decimal base-weight precision, six-decimal entered quantities and inventory values, and valuation in recording order rather than retroactively replaying backdated entries.
- Transactions snapshot their entered quantity/unit, weight conversion, and inventory cost. Later conversion or price changes do not reprice history. Purchases update cash expense records exactly once on retry.
- Saved active/paused rations per horse/product/feeding time, with editable quantities and units. Each horse record has Profile and Feeding plan tabs; ration setup, editing, pausing, and removal live in that horse’s Feeding plan, grouped by feeding time. The daily Feeding page displays plans for confirmations and links to horse records for setup. Ration edits/removals are scoped to the selected horse. Saving a ration never consumes stock.
- Explicit confirmation of one horse’s ration for one date and feeding time, safe to retry per horse/date/time. A shortage in any line rolls back the complete confirmation. Morning confirmation never consumes evening or other scheduled rations. Manual entries handle extras, partial feeding, and corrections.
- Outgoing stock can be reversed once, returning quantity and original cost with a linked correction entry. The original movement remains visible. Reversing a daily line does not make the day available for another full confirmation; record the corrected quantity manually.

### Billing calendar and stay service agreements

- Per-stay monthly calendar with worked, billable-rest, non-billable, and unclassified days. Only worked/rest count as billable; unclassified dates are shown separately.
- Classify a single day or inclusive range, or clear a mistaken classification. Dates must be within the physical stay and cannot be in the future.
- One current classification per stay/date. Training session counts do not automatically classify or duplicate billing days.
- Private change history records previous/new status, notes, actor, and time. Unchanged retries do not duplicate events; clearing retains history.
- Stay date changes cannot strand classified days outside the stay. Stays with billing-day history cannot be reassigned to another horse or accidentally deleted.
- Per-stay feed and boarding choices: unrecorded, included, separate monthly rate, actual cost, or not provided. Rates are required only for separate monthly billing; legacy agreements remain unrecorded until chosen.
- Marked days support reviewed training invoice lines. Feed/boarding lines use the physical-day and recorded-cost rules implemented below.

### Invoices and recorded payments

- Customer/stay invoice drafts with editable dates, notes, and manual charge/credit lines. Payment due dates use recorded stay terms or current defaults for manual invoices; legacy unknown terms require an explicit date.
- Generate a training line for an elapsed period within one calendar month using the stay's calendar-day policy, recorded monthly rate, and explicitly worked/rest dates. Every eligible date must be classified before calculation. Review the saved calculation before finalizing; other policies require manual lines.
- Link eligible horse expenses at cost with an optional explicit handling fee. Source reservations prevent duplicate billing and protect billed expense amounts and training-day classifications; removing a draft line or voiding releases reservations.
- Finalization assigns an invoice number and preserves customer, business contact/payment instructions, line amounts, and calculation snapshots. Later profile/settings changes do not rewrite issued invoices.
- Record multiple/partial payments and derive remaining balances. Payment links do not confirm payments or transfer money. Overpayments are rejected.
- Issued invoices use retained adjustment entries and reasoned payment reversals. Voiding retains history and requires no active payments; a reversal records a correction, not a refund transfer.
- Paginated invoice list, payment/adjustment history, and a printable invoice view with browser print/save-PDF support.

### Cash reporting

- Admin-only Reports screen with a selected inclusive date range, payments received, expenses paid, and net cash profit (received minus paid).
- Monthly cash results, including empty months, and paid expense totals by category. Database aggregation covers all matching records without API row-limit truncation.
- Received amounts use active payment dates on issued invoices; expenses use paid dates. Drafts, unpaid costs, voided expenses, and reversed payments are excluded. Corrections restate affected past periods rather than creating refund cash flows.
- Feed purchase expenses count once; inventory consumption is not deducted again. All recorded shared barn expenses count in business totals without claiming complete horse-level profit.
- Current outstanding and overdue invoice balances across all dates, clearly separate from the selected cash period. These are available in Reports and the overview dashboard.

### Shared barn costs and horse cash margins

- Paginated Shared costs screen for non-voided shared expenses, with a reviewed inclusive boarding period of up to 366 elapsed days.
- Default boarding-day counts come from overlapping physical training stays, including arrival/departure. Actual days can be reviewed and overridden per horse with a required reason; include the owner's horse profiles and boarding outside training stays without creating a training agreement or invoice. Zero excludes a horse.
- Live preview divides the original expense by boarding days. Database calculation uses largest remainder with stable ties to distribute every cent exactly once. Allocations do not create another expense or customer charge.
- Saved splits snapshot horse names, approved days, training-stay day counts, and allocated cents. Later stay changes do not reprice saved splits. Revising or clearing retains history and reasons; retries do not duplicate revisions. The screen shows the latest ten revisions.
- Active allocations protect source amount, horse assignment, expense date, and void status until cleared. Payment dates remain editable and determine when the cost appears in cash reports. The original expense is counted once in business totals.
- Reports show per-horse receipts on stay-linked invoices, direct paid costs, allocated shared paid costs, and recorded cash margins. This includes the owner's horses, even without training stays or income.
- Unassigned receipts without horse reporting links and unallocated paid shared expenses remain explicit. Horse margins plus unassigned receipts minus unallocated costs reconcile to business net cash profit; incomplete assignments are not labeled complete horse profitability.
- Stay-linked invoices prevent subsequent reassignment of the stay to another horse, preserving income attribution. Reports and allocation records remain administrator-only.

### Stay reporting and manual invoice assignments

- Plain-language Match income & expenses guide explains when the page is needed, defines a training visit, and shows a farrier-bill example. Empty expense lists show next steps instead of an empty table; matching labels distinguish a horse expense from its optional visit detail.

- Admin-only Match income & expenses screen, with paginated manual invoices and direct/shared horse cost sources. Forms load all horse/stay options without list-limit truncation.
- Assign a manual invoice's receipts to one horse and optionally one stay matching that horse and the invoice's recorded billing customer. The assignment applies to all active receipts, including later partial payments; customer ownership changes do not silently choose a horse. Invoices linked to stays already use their original stay.
- Reporting assignments leave invoice numbers, original bill details, amounts, payment records, and business totals unchanged. Reasons and prior revisions are retained; clearing restores unassigned reporting. Multi-horse receipt splitting on one invoice remains planned.
- Divide a direct horse cost or a saved shared-cost horse portion among that horse's stays in exact cents. Partial assignments leave an explicit remainder; over-assignment, duplicate stays, and cross-horse assignments are rejected atomically. Unpaid costs remain outside cash reports.
- Replacing/clearing a shared horse allocation automatically stops its old stay splits contributing to reports. Saved history remains reviewable from the shared-cost revision; new horse portions need their own reviewed stay splits.
- Active direct-cost splits protect the source expense amount, horse assignment, expense date, and void status until cleared. Stays referenced by reporting history cannot be reassigned to another horse; active manual invoice stay links protect the matched billing customer.
- Reports include training-stay receipts, direct/shared costs paid, and recorded cash margins, with unassigned receipts, direct-cost remainders, shared-cost remainders, and barn costs shown separately. Stay and horse reconciliations agree with the same business total.
- Business, horse, and stay summaries are returned together from a consistent database snapshot. Labels identify recorded cash margins rather than claiming complete profitability when records or assignments are incomplete.

### Expense filters and financial overview

- Literal, case-insensitive search across expense vendors/private notes, with inclusive expense-date, direct horse/shared-barn, category, and paid/unpaid/voided filters. Shared allocations remain under the original shared expense assignment.
- Filtered totals and stable 25-record pagination are calculated together in the database; page links retain filters. Search text is treated literally, including punctuation and percent characters.
- Overview dashboard cards for current outstanding/overdue balances and counts, month-to-date receipts, and net cash after expenses paid. Chicago business dates and the same financial rules as Reports apply.
- Recent invoice, payment/reversal, expense, and training records with direct links. This is a latest-record list, not a complete change audit. Missing financial migrations show a notice without hiding otherwise available barn records.

### Feed and boarding invoices

- Generate separate monthly feed/boarding lines from the stay's recorded rate, counting every elapsed physical boarding day in the invoice period (including arrival, departure, non-training, and unclassified training dates). The denominator is the actual number of days in that calendar month; round once to cents. Each generated monthly period must fit within one calendar month. Explicit zero rates remain valid.
- Actual-cost feed lines use unbilled, unreversed feeding movements for the horse during the stay/invoice period. Saved weighted consumption costs are summed before rounding once; purchases, waste, stock adjustments, and reversed feeding are excluded. New actual feeding can be billed later without reclaiming previously billed movements.
- Actual-cost boarding uses an explicitly selected, current direct/shared cost portion already assigned to the stay. Sources show expense dates and amounts but are not automatically restricted by expense date; the administrator reviews whether the selected portion belongs to boarding for this billing period. No extra expense is created.
- Included/not-provided services do not generate separate service charges; unrecorded agreements need resolution before generation. Invoice lines snapshot rates, calculations, dates, feed source quantities/conversions/costs, and selected boarding sources.
- Source reservations prevent repeated service days, duplicate feeding records, duplicate stay-cost portions, and both full-expense reimbursement and boarding reimbursement for the same expense. Monthly and actual-cost claims cannot overlap for the same service period. Manual lines still require administrator review and do not receive automatic source-duplicate checks.
- Billed feeding reversals and boarding cost-split/shared-allocation revisions are blocked while reserved. Remove a draft line or void the unpaid invoice to release sources; void retains the original bill and snapshots. Stay dates cannot strand reserved service sources outside the physical stay.
- Service calculation details appear on the invoice, including expandable actual-feed source documentation. Historical snapshots retain costs when product prices, unit conversions, agreements, or rates later change.

### Customer portal and published updates

- Shared sign-in routes administrators to the barn office and linked customers to `/portal`. Portal pages refresh sessions and send private/no-store responses; there is no public registration or private-data service-worker caching.
- Admin Portal access screen explicitly links an existing Supabase Authentication email to one customer record, enables/disables the account, and replaces its login when deliberately requested. This stage uses owner-provisioned sign-in accounts; it does not send invitation emails or require a service-role key.
- Manual per-customer/per-horse grants, revocation, and an optional publication-date starting bound. A blank bound allows all published history; new grants default to today. Ownership edits neither grant nor revoke portal access; review access manually after sales.
- Customer overview, granted horse profiles, paginated published updates, own finalized/voided invoices, balances, adjustments, and payment history. Co-owners share permitted updates while billing remains limited to the customer actually billed. Horse revocation leaves that customer's own billing available; disabling the account blocks both.
- Customer invoice details include preserved bill/payment instructions and printable copies, but omit internal payment notes, references, source-cost snapshots, void reasons, drafts, and other customers' billing. Payment links never record a payment.
- Separate customer-update authoring: save drafts, explicitly publish, unpublish to revise, or archive while retaining records. Private training logs/horse health notes/reminders are never copied automatically. Publication changes and access changes retain administrator history.
- Customer reads use database-enforced, session-bound functions with whitelisted fields. Administrator tables and financial/stock mutation functions remain inaccessible to customers. Revocation or login replacement takes effect on subsequent reads without relying on browser navigation restrictions.

### PWA installation

- Web app manifest with standalone display, `/login` start URL, application identity/colors, 192/512-pixel PNG icons, a maskable icon, and an Apple home-screen icon. Icons use the existing provisional brand mark and can be replaced with the final logo later.
- Installation help on sign-in and in both portals, with an install button when supported and browser-specific home-screen instructions otherwise. Installed standalone sessions hide the prompt.
- A connection is required. No service worker or offline private-response cache is registered; signed-out admin/customer routes redirect to sign-in with private/no-store headers.

### Private horse photos and shared documents

- Admin Horse files screen for private JPEG/PNG/WebP photos and image/PDF documents up to 3 MB. Uploads verify file signatures/types, store private objects, and attach horse/file metadata. No video upload is included yet.
- File review, authenticated preview/download, explicit publish/unpublish, private title revisions, and archive with retained owner copy and administrator history. Published titles must be unpublished before changing. Files are never shared automatically from receipts or private training notes.
- Customer Photos & docs page shows only published, unarchived files allowed by the customer's manual horse grant and publication-date bound. Co-owners with permitted access share those horse files; customer-specific financial documents stay in billing records.
- Database-scoped metadata functions and Storage object policies both enforce access. Customers cannot upload, rename, publish, or delete files. Direct administrator metadata tables stay closed to customer reads.
- App preview/download routes issue 60-second signed links with private/no-store responses. Unpublishing, grant revocation, and account disable prevent fresh portal requests; previously issued links/copies are not withdrawn. Admin archival retains the object and audit metadata.
- File lists are paginated, horse-filterable, and use authenticated image routes without the public image-optimization cache. Photos display in responsive grids; documents open/download through the same access checks.

### Compact forms, mobile navigation, and fast barn entry

- Shared inputs show dollar prefixes, selected quantity units, and minutes. Browser number spinners are hidden. Scoops/flakes and other small serving-count units have explicit touch-friendly plus/minus controls; fixed weights, money, dates, and general numeric fields keep direct entry. Changing the selected quantity unit clears its prior entered quantity.
- Form widths, grid alignment, save-button alignment, and dialog padding are tightened. Financial splitting inputs also show dollar prefixes. US phone entry and customer/invoice/contact displays use `(123) 456-7890`, with international numbers and extensions preserved.
- Mobile admin bottom tabs provide Home, Horses, Feed, Log, and More. More includes inventory-purchase/training quick actions, all office pages, and sign out. Mobile editors fill the screen, respect safe areas, use 16-pixel entry text, and provide larger touch targets. Desktop navigation remains available.
- Training logging has explicit focus shortcuts for cow work, calf roping, colt starting, and conditioning, plus direct entry for custom focus and notes. Scheduled feeding and bulk feeding retain their existing stock/cost checks.
- Camera/file receipt capture is available on stock purchases and existing expenses, with client photo preparation and private attachment after purchase. A failed attachment returns the administrator to the saved expense; content hashes prevent duplicate receipt attachments to the same expense. See `docs/receipt-scanning.md` for the remaining recognition workflow and limits.

### Customer invoice format and service charge defaults

- Settings include optional monthly feed and board customer-charge defaults in exact cents, including zero and unset values. New stays use them; saved agreements keep their original terms. These are billing rates, not expense records or profit assumptions.
- Each customer chooses itemized services or one combined training/feed/board amount. Vet, farrier, hauling, and other charges remain separate. Manual lines explicitly choose their charge category; generated training/feed/board lines classify themselves from their source, never by guessing description text.
- Customer invoice preview, printed admin invoice, and portal invoice share the selected presentation. Full internal source details and draft-line removal stay available under Review detailed charges. Combining lines does not modify financial amounts, source reservations, payment allocation, or profit records.
- Finalization snapshots the customer’s format. Drafts follow the current preference; later preference changes do not alter issued invoices. Existing issued invoices with no saved format remain itemized. Portal responses for combined invoices contain grouped service amounts while preserving customer billing isolation. Requires migration `20261021001900_service_defaults_invoice_format.sql`.

### Feeding times and grouped rations

- Morning and Evening defaults plus administrator-managed custom feeding times, optional clock times, display order, renaming, and archiving. Active rations must be moved or paused before their feeding time can be archived.
- Each horse may receive the same product at different feeding times with separate quantities. Add/Edit remains in a deliberate dialog; duplicate horse/product/time additions ask the administrator to edit the existing line instead of silently replacing it.
- Individual and bulk confirmations use horse/date/feeding-time identity, retain feeding-time label snapshots, and keep per-horse weighted stock costs. Manual single-horse and bulk extras can record a feeding time or remain explicitly unscheduled.
- Existing daily totals remain unassigned without guessed splits. Assign every active total for a horse before confirming scheduled rations. Historical full-day confirmations prevent timed deductions on the same horse/date; past quantity, cost, and confirmation records are preserved. Requires migration `20261021001800_feeding_times.sql`.

### Deliberate editing and batch feeding

- Focused record creation and editing use dialogs where helpful. Settings is an open form with Contact, Training & billing, and Payment methods tabs and one save action. Routine bulk feeding, inventory purchases, feeding-time configuration, reminder categories, invoice payments, and charge review are open within their own sections. Other focused editors remain deliberate dialogs.
- Dialogs have labeled headings, native keyboard focus containment, Escape/close controls, return focus to the opener, and reset unsaved fields on dismissal. Existing Add/Edit links and form anchors open the appropriate dialog; successful navigation closes always-available editors so result messages are visible.
- Bulk scheduled feeding confirms the saved rations for selected horses at one feeding time on one actual date. Existing confirmations remain safe to retry; a shortage or invalid horse rolls back the entire batch.
- Bulk extra/partial feeding records one selected product/unit across multiple horses with individual quantities. Blank quantities skip a horse. Each batch preserves weighted cost and per-horse history, saves atomically, and rejects changed retries using a saved batch request. Requires migration `20261021001700_bulk_feeding.sql`.

### Training worklist

- Training log opens to current training horses with Log session, Add note, History, and Feeding plan actions. Entry forms are tied to the chosen horse without a horse dropdown. History uses horse buttons and a separate tab, retaining former-horse history.
- Cards show arrival date, last recorded training session and focus, and last recorded unreversed feeding including its saved feeding-time label. Progress notes and future sessions do not count as last trained. Horses arriving later or already departed are excluded; arrival/departure dates count inclusively. Missing activity is explicit, and recorded dates are not presented as actual clock times.

### Task navigation and feeding-time setup

- Feeding, Inventory, Reports, Reminders, invoice details, and Settings use accessible tabs to separate tasks. Tabs support keyboard navigation and direct section links; mounted panels preserve unsaved inputs. Invoice printing selects the customer invoice regardless of the active tab.
- Feeding-time setup supports adding and removing any number of draft rows, then saving all new times together atomically (up to 1,000 per save). Saved times have individual Edit actions. Failed saves preserve drafts; retrying a batch cannot duplicate its times. Editing a saved time leaves unfinished new entries intact.

## Planned (not implemented)

### Expenses, receipts, billing, and profitability

- Recurring expense scheduling and purchase-cost/inbound-stock correction workflows beyond the current protected purchase records.
- Configurable billing schedules beyond the current 1–28 range, scheduled invoice generation, and additional automatic calculations for policies beyond calendar-day proration. Add an administrator-controlled readiness review for actual-cost feed/boarding periods and block automatic finalization until the required period is marked ready.
- Public-page contact/payment details from business settings, invoice delivery/email, refunds, and customer credits on account.

#### Feed, boarding, and profitability details

- Split receipts from a single manual invoice among multiple horses/stays if needed. Current reporting links assign the entire invoice to one horse and optionally one matching stay.
- Add reimbursement-versus-absorbed-cost breakdowns using the implemented expense-to-invoice links. Cash reports already count received invoice payments once; do not add reimbursements a second time as separate revenue.
- Add separate inventory consumption cost summaries in reports, beyond the existing inventory ledger. Keep these separate from cash reports so feed purchases and consumption are never deducted together.
- Add persistent boarding occupancy records for horses outside training stays if useful; their actual boarding days can currently be entered in each shared-cost allocation.

### Horse records and customer portal

- Video uploads and an ownership transfer history beyond the existing editable owner links and manual portal grants.
- Add structured customer-shared care records, in-app email invitations, and password setup/recovery beyond owner-provisioned Supabase accounts. Photo/document sharing and published updates are implemented above.

### Marketing website

- Public Home, About, Training, Sale Horses, and Contact/Inquiry pages.
- Call/text and inquiry actions, business contact details, domain, logo, and real photography/video.

### PWA and later improvements

- Receipt recognition/OCR with provider selection, product/unit suggestions, reviewed draft entry, confidence/error handling, and duplicate-purchase checks. Multi-item receipt purchases need an atomic multi-product purchase/expense model and reviewed tax/discount allocation. Camera/file capture and private receipt attachment are implemented above; automatic recognition is not. See `docs/receipt-scanning.md`.
- Continue device testing and refinement of mobile workflows, including keyboard/camera behavior on real iOS/Android devices. Native-style navigation and editors are implemented above; this does not imply offline entry or a native binary.

- Extend bulk entry to additional workflows such as training logs or expense entry as their batch requirements are defined; bulk daily and extra/partial feeding are implemented above.

- Optional online payment processing, delivered notifications, and accounting export after core workflows are established.

## Implementation conventions

- Store money as integer cents, service/billing dates as dates, and recorded activity times as timezone-aware timestamps. Business dates use America/Chicago.
- Finalized invoice line items retain the billed customer, description, and amount even if current profiles or rates change. Use adjustments rather than silently overwriting finalized invoices.
- Implemented financial/stock entities include expenses, expense_receipts, inventory_products, inventory_units, inventory_balances, inventory_movements, feed_rations, and feeding_confirmations. Billing entities include invoices, invoice_lines, invoice_expense_claims, invoice_day_claims, invoice_payments, and invoice_adjustments. Service source reservations use invoice_service_days, invoice_feed_claims, and invoice_boarding_claims. Shared-cost revisions use expense_allocations and expense_allocation_lines. Reporting assignments use invoice_reporting_links, cost_stay_splits, and cost_stay_split_lines. Sessions and progress notes share `training_entries`.
- Enforce access in the database as well as the UI. Never commit credentials or expose server-only keys to the browser.
- Keep preview/development databases separate from production. Apply migrations through a reviewed deployment workflow.
- On every completed feature, move its delivered scope from Planned to Implemented in the same change. Split partially completed items so only unfinished work remains under Planned; do not leave completed features duplicated there. Update the next build sequence and record verification/deployment limitations below.

## Agreed decisions (implementation remains planned unless listed above)

- Customer invoice presentation may combine training, feed, and board; vet, farrier, hauling, and other charges stay separate. The full internal breakdown is retained. Confirmed October 21, 2026; implemented above.

- Repository: https://github.com/psides83/squared-away-ph-site. The owner confirmed that the source code is public. Repository visibility is separate from deployed app access; no visibility change has been requested.
- Billing schedules vary by training stay: first of month, arrival anniversary, or another agreed date.
- Partial months use actual calendar days as the proration denominator, with a manual override. Billable days are days actually worked plus rest days in between; merely being present on arrival or departure is not automatically billable. Physical boarding dates and billable training dates must be tracked separately.
- Mark each horse's training calendar explicitly as worked, billable rest, or non-billable, including illness and extended breaks. Do not automatically classify unmarked dates as billable.
- Vet, farrier, and hauling reimbursements default to actual cost; allow an explicitly entered markup or handling fee.
- Invoice payment terms are configurable, with due upon receipt as the starting default. Permit multiple/partial payments and show the remaining balance.
- No training deposit.
- Recurring billing: dates on the 29th–31st use the last day of shorter months and return to the original anchor in longer months. Automatically finalize invoices only when required billing records are complete; otherwise leave them for review. Confirmed October 21, 2026.
- Automatic actual-cost billing requires the administrator to explicitly mark feed/boarding records ready for the billing period before automatic finalization. A period reaching its billing date alone does not establish completeness. Confirmed October 21, 2026; readiness workflow and enforcement remain planned.
- Customer portal: explicitly granted customers share published horse updates, but each customer sees only invoices and payments billed to their own customer record. Horse portal access is granted/revoked manually by the administrator; ownership edits do not automatically grant access. Confirmed October 21, 2026.
- Feed and boarding inclusion/separate billing is determined for each horse/training agreement. Separately billed monthly feed and boarding use all physical boarding days, with actual calendar days as the monthly denominator. Actual-cost feed uses recorded weighted consumption costs; actual-cost boarding uses reviewed costs assigned to the stay. The owner confirmed these calculation bases on October 21, 2026.
- Feed inventory includes hay and all supplement types from the start, alongside purchases, receipts, and consumption tracking.
- Support all discussed purchase/feeding units with product-specific relationships between pounds/weight ounces and scoops, flakes, bags, bales, tubs, and other measures. Conversion values are configurable rather than universal assumptions, and historical transactions retain their conversion snapshots.
- Feeding workflow: saved daily rations per horse, quick confirmation of actual feeding, and manual entries for extras or changes. Only confirmed consumption affects inventory; ration changes apply prospectively.
- Inventory valuation uses weighted average cost per product in its base stock unit. New receipts update the average from the existing stock value plus the received stock cost, divided by total stock quantity. Confirmed consumption retains the applicable unit-cost snapshot; later purchases do not reprice previous feedings. Cash reporting continues to track actual purchases paid and does not deduct consumption cost again.
- Include the owner's own horses when allocating shared barn costs. Default shared-cost allocation is by boarding days during the expense period, with the allocation basis visible and no double counting.
- Initial profit reporting uses cash received minus expenses paid. Inventory consumption and valuation are separate operational cost views.
- Default rates, payment terms, business phone/email, and payment instructions belong in master admin settings, with applicable horse/stay overrides and historical snapshots. Do not hard-code a business rate or contact value.

## Decisions still needed

- Public About page and landing-page information are deferred at the owner's request on October 21, 2026. Trainer biography, final logo, and real media will be supplied later.
- Public visual direction is an illustrated western design until real photographs and a final logo are available, confirmed October 21, 2026.

- Product names, actual package/serving conversion values, and opening quantities will be entered during inventory setup. Supported units and configurable conversions are agreed; actual scoop/flake weights must come from the relevant product or measured batch.
- Actual starting rates, contact details, and payment instructions can now be entered by the owner in Settings. These are business setup values, not unresolved development decisions.

## Next build sequence

Recurring billing and remaining admin expense/reporting improvements → customer onboarding refinements and structured care sharing. Public marketing content is deferred until the owner returns to it. Expand expense/inventory corrections and reporting as needed alongside billing.

## Verification and deployment status

- Training-worklist increment (October 22, 2026): adds migration `20261022002100_training_worklist.sql` for the administrator-only, per-horse latest-activity query. All 115 tests pass (the original 114 plus the new worklist test), along with TypeScript checks and the production build. Local tests cover current/future/departed stays, inclusive departure dates, missing activity, note/future-session exclusion, reversed-feed exclusion, and non-admin denial. Browser previews verify the actual horse-card component, action links, missing-history labels, and phone-width layout. Remote migration and authenticated production flows remain unverified.

- Horse-record feeding-plan increment (October 22, 2026): ration configuration moved to horse records with scoped updates/removals and links from the horse book and daily feeding. No database migration required. All 114 tests, TypeScript checks, and the production build pass. A local browser preview verifies grouped horse rations, links to the horse record, and the horse-bound ration editor. Authenticated production saves and deployment remain unverified.

- Tabs/feeding-time setup increment (October 22, 2026): all 114 tests and TypeScript checks pass. Local database tests cover six-time setup, atomic conflict rollback, case-insensitive duplicate names, invalid clock times, safe retries, individual edits, and non-admin denial. Browser preview checks confirm four draft rows, tab-switch preservation, individual edit expansion, and phone-width rendering. The production build also passes. Migration `20261022002000_batch_feeding_times.sql` must be applied; remote migration and authenticated production flows remain unverified.

- Mobile/forms/receipt-capture increment (October 22, 2026): all 113 tests, TypeScript checks, and the production build pass. Browser checks at a 390-pixel phone viewport cover compact fields, dollar/unit display, serving-button increments, phone formatting, training-focus selection, full-screen editors, and More navigation. Receipt tests cover pre-save file validation, repeat attachment deduplication, upload failure, and metadata cleanup using a mocked storage client. The temporary preview was removed. Actual iOS/Android camera capture, image-preparation compatibility, keyboard behavior, and live Supabase attachment flows remain unverified. No new database migration or external recognition service was added.

- Service-defaults/invoice-format increment includes migration `20261021001900_service_defaults_invoice_format.sql`. All 109 tests, TypeScript checks, and the production build pass. Local tests cover blank/zero/exact-cent defaults, retained stay agreements, generated/manual charge categories, combined-service sums and separate other charges, draft preference changes, issued/legacy invoice format preservation, portal isolation/private-helper denial, payments, and adjustments. Browser checks used the actual Settings and invoice-line components with sample values; the temporary preview was removed. Remote migration and authenticated production flows remain unverified.

- Feeding-time increment includes migration `20261021001800_feeding_times.sql`. All 102 tests, TypeScript checks, and the production build pass. Local database tests cover separate same-product rations by time, individual/bulk time-specific deductions and costs, shortages/rollback, retry safety, paused/archived times, label snapshots, migration preservation, old daily-total safeguards, and non-admin denial. Local browser checks used the actual grouped-rations/bulk components with sample horses and confirmed custom-time filtering; the temporary preview was removed. Live authenticated flows and remote migration completion remain unverified.

- Horse files include migration `20261021001500_horse_files.sql`. All 89 tests, TypeScript checks, and the production build pass. Local database/storage-policy tests cover private-by-default uploads, explicit publication, co-owner grants, safe metadata projections, publication-date bounds, account/grant revocation, unpublishing/title revision/archive history, and denied customer/anonymous writes. Storage tables are simulated: actual Supabase uploads/downloads, signed URL behavior, and authenticated browser flows remain unverified.

- PWA installation: TypeScript and production build pass. Local production HTTP checks verify the manifest, icon dimensions/responses, sign-in manifest link/install help, and private/no-store signed-out redirects for both portals. Icons were visually checked. Actual device installation, browser install-prompt eligibility, and authenticated live flows remain unverified. No service worker was added.

- Customer portal includes migration `20261021001400_customer_portal.sql`. All 83 tests, TypeScript checks, and the production build pass. Local database tests cover explicit grants, separate co-owner billing, safe projections, draft/private-data exclusion, publication lifecycle, date bounds, ownership independence, revocation, login replacement/disable, retained history, and denied customer/anonymous access to admin operations. Authenticated production sign-in/customer flows and migration completion remain unverified.

- Service billing includes migration `20261021001300_service_billing.sql`. All 75 tests, TypeScript checks, and the production build pass. Local database tests cover physical boarding days without training classifications, leap-year denominators, zero rates, weighted consumption and rounding, exclusions/reversals, source protection, duplicate/cross-method safeguards, cost snapshots, release on removal/void, and non-admin denial. Authenticated live flows and migration completion remain unverified.

- Overview/expense-filter increment includes migration `20261021001200_overview_expense_filters.sql`. All 66 tests, TypeScript checks, and the production build pass. Local tests cover literal search, combined filters, exact pagination, Chicago month dates, financial exclusions, recent record links, and non-admin denial. Authenticated live flows and migration completion remain unverified.

- Stay-reporting increment includes migration `20261021001100_stay_reporting.sql`. All 63 tests, TypeScript checks, and the production build pass. Local database tests cover manual receipt assignments, historical billing-customer validation, bill preservation, partial direct/shared cost splits, residuals, over-assignment/cross-horse rejection, repeated requests, revisions/clears, retired source handling, full cash reconciliation, and denied non-admin access. Authenticated browser flows, retired-history UI, and production migration completion have not been verified; no production records were created for testing.

- Shared-cost/horse-margin increment includes migration `20261021001000_shared_cost_allocations.sql`. All 55 tests, TypeScript checks, and the production build pass. Local database tests cover inclusive boarding defaults, owner horses without training stays, cent reconciliation, snapshots, repeat safety, replacement/clearing history, protected source amounts, income attribution, business-total reconciliation, and non-admin denial. Authenticated browser flows and live migration completion have not been verified.

- Cash reporting includes migration `20261021000900_cash_reporting.sql`. All 48 tests, TypeScript checks, and the production build pass. Local database tests verify inclusive paid-date filtering, reversed payments, unpaid/void exclusions, empty months, current outstanding balances, totals across more than 1,000 expenses, date bounds, and non-admin denial. Live reporting and production migration completion have not been verified.

- Invoice increment includes migration `20261021000800_invoices_payments.sql`. All 47 tests, TypeScript checks, and the production build pass. Local database tests cover source reservations, calculation completeness, snapshots, partial payments, repeat safety, overpayment/over-credit guards, adjustments, reversals, voids, and denied non-admin access. Live migration completion, authenticated invoice/browser printing flows, and external payment links have not been verified; no production billing records were created.

- Billing groundwork includes migration `20261021000700_billing_days_agreements.sql`. All 38 tests, TypeScript checks, and the production build pass, covering explicit day counts, repeat safety, audit history, clearing classifications, date/horse guards, service-rate constraints, and administrator access. Authenticated live calendar flows and production migration completion have not been confirmed.

- Foundation and horse/customer updates were pushed to `main`; the production sign-in page and signed-out redirects were checked. Full authenticated production CRUD has not been exercised by the agent.
- Training log implementation includes migration `20261021000300_training_log.sql`. Apply it before using the new feature; production migration completion has not been confirmed.
- Training log increment: all 15 tests, TypeScript checks, and the production build pass. Database tests run the actual migrations locally and verify admin permissions, CRUD, duration constraints, retained history, and ownership/billing safeguards. The authenticated training-log UI has not been exercised against production. No production records were created for testing.
- Settings increment includes migration `20261021000400_business_settings.sql`; apply it before using Settings or the updated training-stay form. All 19 tests, TypeScript checks, and the production build pass, including administrator access controls and protection of historical stay terms. The authenticated Settings UI has not been exercised against production; live deployment/migration completion has not been confirmed.
- Expenses/inventory increment includes migrations `20261021000500_expenses_inventory.sql` and `20261021000600_private_receipts.sql`. All 30 tests, TypeScript checks, and the production build pass. Local PostgreSQL tests cover actual migrations, weighted costing, insufficient-stock rollback, daily retry safety, historical conversion snapshots, reversals, protected purchase amounts, private receipt policies, and denied non-admin access. Storage tables are simulated in local policy tests; actual uploads/downloads and authenticated browser flows still need verification against Supabase. No production expenses or stock were created for testing.

- Deliberate-editing/batch-feeding verification: all 95 tests, TypeScript checks, and the production build pass. Local browser checks use sample horses in a temporary preview (removed from the final app); production authenticated screens and remote migration remain unverified. SQL tests cover batch rollback, repeat submission, changed retries, per-horse quantities, stock/value depletion, and admin access.
