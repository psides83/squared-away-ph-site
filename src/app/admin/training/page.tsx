import Link from "next/link";
import { ClipboardList, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { EmptyState, Field, Notice, PageHeading } from "@/components/ui";
import { DeleteButton, SubmitButton } from "@/components/submit-button";
import { deleteRecord, saveRecord } from "@/app/admin/actions";
import { stayFormDefaults } from "@/lib/business-settings";

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
          <section className="panel editor-panel" id="record-form">
            <div className="panel-heading">
              <h2>{selected ? "Edit training stay" : "Welcome to the barn"}</h2>
              <Link href="/admin/training" aria-label="Close training form">
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
                  <select
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
                  </select>
                </label>
                <label>
                  Billing customer <span className="required">*</span>
                  <select
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
                  </select>
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
                <Field
                  name="billing_day"
                  label="Billing day of month (1–28)"
                  type="number"
                  required
                  min={1}
                  max={28}
                  step="1"
                  defaultValue={defaults?.billingDay}
                />
                <label>
                  Partial month policy
                  <select name="proration" defaultValue={defaults?.proration}>
                    <option value="manual">Decide manually</option>
                    <option value="calendar_days">
                      Prorate by calendar days
                    </option>
                    <option value="none">No proration</option>
                  </select>
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
              <p className="notice">
                New stays use your business settings as a starting point. You
                can override them here. This records your agreement; automatic
                invoices and proration calculations will come with billing.
              </p>
              <div className="form-actions">
                <SubmitButton>
                  {selected ? "Save changes" : "Start training stay"}
                </SubmitButton>
                <Link href="/admin/training" className="text-button">
                  Cancel
                </Link>
              </div>
            </form>
          </section>
        ) : (
          <p className="notice">
            First <Link href="/admin/horses?new=1">add a horse</Link> and{" "}
            <Link href="/admin/customers?new=1">a customer</Link> to create a
            training stay.
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
                        {horses.data?.find((h) => h.id === stay.horse_id)
                          ?.barn_name ?? "Horse"}
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
                        Billing day {stay.billing_day}
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
                          className="text-button"
                          href={`/admin/training?edit=${stay.id}#record-form`}
                        >
                          Edit
                        </Link>
                        <form
                          action={deleteRecord.bind(null, "training_stays")}
                        >
                          <input type="hidden" name="id" value={stay.id} />
                          <DeleteButton />
                        </form>
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
