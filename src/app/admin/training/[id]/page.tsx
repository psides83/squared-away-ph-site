import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { invoiceStatus } from "@/lib/invoices";
import { serviceLabels } from "@/lib/billing-days";
import { billingScheduleLabels } from "@/lib/billing-schedule";
import { PageHeading, Notice } from "@/components/ui";
import { SectionTabs } from "@/components/section-tabs";
import { deleteRecord } from "@/app/admin/actions";
import { DeleteButton } from "@/components/submit-button";

export default async function StayRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; success?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const { db } = await requireAdmin();
  const stay = await db
    .from("training_stays")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!stay.data && !stay.error) notFound();
  if (!stay.data)
    return (
      <Notice error="This training stay could not be loaded. Please refresh." />
    );
  const s = stay.data;
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(query.page) || 1)),
  );
  const [horse, customer, invoices] = await Promise.all([
    db.from("horses").select("barn_name").eq("id", s.horse_id).maybeSingle(),
    db
      .from("customers")
      .select("name")
      .eq("id", s.billing_customer_id)
      .maybeSingle(),
    db
      .from("invoice_totals")
      .select("*", { count: "exact" })
      .eq("stay_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 25, page * 25 - 1),
  ]);
  const date = today();
  const status =
    s.arrival_date > date
      ? "Upcoming"
      : s.departure_date && s.departure_date < date
        ? "Completed"
        : "In training";
  return (
    <>
      <Link className="text-link" href="/admin/training">
        ← Training stays
      </Link>
      <PageHeading
        eyebrow="TRAINING AGREEMENT"
        title={horse.data?.barn_name ?? "Training stay"}
        description={`${status} · Arrived ${dateLabel(s.arrival_date)}${s.departure_date ? ` · Departure ${dateLabel(s.departure_date)}` : " · Open-ended"}`}
        action={{
          href: `/admin/training?edit=${id}#record-form`,
          label: "Edit agreement",
        }}
      />
      <Notice
        success={query.success}
        error={
          horse.error || customer.error
            ? "Some linked details could not be loaded. Please refresh."
            : undefined
        }
      />
      <div className="row-actions">
        <Link className="button" href={`/admin/calendar?stay=${id}`}>
          Billing calendar
        </Link>
        <Link className="text-button" href={`/admin/horses/${s.horse_id}`}>
          Horse record
        </Link>
        <Link
          className="text-button"
          href={`/admin/customers/${s.billing_customer_id}`}
        >
          {customer.data?.name ?? "Billing customer"}
        </Link>
      </div>
      <SectionTabs
        id="stay"
        label="Training stay sections"
        sections={[
          {
            id: "agreement",
            label: "Agreement",
            content: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Training & service terms</h2>
                </div>
                <div className="record-form">
                  <p>
                    <strong>Training:</strong> {money(s.monthly_rate_cents)} per
                    month
                  </p>
                  <p>
                    <strong>Partial months:</strong>{" "}
                    {s.proration === "calendar_days"
                      ? "Calendar-day proration, counting recorded worked and billable-rest days"
                      : s.proration === "none"
                        ? "No proration"
                        : "Decide manually"}
                  </p>
                  <p>
                    <strong>Feed:</strong>{" "}
                    {serviceLabels[s.feed_billing ?? "unrecorded"]}
                    {s.feed_billing === "separate_monthly"
                      ? ` · ${money(s.feed_monthly_cents)}/month`
                      : ""}
                  </p>
                  <p>
                    <strong>Board:</strong>{" "}
                    {serviceLabels[s.boarding_billing ?? "unrecorded"]}
                    {s.boarding_billing === "separate_monthly"
                      ? ` · ${money(s.boarding_monthly_cents)}/month`
                      : ""}
                  </p>
                  <p className="muted">
                    Separate monthly feed and board count physical boarding
                    days. Actual-cost billing uses recorded consumption and
                    reviewed assigned costs.
                  </p>
                  <h3>Private agreement notes</h3>
                  <p style={{ whiteSpace: "pre-wrap" }}>
                    {s.notes || "No agreement notes recorded."}
                  </p>
                  <details>
                    <summary>Manage this stay</summary>
                    <p className="muted">
                      Historical billing and activity can prevent deletion.
                      Record a departure date to close a completed stay.
                    </p>
                    <form action={deleteRecord.bind(null, "training_stays")}>
                      <input type="hidden" name="id" value={id} />
                      <DeleteButton />
                    </form>
                  </details>
                </div>
              </section>
            ),
          },
          {
            id: "billing",
            label: "Billing",
            content: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Billing setup</h2>
                </div>
                <div className="record-form">
                  <p>
                    <strong>Schedule:</strong>{" "}
                    {billingScheduleLabels[s.billing_schedule] ?? "Custom day"}{" "}
                    · day {s.billing_day}
                  </p>
                  <p>
                    <strong>Payment terms:</strong>{" "}
                    {s.invoice_due_days == null
                      ? "Not recorded"
                      : s.invoice_due_days === 0
                        ? "Due upon receipt"
                        : `Due within ${s.invoice_due_days} days`}
                  </p>
                  <p>
                    <strong>Recurring preparation:</strong>{" "}
                    {s.recurring_enabled
                      ? `Enabled from ${dateLabel(s.recurring_start_date)}`
                      : "Not enabled"}
                  </p>
                  <p className="muted">
                    Recurring bills cover the completed cycle. Preparation is
                    started from the recurring billing screen; no unattended job
                    is running. Actual-cost periods require your ready
                    confirmation.
                  </p>
                  <div className="row-actions">
                    <Link className="button" href="/admin/invoices/recurring">
                      Recurring billing
                    </Link>
                    <Link
                      className="text-button"
                      href={`/admin/invoices?new=1&customer=${s.billing_customer_id}&stay=${id}`}
                    >
                      New invoice draft
                    </Link>
                  </div>
                </div>
              </section>
            ),
          },
          {
            id: "invoices",
            label: `Invoices${invoices.count == null ? "" : ` (${invoices.count})`}`,
            content: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Invoices for this stay</h2>
                </div>
                <div className="record-form">
                  {invoices.error ? (
                    <Notice error="Invoices could not be loaded. Please refresh." />
                  ) : !invoices.data?.length ? (
                    <p className="muted">
                      No invoices on this page. Stay-linked invoices appear
                      here; other bills remain in the customer record.
                    </p>
                  ) : (
                    invoices.data.map((i) => (
                      <div key={i.id}>
                        <Link
                          className="text-link"
                          href={`/admin/invoices/${i.id}`}
                        >
                          {i.invoice_number || "Draft invoice"}
                        </Link>
                        <p>
                          {invoiceStatus(i, date)} · Due {dateLabel(i.due_date)}{" "}
                          · {money(i.total_cents)} total ·{" "}
                          {money(i.balance_cents)} remaining
                        </p>
                      </div>
                    ))
                  )}
                  <div className="row-actions">
                    {page > 1 && (
                      <Link
                        className="text-button"
                        href={`/admin/training/${id}?page=${page - 1}#stay-invoices`}
                      >
                        Previous
                      </Link>
                    )}
                    {page * 25 < (invoices.count ?? 0) && (
                      <Link
                        className="text-button"
                        href={`/admin/training/${id}?page=${page + 1}#stay-invoices`}
                      >
                        Next
                      </Link>
                    )}
                  </div>
                </div>
              </section>
            ),
          },
        ]}
      />
    </>
  );
}
