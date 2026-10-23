import { AppSelect } from "@/components/app-select";
import { BillingScheduleFields } from "@/components/billing-schedule-fields";
import { billingScheduleLabels } from "@/lib/billing-schedule";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { ClipboardList, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { EmptyState, Field, Notice, PageHeading } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveRecord } from "@/app/admin/actions";
import {
  stayFormDefaults,
  stayServiceFormDefaults,
} from "@/lib/business-settings";
import { StayServiceFields } from "@/components/stay-service-fields";
import { serviceLabels } from "@/lib/billing-days";

export default async function Training({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    edit?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const [stays, horses, customers, settings] = await Promise.all([
    db
      .from("training_stays")
      .select("*")
      .order("arrival_date", { ascending: false }),
    db.from("horses").select("id, barn_name").order("barn_name"),
    db.from("customers").select("id, name").order("name"),
    db.from("business_settings").select("*").single(),
  ]);
  const selected = stays.data?.find((row) => row.id === params.edit);
  const closeHref = selected
    ? `/admin/training/${selected.id}`
    : "/admin/training";
  const failed =
    stays.error || horses.error || customers.error || settings.error;
  const defaults = settings.data
    ? stayFormDefaults(selected, settings.data)
    : null;
  const canAdd = Boolean(horses.data?.length && customers.data?.length);
  return (
    <>
      <PageHeading
        eyebrow="GOOD WORK TAKES A PLAN"
        title="Training stays"
        description="A clear record of when they’re here, who’s responsible, and the agreed rate."
        action={{
          href: "/admin/training?new=1#record-form",
          label: "Start a stay",
        }}
      />
      <Notice
        error={
          failed
            ? "Training records could not be loaded. Check your database setup and refresh."
            : params.error ||
              (params.edit && !selected
                ? "That stay could not be found."
                : undefined)
        }
        success={params.success}
      />
      {(params.new === "1" || selected) &&
        !failed &&
        (canAdd ? (
          <ActionPanel
            id="record-form"
            label="Training stay"
            defaultOpen
            closeHref={closeHref}
          >
            <div className="panel-heading">
              <h2>{selected ? "Edit training stay" : "Welcome to the barn"}</h2>
              <Link
                className="dialog-close"
                href={closeHref}
                aria-label="Close training form"
              >
                <X size={20} />
              </Link>
            </div>
            <form
              action={saveRecord.bind(null, "training_stays")}
              className="record-form"
            >
              <input type="hidden" name="id" value={selected?.id ?? ""} />
              <div className="form-grid">
                <label>
                  Horse <span className="required">*</span>
                  <AppSelect
                    name="horse_id"
                    required
                    defaultValue={selected?.horse_id ?? ""}
                  >
                    <option value="" disabled>
                      Select a horse
                    </option>
                    {horses.data?.map((horse) => (
                      <option key={horse.id} value={horse.id}>
                        {horse.barn_name}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <label>
                  Billing customer <span className="required">*</span>
                  <AppSelect
                    name="billing_customer_id"
                    required
                    defaultValue={selected?.billing_customer_id ?? ""}
                  >
                    <option value="" disabled>
                      Select a customer
                    </option>
                    {customers.data?.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                <Field
                  name="arrival_date"
                  label="Arrival date"
                  type="date"
                  required
                  defaultValue={selected?.arrival_date ?? today()}
                />
                <Field
                  name="departure_date"
                  label="Departure date (optional)"
                  type="date"
                  defaultValue={selected?.departure_date}
                />
                <Field
                  name="monthly_rate"
                  label="Monthly training rate ($)"
                  type="number"
                  required
                  min={0}
                  max={1000000}
                  step="0.01"
                  defaultValue={defaults?.monthlyRate}
                />
                <BillingScheduleFields
                  schedule={selected?.billing_schedule ?? "custom"}
                  day={defaults?.billingDay}
                  enabled={selected?.recurring_enabled ?? false}
                  start={selected?.recurring_start_date ?? ""}
                />
                <label>
                  Partial month policy
                  <AppSelect
                    name="proration"
                    defaultValue={defaults?.proration}
                  >
                    <option value="manual">Decide manually</option>
                    <option value="calendar_days">
                      Prorate by calendar days
                    </option>
                    <option value="none">No proration</option>
                  </AppSelect>
                </label>
                <Field
                  name="invoice_due_days"
                  label="Payment due within days (0 = upon receipt)"
                  type="number"
                  min={0}
                  max={365}
                  step="1"
                  required
                  defaultValue={defaults?.invoiceDueDays}
                />
              </div>
              <label>
                Agreement / private notes
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={selected?.notes ?? ""}
                />
              </label>
              <div className="form-grid">
                <StayServiceFields
                  key={selected?.id ?? "new"}
                  {...(settings.data
                    ? stayServiceFormDefaults(selected, settings.data)
                    : {})}
                />
              </div>
              <p className="muted form-hint">
                Feed and boarding are agreed individually for this stay. Monthly
                charges use physical boarding days. Actual-cost charges use
                recorded feed consumption and reviewed boarding costs.
              </p>
              <p className="notice">
                New stays use your business settings as a starting point. You
                can override them here. Saving an agreement does not create an
                invoice. Prepare completed cycles from the recurring billing
                screen.
              </p>
              <div className="form-actions">
                <SubmitButton>
                  {selected ? "Save changes" : "Start training stay"}
                </SubmitButton>
                <Link href={closeHref} className="text-button">
                  Cancel
                </Link>
              </div>
            </form>
          </ActionPanel>
        ) : (
          <p className="notice">
            First{" "}
            <Link className="inline-link" href="/admin/horses?new=1">
              add a horse
            </Link>{" "}
            and{" "}
            <Link className="inline-link" href="/admin/customers?new=1">
              a customer
            </Link>{" "}
            to create a training stay.
          </p>
        ))}
      <section className="panel">
        <div className="panel-heading">
          <h2>The training book</h2>
          <span className="count-badge">{stays.data?.length ?? 0} stays</span>
        </div>
        {stays.data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Horse / customer</th>
                  <th>Dates</th>
                  <th>Monthly rate</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stays.data.map((stay) => (
                  <tr key={stay.id}>
                    <td>
                      <strong>
                        <Link
                          className="text-link"
                          href={`/admin/training/${stay.id}`}
                        >
                          {horses.data?.find((h) => h.id === stay.horse_id)
                            ?.barn_name ?? "Horse"}
                        </Link>
                      </strong>
                      <small className="cell-secondary">
                        {customers.data?.find(
                          (c) => c.id === stay.billing_customer_id,
                        )?.name ?? "Customer"}
                      </small>
                    </td>
                    <td>
                      {dateLabel(stay.arrival_date)}
                      <small className="cell-secondary">
                        {stay.departure_date
                          ? `To ${dateLabel(stay.departure_date)}`
                          : "Open-ended"}
                      </small>
                    </td>
                    <td>
                      {money(stay.monthly_rate_cents)}
                      <small className="cell-secondary">
                        {billingScheduleLabels[stay.billing_schedule] ??
                          "Custom day"}{" "}
                        · day {stay.billing_day}
                        {stay.recurring_enabled ? " · Recurring enabled" : ""}
                      </small>
                      <small className="cell-secondary">
                        Feed: {serviceLabels[stay.feed_billing ?? "unrecorded"]}
                        {stay.feed_monthly_cents !== null &&
                        stay.feed_monthly_cents !== undefined
                          ? ` · ${money(stay.feed_monthly_cents)}/month`
                          : ""}
                      </small>
                      <small className="cell-secondary">
                        Boarding:{" "}
                        {serviceLabels[stay.boarding_billing ?? "unrecorded"]}
                        {stay.boarding_monthly_cents !== null &&
                        stay.boarding_monthly_cents !== undefined
                          ? ` · ${money(stay.boarding_monthly_cents)}/month`
                          : ""}
                      </small>
                    </td>
                    <td>
                      <span className="tag">
                        {stay.arrival_date > today()
                          ? "Upcoming"
                          : stay.departure_date && stay.departure_date < today()
                            ? "Completed"
                            : "In training"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link
                          className="text-link"
                          href={`/admin/calendar?stay=${stay.id}`}
                        >
                          Billing calendar
                        </Link>
                        <Link
                          className="text-button"
                          href={`/admin/training?edit=${stay.id}#record-form`}
                        >
                          Edit
                        </Link>
                        <Link
                          className="text-link"
                          href={`/admin/training/${stay.id}`}
                        >
                          View stay
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !failed && (
            <EmptyState
              icon={ClipboardList}
              title="Set the foundation for good work."
              description="Connect a horse with a billing customer, set the monthly rate, and keep a history of every stay."
              href="/admin/training?new=1#record-form"
              label="Start your first training stay"
            />
          )
        )}
      </section>
    </>
  );
}
