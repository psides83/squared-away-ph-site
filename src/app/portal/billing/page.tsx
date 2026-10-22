import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { invoiceStatus } from "@/lib/invoices";
import { PageHeading } from "@/components/ui";
export default async function CustomerBilling({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const query = await searchParams;
  const { db } = await requireCustomer();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(query.page) || 1)),
  );
  const result = await db.rpc("portal_invoices", { p_page: page });
  return (
    <>
      <PageHeading
        eyebrow="CLEAR BILLS. GOOD RECORDS."
        title="Your billing"
        description="Invoices and payments billed to your customer account. Other owners’ billing stays private."
      />
      {result.error ? (
        <p className="notice error" role="alert">
          Your billing couldn’t load. Please try again or contact Squared Away.
        </p>
      ) : (
        <>
          <p className="notice">
            Outstanding {money(Number(result.data?.outstanding_cents ?? 0))} ·
            overdue {money(Number(result.data?.overdue_cents ?? 0))}. Payments
            are recorded after your trainer receives them; opening a payment
            link does not mark an invoice paid.
          </p>
          <section className="panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Issued / due</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data?.rows?.map(
                    (i: {
                      id: string;
                      invoice_number: number;
                      issue_date: string;
                      due_date: string;
                      status: string;
                      total_cents: number;
                      paid_cents: number;
                      balance_cents: number;
                    }) => (
                      <tr key={i.id}>
                        <td>
                          <Link
                            className="text-link"
                            href={`/portal/billing/${i.id}`}
                          >
                            SAPH-{i.invoice_number}
                          </Link>
                        </td>
                        <td>
                          {dateLabel(i.issue_date)}
                          <small className="cell-secondary">
                            Due {dateLabel(i.due_date)}
                          </small>
                        </td>
                        <td>{money(Number(i.total_cents))}</td>
                        <td>{money(Number(i.paid_cents))}</td>
                        <td>
                          {i.status === "void"
                            ? "Voided"
                            : money(Number(i.balance_cents))}
                        </td>
                        <td>{invoiceStatus(i, today())}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            {!result.data?.rows?.length && (
              <p className="record-form muted">
                Your finalized invoices will appear here.
              </p>
            )}
            <nav className="log-pagination" aria-label="Invoice pages">
              {page > 1 ? (
                <Link href={`/portal/billing?page=${page - 1}`}>Previous</Link>
              ) : (
                <span />
              )}
              <span>Page {page}</span>
              {page * 25 < Number(result.data?.total ?? 0) ? (
                <Link href={`/portal/billing?page=${page + 1}`}>Next</Link>
              ) : (
                <span />
              )}
            </nav>
          </section>
        </>
      )}
    </>
  );
}
