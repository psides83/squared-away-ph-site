import { SectionTabs } from "@/components/section-tabs";
import {
  CreditRefundHistory,
  type CreditRefundRow,
} from "@/components/credit-refund-history";
import Link from "next/link";
import { requireCustomer } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import { invoiceStatus } from "@/lib/invoices";
import { PageHeading } from "@/components/ui";
export default async function CustomerBilling({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; refund_page?: string }>;
}) {
  const query = await searchParams;
  const { db } = await requireCustomer();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(query.page) || 1)),
  );
  const refundPage = Math.max(
    1,
    Math.min(10000, Math.floor(Number(query.refund_page) || 1)),
  );
  const [result, credit, refunds] = await Promise.all([
    db.rpc("portal_invoices", { p_page: page }),
    db.rpc("portal_account_credit"),
    db.rpc("portal_credit_refunds", { p_page: refundPage }),
  ]);
  const refundData = refunds.data as {
    count: number;
    refunded_cents: number;
    rows: CreditRefundRow[];
  } | null;
  return (
    <>
      <PageHeading
        eyebrow="CLEAR BILLS. GOOD RECORDS."
        title="Your billing"
        description="Invoices and payments billed to your customer account. Other owners’ billing stays private."
      />
      <section className="panel">
        <div className="record-form">
          <h2>Available account credit</h2>
          {credit.error ? (
            <p className="notice error">
              Account credit could not load. Please try again.
            </p>
          ) : (
            <>
              <p>{money(Number(credit.data))}</p>
              <p className="muted">
                Your trainer chooses when to apply credit to an invoice.
                Available credit has not yet reduced the balances below.
              </p>
            </>
          )}
        </div>
      </section>
      <SectionTabs
        id="billing"
        label="Billing records"
        defaultTab={query.refund_page ? "credit-refunds" : "invoices"}
        sections={[
          {
            id: "invoices",
            label: "Invoices",
            content: (
              <>
                {result.error ? (
                  <p className="notice error" role="alert">
                    Your billing couldn’t load. Please try again or contact
                    Squared Away.
                  </p>
                ) : (
                  <>
                    <p className="notice">
                      Outstanding{" "}
                      {money(Number(result.data?.outstanding_cents ?? 0))} ·
                      overdue {money(Number(result.data?.overdue_cents ?? 0))}.
                      Payments are recorded after your trainer receives them;
                      opening a payment link does not mark an invoice paid.
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
                      <nav
                        className="log-pagination"
                        aria-label="Invoice pages"
                      >
                        {page > 1 ? (
                          <Link
                            className="button secondary"
                            href={`/portal/billing?page=${page - 1}`}
                          >
                            Previous
                          </Link>
                        ) : (
                          <span />
                        )}
                        <span>Page {page}</span>
                        {page * 25 < Number(result.data?.total ?? 0) ? (
                          <Link
                            className="button secondary"
                            href={`/portal/billing?page=${page + 1}`}
                          >
                            Next
                          </Link>
                        ) : (
                          <span />
                        )}
                      </nav>
                    </section>
                  </>
                )}
              </>
            ),
          },
          {
            id: "credit-refunds",
            label: "Credit refunds",
            content: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Account-credit refunds</h2>
                  {refundData && !refunds.error && (
                    <span className="tag">
                      {money(refundData.refunded_cents)} returned
                    </span>
                  )}
                </div>
                {refunds.error || !refundData ? (
                  <p className="record-form notice error">
                    Your credit refunds could not load. Please try again.
                  </p>
                ) : (
                  <>
                    <CreditRefundHistory rows={refundData.rows} />
                    {(refundPage > 1 || refundData.count > 25) && (
                      <nav
                        className="log-pagination"
                        aria-label="Credit refund pages"
                      >
                        {refundPage > 1 ? (
                          <Link
                            className="button secondary"
                            href={`/portal/billing?refund_page=${refundPage - 1}#billing-credit-refunds`}
                          >
                            Previous
                          </Link>
                        ) : (
                          <span />
                        )}
                        <span>Page {refundPage}</span>
                        {refundPage * 25 < refundData.count ? (
                          <Link
                            className="button secondary"
                            href={`/portal/billing?refund_page=${refundPage + 1}#billing-credit-refunds`}
                          >
                            Next
                          </Link>
                        ) : (
                          <span />
                        )}
                      </nav>
                    )}
                  </>
                )}
              </section>
            ),
          },
        ]}
      />
    </>
  );
}
