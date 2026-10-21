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

## Planned (not implemented)

### Expenses, receipts, billing, and profitability

- User-managed expense categories for feed, hay, supplements, boarding/facility rent, bedding, vet, farrier, hauling, and other costs.
- Private receipt uploads attached to expenses, with customer reimbursement tracked separately from the original expense.
- Invoices, line items, recorded payments, partial payments, adjustments, and derived outstanding balances.
- Optional Venmo, Apple Cash, and PayPal payment instructions/links where supported. Visiting a link must not count as payment confirmation.
- Configurable billing schedules beyond the current 1–28 range, automated training charges, and explicit partial-month calculations.
- Per-horse daily billing calendar with explicit worked, billable-rest, and non-billable statuses. Unmarked dates remain unclassified; they must not silently become billable, and multiple sessions on one date must not create duplicate billable days.
- Populate future invoices/public pages from business settings, with contact/payment-instruction snapshots on finalized invoices so later settings changes do not rewrite history.
- Per-horse/per-stay feed and boarding agreements: included in training or separately billed, with individual rates and overrides.
- Dashboard outstanding balances and recent activity beyond the current horse/reminder overview.

#### Feed, boarding, and profitability details

- Record feed, hay, supplements, boarding/facility rent, bedding, and other operating expenses, including date, vendor, category, amount, notes, and private receipt attachments. Support recurring costs and quantity/unit-cost detail for inventory purchases.
- Include feed inventory in the initial expense/inventory build: all feed products, hay, and supplement types; purchase receipts, stock received, on-hand quantities, horse consumption, waste, and explicit stock adjustments. Define product units and conversions so bags, bales, weight, and measured servings are not treated as interchangeable without a configured conversion.
- Support pounds, weight ounces, bags, bales, flakes, scoops, tubs, and other configurable product units. Pounds/weight ounces have a fixed conversion (1 lb = 16 oz); package and serving conversions are configured per product, such as pounds per bag, ounces per scoop, or pounds per flake. Hay batch/package-size variation can override the applicable conversion. Never assume all scoops or flakes have the same weight, and do not equate fluid ounces with weight ounces.
- Preserve the entered quantity/unit and the conversion used on each stock or feeding transaction. Later conversion edits must not recalculate historical consumption or balances. Allow fractional quantities and require a valid conversion before subtracting inventory in a different unit.
- Save daily rations per horse with quick confirmation of actual feeding, plus manual entries for extras and changes. Creating or editing a ration alone does not consume stock. Confirmed feedings deduct inventory once; corrections must reconcile the stock movement rather than silently double-deducting or rewriting history.
- Assign direct expenses to a horse or training stay. Record shared barn costs once, with optional allocations across horses. Each allocation must reconcile to the original expense so business totals never count it twice.
- Distinguish costs absorbed by the business from costs charged back to customers. Link reimbursable expenses to their eventual invoice items; do not count a reimbursement twice as both separate revenue and the same invoice revenue.
- Report revenue, total costs, and net profit (revenue minus costs) for a selected period. Show horse/stay margins with clear treatment of shared costs, plus overall business profitability. Do not label horse-level profit as complete when shared costs have not been allocated.
- Begin with clearly labeled cash reporting: payments received minus expenses paid, with unpaid invoices separate. Show inventory consumption costs separately from cash spent on feed purchases; do not deduct both in the same profit calculation. Show horse-level cost allocations with their basis stated.
- Keep this reporting private to the administrator. Expense/profitability screens and calculations are roadmap items, not implemented features yet.

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
- Proposed financial entities: expenses, receipt_attachments, invoices, invoice_items, payments, and payment_allocations. Sessions and progress notes currently share the implemented `training_entries` table.
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

Expense tracking, private receipts, and feed/hay/supplement inventory → invoices and recorded payments (using implemented admin settings) → revenue/cost/profit reporting → customer portal → public marketing website → PWA installation and refinements.

## Verification and deployment status

- Foundation and horse/customer updates were pushed to `main`; the production sign-in page and signed-out redirects were checked. Full authenticated production CRUD has not been exercised by the agent.
- Training log implementation includes migration `20261021000300_training_log.sql`. Apply it before using the new feature; production migration completion has not been confirmed.
- Training log increment: all 15 tests, TypeScript checks, and the production build pass. Database tests run the actual migrations locally and verify admin permissions, CRUD, duration constraints, retained history, and ownership/billing safeguards. The authenticated training-log UI has not been exercised against production. No production records were created for testing.
- Settings increment includes migration `20261021000400_business_settings.sql`; apply it before using Settings or the updated training-stay form. All 19 tests, TypeScript checks, and the production build pass, including administrator access controls and protection of historical stay terms. The authenticated Settings UI has not been exercised against production; live deployment/migration completion has not been confirmed.
