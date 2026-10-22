import { AppSelect } from "@/components/app-select";
import {
  CustomerSummary,
  CustomerActions,
  CustomerContact,
  type CustomerSummaryData,
} from "@/components/customer-summary";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { UsersRound, X, ArrowUpRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { EmptyState, Field, Notice, PageHeading } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { saveRecord } from "@/app/admin/actions";

export default async function Customers({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    new?: string;
    edit?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const [customers, relationships, horses, overview] = await Promise.all([
    db.from("customers").select("*").order("name"),
    db.from("horse_customers").select("horse_id, customer_id"),
    db.from("horses").select("id, barn_name").order("barn_name"),
    db.rpc("customer_overview"),
  ]);
  const summaries = (overview.data ?? []) as CustomerSummaryData[];
  const search = (params.q ?? "").trim().toLowerCase();
  const data = customers.data?.filter((c) => {
    const summary = summaries.find((s) => s.customer_id === c.id);
    const matches = [
      c.name,
      c.email,
      c.phone,
      ...(relationships.data ?? [])
        .filter((r) => r.customer_id === c.id)
        .map((r) => horses.data?.find((h) => h.id === r.horse_id)?.barn_name),
    ].some((v) => v?.toLowerCase().includes(search));
    return (
      matches &&
      (!overview.error && params.status === "overdue"
        ? Number(summary?.overdue_cents) > 0
        : !overview.error && params.status === "outstanding"
          ? Number(summary?.outstanding_cents) > 0
          : !overview.error && params.status === "training"
            ? Number(summary?.current_stays) > 0
            : true)
    );
  });
  const error = customers.error || relationships.error || horses.error;
  const selected = customers.data?.find((row) => row.id === params.edit);
  const showForm = params.new === "1" || Boolean(selected);
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE HORSES"
        title="Customers"
        description="Good relationships start with keeping the details straight."
        action={{
          href: "/admin/customers?new=1#record-form",
          label: "Add a customer",
        }}
      />
      <Notice
        error={
          error
            ? "Customers could not be loaded. Check your database setup and refresh."
            : params.error ||
              (params.edit && !selected
                ? "That customer could not be found."
                : undefined)
        }
        success={params.success}
      />
      {showForm && (
        <ActionPanel
          id="record-form"
          label="Customer details"
          defaultOpen
          closeHref="/admin/customers"
        >
          <div className="panel-heading">
            <h2>{selected ? "Edit customer" : "A new relationship"}</h2>
            <Link href="/admin/customers" aria-label="Close customer form">
              <X size={20} />
            </Link>
          </div>
          <form
            action={saveRecord.bind(null, "customers")}
            className="record-form"
          >
            <input type="hidden" name="id" value={selected?.id ?? ""} />
            <div className="form-grid">
              <Field
                label="Full name"
                name="name"
                required
                defaultValue={selected?.name}
              />
              <Field
                label="Email address"
                name="email"
                type="email"
                defaultValue={selected?.email}
                maxLength={254}
              />
              <Field
                label="Phone number"
                name="phone"
                type="tel"
                defaultValue={selected?.phone}
                maxLength={50}
              />
            </div>
            <label>
              Invoice format
              <AppSelect
                name="invoice_presentation"
                defaultValue={selected?.invoice_presentation ?? "itemized"}
              >
                <option value="itemized">
                  Itemized training, feed, and board
                </option>
                <option value="combined_services">
                  Combined training, feed, and board total
                </option>
              </AppSelect>
            </label>
            <p className="muted">
              Vet, farrier, hauling, and other charges stay separate. Detailed
              charges stay in your records. This preference applies when an
              invoice is finalized; previously issued invoices keep their
              format.
            </p>
            <label>
              Private notes
              <textarea
                name="notes"
                rows={3}
                maxLength={5000}
                defaultValue={selected?.notes ?? ""}
                placeholder="Contact preferences, billing details, and anything worth remembering."
              />
            </label>
            <div className="form-actions">
              <SubmitButton>
                {selected ? "Save changes" : "Add customer"}
              </SubmitButton>
              <Link href="/admin/customers" className="text-button">
                Cancel
              </Link>
            </div>
          </form>
        </ActionPanel>
      )}
      {overview.error && (
        <p className="notice error">
          Customer summaries could not load. Check the latest database
          migration. Balance and training filters are unavailable.
        </p>
      )}
      <form
        action="/admin/customers"
        className="panel record-form customer-list-filter"
      >
        <div className="form-grid">
          <Field
            name="q"
            label="Find a customer or horse"
            defaultValue={params.q}
            maxLength={200}
          />
          <label>
            Show
            <AppSelect
              name="status"
              defaultValue={params.status ?? "all"}
              disabled={Boolean(overview.error)}
            >
              <option value="all">All customers</option>
              <option value="training">Currently billed for training</option>
              <option value="outstanding">Outstanding bills</option>
              <option value="overdue">Past-due bills</option>
            </AppSelect>
          </label>
        </div>
        <div className="form-actions">
          <button className="button secondary">Apply</button>
          {(params.q || params.status) && (
            <Link className="text-link" href="/admin/customers">
              Clear
            </Link>
          )}
        </div>
      </form>
      <section className="panel">
        <div className="panel-heading">
          <h2>Your customers</h2>
          <span className="count-badge">{data?.length ?? 0} on file</span>
        </div>
        {data?.length ? (
          <div className="horse-grid customer-grid">
            {data.map((row) => (
              <article className="horse-card" key={row.id}>
                <h3>
                  <Link href={`/admin/customers/${row.id}`}>
                    {row.name}
                    <ArrowUpRight size={17} />
                  </Link>
                </h3>
                <CustomerContact phone={row.phone} email={row.email} />
                <CustomerSummary
                  summary={
                    overview.error
                      ? undefined
                      : summaries.find((s) => s.customer_id === row.id)
                  }
                />
                <div className="row-actions">
                  {(relationships.data ?? [])
                    .filter((r) => r.customer_id === row.id)
                    .map((r) => (
                      <Link
                        className="text-link"
                        key={r.horse_id}
                        href={`/admin/horses/${r.horse_id}`}
                      >
                        {horses.data?.find((h) => h.id === r.horse_id)
                          ?.barn_name ?? "Horse"}
                      </Link>
                    ))}
                </div>
                <CustomerActions customer={row} />
                <div className="row-actions">
                  <Link
                    className="text-link"
                    href={`/admin/customers/${row.id}`}
                  >
                    View customer record
                  </Link>
                  <Link
                    className="text-link"
                    href={`/admin/customers/${row.id}#customer-billing`}
                  >
                    Billing
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          !error && (
            <EmptyState
              icon={UsersRound}
              title={
                customers.data?.length
                  ? "No customers match."
                  : "Make room for good people."
              }
              description={
                customers.data?.length
                  ? "Try a different name, horse, or status filter."
                  : "Add your first customer, then connect them when adding a horse."
              }
              href={
                customers.data?.length
                  ? "/admin/customers"
                  : "/admin/customers?new=1#record-form"
              }
              label={
                customers.data?.length
                  ? "Show all customers"
                  : "Add your first customer"
              }
            />
          )
        )}
      </section>
    </>
  );
}
