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

## Planned (not implemented)

### Expenses, receipts, billing, and profitability

- User-managed expense categories for feed, hay, supplements, boarding/facility rent, bedding, vet, farrier, hauling, and other costs.
- Private receipt uploads attached to expenses, with customer reimbursement tracked separately from the original expense.
- Invoices, line items, recorded payments, partial payments, adjustments, and derived outstanding balances.
- Optional Venmo, Apple Cash, and PayPal payment instructions/links where supported. Visiting a link must not count as payment confirmation.
- Configurable billing schedules beyond the current 1–28 range, automated training charges, and explicit partial-month calculations.
- Dashboard outstanding balances and recent activity beyond the current horse/reminder overview.

#### Feed, boarding, and profitability details

- Record feed, hay, supplements, boarding/facility rent, bedding, and other operating expenses, including date, vendor, category, amount, notes, and private receipt attachments. Support recurring costs and optional quantity/unit-cost detail for feed purchases.
- Assign direct expenses to a horse or training stay. Record shared barn costs once, with optional allocations across horses. Each allocation must reconcile to the original expense so business totals never count it twice.
- Distinguish costs absorbed by the business from costs charged back to customers. Link reimbursable expenses to their eventual invoice items; do not count a reimbursement twice as both separate revenue and the same invoice revenue.
- Report revenue, total costs, and net profit (revenue minus costs) for a selected period. Show horse/stay margins with clear treatment of shared costs, plus overall business profitability. Do not label horse-level profit as complete when shared costs have not been allocated.
- Keep cash received and outstanding invoices separate. Choose and label the reporting basis before implementing profit calculations, so billed revenue and collected payments are not mixed or counted twice. Show gross feed purchases separately from allocated feed cost where those differ.
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

## Decisions still needed

- Repository confirmed: https://github.com/psides83/squared-away-ph-site. Repository visibility remains unverified.
- Whether partial first/last months are prorated and which calculation applies. Partial payments are a confirmed requirement, with implementation still planned.
- Outside-expense markup or at-cost reimbursement policy.
- Default rates, invoice due dates, payment instructions, and business contact details.
- Profit reporting basis (cash received/paid or earned/incurred), whether feed is tracked as purchases or consumption, and the method for allocating shared feed and boarding costs.

## Next build sequence

Expense tracking and private receipts → invoices and recorded payments → revenue/cost/profit reporting → customer portal → public marketing website → PWA installation and refinements.

## Verification and deployment status

- Foundation and horse/customer updates were pushed to `main`; the production sign-in page and signed-out redirects were checked. Full authenticated production CRUD has not been exercised by the agent.
- Training log implementation includes migration `20261021000300_training_log.sql`. Apply it before using the new feature; production migration completion has not been confirmed.
- Training log increment: all 15 tests, TypeScript checks, and the production build pass. Database tests run the actual migrations locally and verify admin permissions, CRUD, duration constraints, retained history, and ownership/billing safeguards. The authenticated training-log UI has not been exercised against production. No production records were created for testing.
