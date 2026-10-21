# Squared Away Performance Horses

## Direction

Traditional western branding for a Granbury, Texas horse training business. Services: full-time training, colt starting, calf roping training and seasoning, and sale horses. Public calls to action: call/text and training inquiry. No logo, media, domain, or existing records yet.

Build the admin experience first, for one administrator and up to ten horses in training. Use Next.js, TypeScript, Tailwind CSS, Supabase, GitHub, and Vercel. Customer access and the marketing site follow. No offline editing requirement.

## First release

Current implementation increment: admin sign-in, dashboard, customer/horse CRUD, editable horse/customer links (including shared ownership and sales), training stays, and reminder/category CRUD. Horse and customer relationships save atomically. Ownership changes preserve billing responsibility on existing training stays. Apply pending migrations through the connected deployment workflow. Billing, receipt uploads, ownership transfer history, training sessions/notes, customer access, marketing, and PWA installation remain subsequent work.

1. Authentication and an admin-only application shell.
2. Customers and horse profiles, including multiple horses per customer and multiple customer relationships per horse. Assign one billing customer per training stay; preserve historical assignments.
3. Training stays with configurable monthly rates, billing dates, arrival/departure dates, and explicit proration settings. Record both dated progress notes and individual riding sessions with a quick mobile entry flow.
4. User-managed reminder categories and reminder CRUD: create, view, update, delete, and complete. Initial suggestions include farrier, vaccinations, deworming, dental, and medications. A reminder is not automatically a delivered notification.
5. Expenses for vet, farrier, hauling, and other categories. Store receipts privately and attach them to expense records. Track customer reimbursement separately from the original expense.
6. Invoices, line items, and recorded payments with partial payment support. Derive balances from payments and adjustments. Configure optional external payment links; do not treat visiting a link as payment confirmation.
7. Dashboard showing active horses, upcoming/overdue reminders, open balances, and recent activity. All initial records are real user entries; show helpful empty states.

## Horse profile

Barn name, registered name, registration number, birth year, sex, breed, linked customers, training goals, feeding instructions, health notes, and optional photos.

## Data and access foundation

Suggested entities: customers, horses, horse_customers, training_stays, training_sessions, horse_notes, reminder_categories, reminders, expenses, receipt_attachments, invoices, invoice_items, payments, and payment_allocations.

Store money as integer cents. Use date-only fields for billing/service dates and timezone-aware timestamps for recorded activity. Historical invoice line items retain the billed description, customer, and amounts even if current profiles or rates change. Finalized invoices use adjustments rather than silent overwrites.

Supabase migrations live in version control. Enforce access through database row-level security and private storage policies, not navigation visibility. Administrator status is assigned through a trusted server-controlled mechanism. Future customer accounts link explicitly to customer records and may only retrieve approved records and attachments. Private notes and customer-visible updates are distinct.

Production, local development, and previews need explicitly configured environments. Preview deployments must not implicitly write to production data. Never commit credentials or expose server-only keys to the browser.

## Later releases

- Invite-only customer dashboard: horses, shared training updates, media, care, documents, invoices, and payment history.
- Public Home, About, Training, Sale Horses, and Contact/Inquiry pages.
- Installable PWA with appropriate icons and manifest; do not cache private responses in a service worker by default.
- Optional online payment processing, delivered notifications, and accounting export after core workflows are established.

## Decisions still needed

- Repository confirmed: https://github.com/psides83/squared-away-ph-site. Repository visibility remains unverified.
- Whether partial first/last months are prorated and which calculation applies; partial payments are already supported as a separate requirement.
- Outside-expense markup or at-cost reimbursement policy.
- Default rates, invoice due dates, payment instructions, and business contact details.

## Delivery sequence

Create GitHub repository; connect Supabase and Vercel; scaffold the application and design system; implement authentication and customer/horse workflows; add stays/training/reminders; add receipts and billing; then customer portal and public marketing site. Apply database migrations through a deliberate reviewed deployment process.
