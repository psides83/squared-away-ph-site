import { CreditRefundForm } from "@/components/credit-refund-form";
import {
  CreditRefundHistory,
  type CreditRefundRow,
} from "@/components/credit-refund-history";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { PageHeading, Notice } from "@/components/ui";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import { SectionTabs } from "@/components/section-tabs";
import {
  CustomerCreditForm,
  type CreditChoices,
} from "@/components/customer-credit-form";
import { today, money, dateLabel } from "@/lib/format";
type Credit = {
  id: string;
  source: string;
  credit_on: string;
  amount_cents: number;
  available_cents: number;
  reason: string;
  reference: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  invoice_id: string | null;
  invoice_number: number | null;
};
type Application = {
  id: string;
  invoice_id: string;
  invoice_number: number;
  applied_on: string;
  amount_cents: number;
  reversed_at: string | null;
  reversal_reason: string | null;
};
export default async function CustomerCredits({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params,
    { page: raw } = await searchParams;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const { db } = await requireAdmin(),
    page = Math.max(1, Math.min(10000, Math.floor(Number(raw) || 1)));
  const [customer, result, refunds] = await Promise.all([
    db.from("customers").select("id,name").eq("id", id).maybeSingle(),
    db.rpc("customer_credit_overview", { p_customer: id, p_page: page }),
    db.rpc("customer_credit_refund_overview", { p_customer: id, p_page: page }),
  ]);
  if (!customer.error && !customer.data) notFound();
  const data = result.data as
    | (CreditChoices & {
        available_cents: number;
        credit_count: number;
        application_count: number;
        credits: Credit[];
        applications: Application[];
      })
    | null;
  const refundData = refunds.data as {
    count: number;
    refunded_cents: number;
    rows: CreditRefundRow[];
  } | null;
  const date = today(),
    base = `/admin/customers/${id}/credits`;
  const paginate = (tab: string, count: number) =>
    page > 1 || count > 25 ? (
      <nav className="log-pagination" aria-label="Credit history pages">
        {page > 1 ? (
          <Link
            className="button secondary"
            href={`${base}?page=${page - 1}#account-credit-${tab}`}
          >
            Previous
          </Link>
        ) : (
          <span />
        )}
        <span>Page {page}</span>
        {page * 25 < count ? (
          <Link
            className="button secondary"
            href={`${base}?page=${page + 1}#account-credit-${tab}`}
          >
            Next
          </Link>
        ) : (
          <span />
        )}
      </nav>
    ) : null;
  return (
    <>
      <Link
        className="text-link"
        href={`/admin/customers/${id}#customer-billing`}
      >
        Back to customer
      </Link>
      <PageHeading
        title="Account credit"
        description={`${customer.data?.name ?? "Customer"} · Money held for future invoices and credits from paid invoices.`}
      />
      <Notice
        error={
          customer.error || result.error
            ? "Account credits could not load. Check the latest migration and refresh."
            : undefined
        }
      />
      {data && !result.error && (
        <>
          <section className="panel">
            <div className="record-form stack">
              <p className="eyebrow">AVAILABLE CREDIT</p>
              <h2>{money(data.available_cents)}</h2>
              <div className="row-actions">
                <ActionPanel id="new-account-credit" label="Add account credit">
                  <CustomerCreditForm
                    customerId={id}
                    date={date}
                    operation="record"
                    choices={data}
                  />
                </ActionPanel>
                {data.available.length > 0 && data.invoices.length > 0 && (
                  <ActionPanel
                    id="apply-account-credit"
                    label="Apply to invoice"
                  >
                    <CustomerCreditForm
                      customerId={id}
                      date={date}
                      operation="apply"
                      choices={data}
                    />
                  </ActionPanel>
                )}
                {data.available.length > 0 && !refunds.error && (
                  <ActionPanel
                    id="refund-account-credit"
                    label="Record credit refund"
                  >
                    <CreditRefundForm credits={data.available} date={date} />
                  </ActionPanel>
                )}
              </div>
            </div>
          </section>
          <HelpPanel title="How account credit works">
            <p>
              Advance payments count as cash when received. Applying credit
              later does not create another cash receipt. Reducing a fully paid
              invoice moves retained payment money into credit and reduces that
              invoice’s charges by the same amount.
            </p>
            <p>
              Expense-recovery assignments and previous refunds reduce what can
              be moved from a payment. Reverse applications first before
              correcting a source credit. Active account-credit refunds must
              also be corrected before reversing their source. Record refunds
              only after money has actually been returned; they reduce unused
              credit without changing invoice balances. Corrections retain
              history and restate the original period; they never move money.
            </p>
            <p>
              Choices show the first 100 available credits, unpaid invoices and
              eligible payments. History uses 25 entries per tab per page,
              including credit refunds; the available balance includes every
              active record. Advance cash remains unassigned to a horse or stay
              in cash reports; applying credit does not change its receipt date
              or assign that original cash to a horse.
            </p>
          </HelpPanel>
          <SectionTabs
            id="account-credit"
            label="Credit records"
            sections={[
              {
                id: "credits",
                label: "Credit history",
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Credits received</h2>
                      <span className="count-badge">{data.credit_count}</span>
                    </div>
                    <div className="record-form stack">
                      {data.credits.length ? (
                        data.credits.map((c) => (
                          <article className="customer-invoice-row" key={c.id}>
                            <div>
                              <h3>
                                {money(c.amount_cents)} ·{" "}
                                {c.source === "advance"
                                  ? "Advance payment"
                                  : "Invoice reduction"}
                              </h3>
                              <p>
                                {dateLabel(c.credit_on)} · {c.reason}
                              </p>
                              <p className="muted">
                                {c.reversed_at
                                  ? "Record reversed"
                                  : `${money(c.available_cents)} available`}
                                {c.reference ? ` · ${c.reference}` : ""}
                              </p>
                              {c.invoice_id && (
                                <Link
                                  className="text-link"
                                  href={`/admin/invoices/${c.invoice_id}`}
                                >
                                  Source invoice #{c.invoice_number}
                                </Link>
                              )}
                              {c.reversal_reason && (
                                <p>Correction: {c.reversal_reason}</p>
                              )}
                            </div>
                            {!c.reversed_at && (
                              <ActionPanel
                                id={`reverse-credit-${c.id}`}
                                label="Correct record"
                              >
                                <CustomerCreditForm
                                  customerId={id}
                                  date={date}
                                  operation="reverse-credit"
                                  recordId={c.id}
                                />
                              </ActionPanel>
                            )}
                          </article>
                        ))
                      ) : (
                        <p>No account credits recorded.</p>
                      )}
                    </div>
                    {paginate("credits", data.credit_count)}
                  </section>
                ),
              },
              {
                id: "applications",
                label: "Applied to invoices",
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Credit applications</h2>
                      <span className="count-badge">
                        {data.application_count}
                      </span>
                    </div>
                    <div className="record-form stack">
                      {data.applications.length ? (
                        data.applications.map((a) => (
                          <article className="customer-invoice-row" key={a.id}>
                            <div>
                              <h3>{money(a.amount_cents)}</h3>
                              <Link
                                className="text-link"
                                href={`/admin/invoices/${a.invoice_id}`}
                              >
                                Invoice #{a.invoice_number}
                              </Link>
                              <p>
                                {dateLabel(a.applied_on)} ·{" "}
                                {a.reversed_at
                                  ? "Record reversed"
                                  : "Credit applied"}
                              </p>
                              {a.reversal_reason && (
                                <p>Correction: {a.reversal_reason}</p>
                              )}
                            </div>
                            {!a.reversed_at && (
                              <ActionPanel
                                id={`reverse-application-${a.id}`}
                                label="Correct application"
                              >
                                <CustomerCreditForm
                                  customerId={id}
                                  date={date}
                                  operation="reverse-application"
                                  recordId={a.id}
                                />
                              </ActionPanel>
                            )}
                          </article>
                        ))
                      ) : (
                        <p>No credit applications recorded.</p>
                      )}
                    </div>
                    {paginate("applications", data.application_count)}
                  </section>
                ),
              },
              {
                id: "refunds",
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
                        Credit refund history could not load. Check the latest
                        migration and refresh.
                      </p>
                    ) : (
                      <CreditRefundHistory rows={refundData.rows} admin />
                    )}
                    {paginate("refunds", refundData?.count ?? 0)}
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
