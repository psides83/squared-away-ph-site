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
- These are agreement records only. Automatic invoices, charges, and proration calculations remain planned.

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

- Admin-only Settings page for public business phone/email, optional default monthly rate, billing day (1–28), partial-month policy, and invoice payment terms in days (0 means due upon receipt).
- Saved general payment instructions, HTTPS Venmo/PayPal links, and Apple Cash instructions. Invoice/public-page display of these details remains planned.
- New training stays prefill from settings and allow individual overrides. The rate, billing day, partial-month policy, and payment terms are stored on the stay; changing defaults does not change existing agreements.
- Legacy stays retain their recorded values. Previously unrecorded payment terms remain unknown until explicitly entered when editing.
- No business dollar rate or contact detail is hard-coded. Settings validation preserves blank or zero rates, validates payment links, and retains typed form values when saving fails.

### Expenses and private receipts

- Paginated expense book with date, vendor, category, amount, horse/shared-barn assignment, paid date, and customer charge-back flag. Categories can be added, renamed, or removed when unused.
- Standalone expenses can be edited or voided while retaining the record. Purchase expense amounts are protected because they are linked to inventory; purchase payment dates remain editable.
- Private JPEG/PNG/WebP/PDF receipt attachments up to 3 MB, with signature/type checks, authenticated downloads using short-lived signed links, and removal. Attach receipts after saving an expense or stock purchase.
- Stock purchases create their expense and inventory movement together. Opening inventory, feeding, waste, and inventory corrections do not create another cash expense. Charge-back flags do not yet generate invoices or record reimbursement.

### Feed inventory and daily feeding

- Feed, hay, and supplement products, editable metadata, and archival that retains history.
- Fixed weight ounces and pounds (16 oz per lb), plus configurable product-specific units for bags, bales, scoops, flakes, tubs, or other named measures. Separate batch-named conversions handle differing weights; no universal scoop/flake weight is assumed.
- Opening stock, purchases, manual feeding/extras, waste, and reasoned stock additions/reductions. Balances cannot become negative.
- Weighted average inventory value, quantity on hand, and transaction history. Inventory uses weight ounces as its base unit, six-decimal quantity/value precision, and valuation in recording order rather than retroactively replaying backdated entries.
- Transactions snapshot their entered quantity/unit, weight conversion, and inventory cost. Later conversion or price changes do not reprice history. Purchases update cash expense records exactly once on retry.
- Saved active/paused daily rations per horse/product, with editable quantities and units. Saving a ration never consumes stock.
- Explicit confirmation of the entire daily ration for a horse/date, once per date. A shortage in any line rolls back the complete confirmation. Manual entries handle extras, partial feeding, and corrections.
- Outgoing stock can be reversed once, returning quantity and original cost with a linked correction entry. The original movement remains visible. Reversing a daily line does not make the day available for another full confirmation; record the corrected quantity manually.

## Planned (not implemented)

### Expenses, receipts, billing, and profitability

- Expense search and date/horse filters, recurring expense scheduling, and purchase-cost/inbound-stock correction workflows beyond the current protected purchase records.
- Invoices, line items, recorded payments, partial payments, adjustments, and derived outstanding balances.
- Optional Venmo, Apple Cash, and PayPal payment instructions/links where supported. Visiting a link must not count as payment confirmation.
- Configurable billing schedules beyond the current 1–28 range, automated training charges, and explicit partial-month calculations.
- Per-horse daily billing calendar with explicit worked, billable-rest, and non-billable statuses. Unmarked dates remain unclassified; they must not silently become billable, and multiple sessions on one date must not create duplicate billable days.
- Populate future invoices/public pages from business settings, with contact/payment-instruction snapshots on finalized invoices so later settings changes do not rewrite history.
- Per-horse/per-stay feed and boarding agreements: included in training or separately billed, with individual rates and overrides.
- Dashboard outstanding balances and recent activity beyond the current horse/reminder overview.

#### Feed, boarding, and profitability details

- Extend current horse/shared-barn expense assignments with training-stay attribution and allocations of shared costs across horses. Each allocation must reconcile to the original expense so business totals never count it twice, including the owner's horses.
- Distinguish costs absorbed by the business from costs charged back to customers. Link reimbursable expenses to their eventual invoice items; do not count a reimbursement twice as both separate revenue and the same invoice revenue.
- Report revenue, total costs, and net profit (revenue minus costs) for a selected period. Show horse/stay margins with clear treatment of shared costs, plus overall business profitability. Do not label horse-level profit as complete when shared costs have not been allocated.
- Begin with clearly labeled cash reporting: payments received minus expenses paid, with unpaid invoices separate. Show inventory consumption costs separately from cash spent on feed purchases; do not deduct both in the same profit calculation. Show horse-level cost allocations with their basis stated.
- Keep profitability reporting private to the administrator. Profit reports are not implemented; the current expense, inventory, and feeding screens do not claim to show overall profit.

### Horse records and customer portal

- Horse photos/media, documents, and an ownership transfer history.
- Invite-only customer dashboard with horses, shared training updates, media, care, documents, invoices, and payment history.
- An explicit publishing flow that separates private notes from customer updates, with database-enforced customer access rules.

### Marketing website

- Public Home, About, Training, Sale Horses, and Contact/Inquiry pages.
- Call/text and inquiry actions, business contact details, domain, logo, and real photography/video.

### PWA and later improvements

- Installable PWA with icons and manifest; no private-response service-worker caching by default.
- Optional online payment processing, delivered notifications, and accounting export after core workflows are established.

## Implementation conventions

- Store money as integer cents, service/billing dates as dates, and recorded activity times as timezone-aware timestamps. Business dates use America/Chicago.
- Future invoice line items must retain the billed customer, description, and amount even if current profiles or rates change. Use adjustments rather than silently overwriting finalized invoices.
- Implemented financial/stock entities include expenses, expense_receipts, inventory_products, inventory_units, inventory_balances, inventory_movements, feed_rations, and feeding_confirmations. Proposed billing entities include invoices, invoice_items, payments, and payment_allocations. Sessions and progress notes share `training_entries`.
- Enforce access in the database as well as the UI. Never commit credentials or expose server-only keys to the browser.
- Keep preview/development databases separate from production. Apply migrations through a reviewed deployment workflow.
- On every completed feature, move its delivered scope from Planned to Implemented and record verification/deployment limitations below.

## Agreed decisions (implementation remains planned unless listed above)

- Repository: https://github.com/psides83/squared-away-ph-site. The owner confirmed that the source code is public. Repository visibility is separate from deployed app access; no visibility change has been requested.
- Billing schedules vary by training stay: first of month, arrival anniversary, or another agreed date.
- Partial months use actual calendar days as the proration denominator, with a manual override. Billable days are days actually worked plus rest days in between; merely being present on arrival or departure is not automatically billable. Physical boarding dates and billable training dates must be tracked separately.
- Mark each horse's training calendar explicitly as worked, billable rest, or non-billable, including illness and extended breaks. Do not automatically classify unmarked dates as billable.
- Vet, farrier, and hauling reimbursements default to actual cost; allow an explicitly entered markup or handling fee.
- Invoice payment terms are configurable, with due upon receipt as the starting default. Permit multiple/partial payments and show the remaining balance.
- No training deposit.
- Feed and boarding inclusion/separate billing is determined for each horse/training agreement.
- Feed inventory includes hay and all supplement types from the start, alongside purchases, receipts, and consumption tracking.
- Support all discussed purchase/feeding units with product-specific relationships between pounds/weight ounces and scoops, flakes, bags, bales, tubs, and other measures. Conversion values are configurable rather than universal assumptions, and historical transactions retain their conversion snapshots.
- Feeding workflow: saved daily rations per horse, quick confirmation of actual feeding, and manual entries for extras or changes. Only confirmed consumption affects inventory; ration changes apply prospectively.
- Inventory valuation uses weighted average cost per product in its base stock unit. New receipts update the average from the existing stock value plus the received stock cost, divided by total stock quantity. Confirmed consumption retains the applicable unit-cost snapshot; later purchases do not reprice previous feedings. Cash reporting continues to track actual purchases paid and does not deduct consumption cost again.
- Include the owner's own horses when allocating shared barn costs. Default shared-cost allocation is by boarding days during the expense period, with the allocation basis visible and no double counting.
- Initial profit reporting uses cash received minus expenses paid. Inventory consumption and valuation are separate operational cost views.
- Default rates, payment terms, business phone/email, and payment instructions belong in master admin settings, with applicable horse/stay overrides and historical snapshots. Do not hard-code a business rate or contact value.

## Decisions still needed

- Product names, actual package/serving conversion values, and opening quantities will be entered during inventory setup. Supported units and configurable conversions are agreed; actual scoop/flake weights must come from the relevant product or measured batch.
- Actual starting rates, contact details, and payment instructions can now be entered by the owner in Settings. These are business setup values, not unresolved development decisions.

## Next build sequence

Worked/rest-day billing calendar and per-horse feed/boarding agreements → invoices, charge-backs, and recorded payments (using implemented settings/expenses) → revenue/cost/profit reporting and shared-cost allocations → customer portal → public marketing website → PWA installation and refinements. Expand expense/inventory corrections and reporting as needed alongside billing.

## Verification and deployment status

- Foundation and horse/customer updates were pushed to `main`; the production sign-in page and signed-out redirects were checked. Full authenticated production CRUD has not been exercised by the agent.
- Training log implementation includes migration `20261021000300_training_log.sql`. Apply it before using the new feature; production migration completion has not been confirmed.
- Training log increment: all 15 tests, TypeScript checks, and the production build pass. Database tests run the actual migrations locally and verify admin permissions, CRUD, duration constraints, retained history, and ownership/billing safeguards. The authenticated training-log UI has not been exercised against production. No production records were created for testing.
- Settings increment includes migration `20261021000400_business_settings.sql`; apply it before using Settings or the updated training-stay form. All 19 tests, TypeScript checks, and the production build pass, including administrator access controls and protection of historical stay terms. The authenticated Settings UI has not been exercised against production; live deployment/migration completion has not been confirmed.
- Expenses/inventory increment includes migrations `20261021000500_expenses_inventory.sql` and `20261021000600_private_receipts.sql`. All 30 tests, TypeScript checks, and the production build pass. Local PostgreSQL tests cover actual migrations, weighted costing, insufficient-stock rollback, daily retry safety, historical conversion snapshots, reversals, protected purchase amounts, private receipt policies, and denied non-admin access. Storage tables are simulated in local policy tests; actual uploads/downloads and authenticated browser flows still need verification against Supabase. No production expenses or stock were created for testing.
