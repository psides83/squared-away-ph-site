import { deleteRecord } from "@/app/admin/actions";
import { DeleteButton } from "@/components/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel, money } from "@/lib/format";
import { invoiceStatus } from "@/lib/invoices";
import { SectionTabs } from "@/components/section-tabs";
import { PageHeading, Notice } from "@/components/ui";
import {
  CustomerSummary,
  CustomerActions,
  CustomerContact,
  type CustomerSummaryData,
} from "@/components/customer-summary";
import {
  HorseStatus,
  HorseQuickActions,
  type HorseStatusData,
} from "@/components/horse-status";
export default async function CustomerRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; success?: string; status?: string }>;
}) {
  const { id } = await params,
    query = await searchParams;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const { db } = await requireAdmin();
  const page = Math.max(
      1,
      Math.min(10000, Math.floor(Number(query.page) || 1)),
    ),
    date = today();
  let bills = db
    .from("invoice_totals")
    .select("*", { count: "exact" })
    .eq("customer_id", id)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 25, page * 25 - 1);
  if (query.status === "outstanding")
    bills = bills.eq("status", "issued").gt("balance_cents", 0);
  const [
    customer,
    overview,
    links,
    horses,
    stays,
    invoices,
    horseStatus,
    grants,
  ] = await Promise.all([
    db.from("customers").select("*").eq("id", id).maybeSingle(),
    db.rpc("customer_overview"),
    db.from("horse_customers").select("horse_id").eq("customer_id", id),
    db.from("horses").select("id,barn_name").order("barn_name"),
    db
      .from("training_stays")
      .select("id,horse_id,arrival_date")
      .eq("billing_customer_id", id)
      .lte("arrival_date", date)
      .or(`departure_date.is.null,departure_date.gte.${date}`),
    bills,
    db.rpc("horse_overview"),
    db
      .from("customer_horse_access")
      .select("horse_id,active")
      .eq("customer_id", id)
      .eq("active", true),
  ]);
  if (!customer.data && !customer.error) notFound();
  const c = customer.data,
    summary = (overview.data as CustomerSummaryData[] | null)?.find(
      (s) => s.customer_id === id,
    );
  const failed = [
    customer,
    overview,
    links,
    horses,
    stays,
    invoices,
    horseStatus,
    grants,
  ].some((r) => r.error);
  const linked = (horses.data ?? []).filter((h) =>
    links.data?.some((l) => l.horse_id === h.id),
  );
  const billUrl = (p: number, status = query.status) =>
    `/admin/customers/${id}?page=${p}${status === "outstanding" ? "&status=outstanding" : ""}#customer-billing`;
  return (
    <>
      <Link className="text-link" href="/admin/customers">
        Back to customers
      </Link>
      <PageHeading
        title={c?.name ?? "Customer record"}
        description="Contact, horses, billing, and portal access in one place."
      />
      <Notice
        error={
          failed
            ? "Some customer information could not load. Check the latest database migrations and refresh."
            : undefined
        }
        success={query.success}
      />
      {c && (
        <>
          <section className="panel">
            <div className="record-form">
              <CustomerContact phone={c.phone} email={c.email} />
              <CustomerActions customer={c} />
              <CustomerSummary summary={overview.error ? undefined : summary} />
            </div>
          </section>
          <SectionTabs
            id="customer"
            label="Customer record sections"
            defaultTab={query.page || query.status ? "billing" : "overview"}
            sections={[
              {
                id: "overview",
                label: "Overview",
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Customer details</h2>
                      <Link
                        className="text-link"
                        href={`/admin/customers?edit=${id}#record-form`}
                      >
                        Edit customer
                      </Link>
                    </div>
                    <div className="record-form stack">
                      <h3>Invoice preference</h3>
                      <p>
                        {c.invoice_presentation === "combined_services"
                          ? "Training, feed, and board combined"
                          : "Training, feed, and board itemized"}
                        . Other charges stay separate.
                      </p>
                      <h3>Private notes</h3>
                      <p className="log-notes">
                        {c.notes || "No private notes added."}
                      </p>
                      <Link
                        className="text-link"
                        href={`/admin/customers/${id}#customer-horses`}
                      >
                        View horses and training stays
                      </Link>
                      <details>
                        <summary>Manage customer record</summary>
                        <form action={deleteRecord.bind(null, "customers")}>
                          <input type="hidden" name="id" value={id} />
                          <DeleteButton confirmText="Delete this customer? Linked horses and billing records may prevent deletion." />
                        </form>
                      </details>
                    </div>
                  </section>
                ),
              },
              {
                id: "horses",
                label: `Horses (${linked.length})`,
                content: (
                  <>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Linked horses</h2>
                        <Link
                          className="text-link"
                          href={`/admin/horses?new=1&customer=${id}#record-form`}
                        >
                          Add a horse
                        </Link>
                      </div>
                      {links.error || horses.error ? (
                        <p className="record-form">Horse links unavailable.</p>
                      ) : linked.length ? (
                        <div className="horse-grid">
                          {linked.map((h) => (
                            <article className="horse-card" key={h.id}>
                              <h3>
                                <Link href={`/admin/horses/${h.id}`}>
                                  {h.barn_name}
                                </Link>
                              </h3>
                              <HorseStatus
                                showBilling={false}
                                status={(
                                  horseStatus.data as HorseStatusData[] | null
                                )?.find((s) => s.horse_id === h.id)}
                              />
                              <HorseQuickActions id={h.id} />
                              <Link
                                className="text-link"
                                href={`/admin/horses/${h.id}`}
                              >
                                View horse record
                              </Link>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="record-form">
                          No horses currently linked. Assign customers from a
                          horse’s profile.
                        </p>
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Current stays billed to this customer</h2>
                      </div>
                      <div className="record-form stack">
                        {stays.error ? (
                          <p>Training stays unavailable.</p>
                        ) : stays.data?.length ? (
                          stays.data.map((s) => (
                            <div className="record-row" key={s.id}>
                              <Link
                                className="text-link"
                                href={`/admin/horses/${s.horse_id}`}
                              >
                                {horses.data?.find((h) => h.id === s.horse_id)
                                  ?.barn_name ?? "Horse"}
                              </Link>
                              <span>Arrived {dateLabel(s.arrival_date)}</span>
                              <Link
                                className="text-link"
                                href={`/admin/training?edit=${s.id}#record-form`}
                              >
                                View agreement
                              </Link>
                            </div>
                          ))
                        ) : (
                          <p>
                            No current training stays billed to this customer.
                          </p>
                        )}
                        <p className="muted">
                          Billing agreements remain with their billed customer
                          when horse ownership changes.
                        </p>
                      </div>
                    </section>
                  </>
                ),
              },
              {
                id: "billing",
                label: "Billing",
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Invoices & payments</h2>
                      <span className="count-badge">
                        {invoices.count ?? 0} invoices
                      </span>
                    </div>
                    <div className="record-form">
                      <div className="row-actions">
                        <Link
                          className="button secondary"
                          href={billUrl(1, "all")}
                        >
                          All invoices
                        </Link>
                        <Link
                          className="button secondary"
                          href={billUrl(1, "outstanding")}
                        >
                          Outstanding
                        </Link>
                        <Link
                          className="button"
                          href={`/admin/invoices?new=1&customer=${id}#invoice-form`}
                        >
                          New invoice
                        </Link>
                      </div>
                      {invoices.error ? (
                        <p>Invoices could not load.</p>
                      ) : invoices.data?.length ? (
                        invoices.data.map((i) => (
                          <article className="customer-invoice-row" key={i.id}>
                            <div>
                              <h3>
                                <Link href={`/admin/invoices/${i.id}`}>
                                  {i.invoice_number
                                    ? `Invoice #${i.invoice_number}`
                                    : "Draft invoice"}
                                </Link>
                              </h3>
                              <p className="muted">
                                {invoiceStatus(i, date)} · Due{" "}
                                {dateLabel(i.due_date)}
                              </p>
                              <p>
                                Total {money(i.total_cents)} · Paid{" "}
                                {money(i.paid_cents)} · Balance{" "}
                                {money(i.balance_cents)}
                              </p>
                            </div>
                            <div className="row-actions">
                              <Link
                                className="text-link"
                                href={`/admin/invoices/${i.id}`}
                              >
                                View invoice
                              </Link>
                              {i.status === "issued" && i.balance_cents > 0 && (
                                <Link
                                  className="button secondary"
                                  href={`/admin/invoices/${i.id}#invoice-payments`}
                                >
                                  Record payment
                                </Link>
                              )}
                            </div>
                          </article>
                        ))
                      ) : (
                        <p>No invoices match this view.</p>
                      )}
                      {((invoices.count ?? 0) > 25 || page > 1) && (
                        <nav
                          className="log-pagination"
                          aria-label="Customer invoice pages"
                        >
                          {page > 1 ? (
                            <Link href={billUrl(page - 1)}>Previous</Link>
                          ) : (
                            <span />
                          )}
                          <span>Page {page}</span>
                          {page * 25 < (invoices.count ?? 0) ? (
                            <Link href={billUrl(page + 1)}>Next</Link>
                          ) : (
                            <span />
                          )}
                        </nav>
                      )}
                    </div>
                  </section>
                ),
              },
              {
                id: "portal",
                label: "Portal access",
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Customer portal</h2>
                    </div>
                    <div className="record-form stack">
                      <p>
                        Sign-in access:{" "}
                        <strong>
                          {overview.error
                            ? "Unavailable"
                            : (summary?.portal_status ?? "Unavailable")}
                        </strong>
                      </p>
                      <p>
                        Manually shared horses:{" "}
                        {grants.error
                          ? "Unavailable"
                          : (grants.data?.length ?? 0)}
                      </p>
                      <p className="muted">
                        Horse ownership and portal sharing are managed
                        separately. Review access after a horse is sold.
                      </p>
                      <Link
                        className="button secondary"
                        href={`/admin/portal?customer=${id}`}
                      >
                        Manage portal access
                      </Link>
                    </div>
                  </section>
                ),
              },
            ]}
          />
        </>
      )}
    </>
  );
}
