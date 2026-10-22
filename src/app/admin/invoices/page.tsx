import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { FileText } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel, money } from "@/lib/format";
import { invoiceStatus } from "@/lib/invoices";
import { PageHeading, Notice, Field, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { InvoiceOriginFields } from "@/components/invoice-origin-fields";
import { createInvoice } from "./actions";
export default async function Invoices({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    customer?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.page) || 1)),
  );
  const date = today();
  const [invoices, customers, stays, horses, settings] = await Promise.all([
    db
      .from("invoice_totals")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 25, page * 25 - 1),
    db.from("customers").select("id,name").order("name"),
    db
      .from("training_stays")
      .select("id,horse_id,billing_customer_id,arrival_date,invoice_due_days")
      .order("arrival_date", { ascending: false }),
    db.from("horses").select("id,barn_name"),
    db.from("business_settings").select("default_invoice_due_days").single(),
  ]);
  const failed = [invoices, customers, stays, horses, settings].some(
    (r) => r.error,
  );
  return (
    <>
      <PageHeading
        eyebrow="CLEAR BILLS, GOOD RELATIONSHIPS"
        title="Invoices & payments"
        description="Prepare the bill, review it, and keep every payment accounted for."
        action={{
          href: "/admin/invoices?new=1#invoice-form",
          label: "Create invoice",
        }}
      />
      <Notice
        error={
          failed
            ? "Invoices couldn’t load. Confirm the billing migration has completed."
            : params.error
        }
        success={params.success}
      />
      {!failed && params.new === "1" && (
        <ActionPanel
          id="invoice-form"
          label="Create invoice"
          defaultOpen
          closeHref="/admin/invoices"
        >
          <div className="panel-heading">
            <h2>Start a draft invoice</h2>
          </div>
          {customers.data?.length ? (
            <form action={createInvoice} className="record-form">
              <input
                name="request_id"
                type="hidden"
                value={crypto.randomUUID()}
              />
              <div className="form-grid">
                <InvoiceOriginFields
                  key={params.customer ?? "new"}
                  customers={customers.data}
                  initialCustomer={
                    customers.data?.some((c) => c.id === params.customer)
                      ? params.customer
                      : undefined
                  }
                  stays={stays.data ?? []}
                  horses={horses.data ?? []}
                  date={date}
                  defaultDueDays={settings.data?.default_invoice_due_days ?? 0}
                />
                <Field
                  name="period_from"
                  label="Billing period from (required for a stay)"
                  type="date"
                />
                <Field
                  name="period_to"
                  label="Billing period through (required for a stay)"
                  type="date"
                />
              </div>
              <label>
                Customer-facing invoice notes
                <textarea name="notes" rows={3} maxLength={5000} />
              </label>
              <p className="muted form-hint">
                Review the due date against the stay’s agreed terms. Choose the
                historical training stay when invoicing a former owner. Invoice
                creation does not send a message or collect money.
              </p>
              <SubmitButton>Create draft</SubmitButton>
            </form>
          ) : (
            <p className="record-form muted">
              Add a customer before creating an invoice.
            </p>
          )}
        </ActionPanel>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>The billing book</h2>
          <span className="count-badge">{invoices.count ?? 0} invoices</span>
        </div>
        {invoices.data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Invoice / customer</th>
                  <th>Due</th>
                  <th>Total</th>
                  <th>Paid / remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.data.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link
                        className="record-name"
                        href={`/admin/invoices/${i.id}`}
                      >
                        {i.invoice_number
                          ? `SAPH-${i.invoice_number}`
                          : "Draft invoice"}
                      </Link>
                      <small className="cell-secondary">
                        {i.customer_snapshot?.name ??
                          customers.data?.find((c) => c.id === i.customer_id)
                            ?.name ??
                          "Customer"}
                      </small>
                    </td>
                    <td>{dateLabel(i.due_date)}</td>
                    <td>{money(Number(i.total_cents))}</td>
                    <td>
                      {money(Number(i.paid_cents))}
                      <small className="cell-secondary">
                        {money(Number(i.balance_cents))} remaining
                        {i.status !== "issued" ? " (not receivable)" : ""}
                      </small>
                    </td>
                    <td>
                      <span className="tag">{invoiceStatus(i, date)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !failed && (
            <EmptyState
              icon={FileText}
              title="A clear bill starts with a draft."
              description="Add reviewed training charges, customer expense reimbursements, or manual lines. Finalize when everything is right."
              href="/admin/invoices?new=1#invoice-form"
              label="Create your first invoice"
            />
          )
        )}
        <nav className="log-pagination" aria-label="Invoice pages">
          {page > 1 ? (
            <Link
              className="text-link"
              href={`/admin/invoices?page=${page - 1}`}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>Page {page}</span>
          {page * 25 < (invoices.count ?? 0) ? (
            <Link
              className="text-link"
              href={`/admin/invoices?page=${page + 1}`}
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}
