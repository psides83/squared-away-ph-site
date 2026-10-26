import { InvoiceCreditSummary } from "@/components/invoice-credit-summary";
import { InvoiceRefundSummary } from "@/components/invoice-refund-summary";
import { phoneDisplay } from "@/lib/input-format";
import { CustomerInvoiceLines } from "@/components/customer-invoice-lines";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/auth";
import { dateLabel, money, today } from "@/lib/format";
import {
  invoiceStatus,
  securePaymentLink,
  paymentMethodLabels,
} from "@/lib/invoices";
import { PrintInvoice } from "@/components/invoice-buttons";
export default async function CustomerInvoice({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db } = await requireCustomer();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const result = await db.rpc("portal_invoice", { p_invoice: id });
  if (result.error)
    return (
      <p className="notice error" role="alert">
        This invoice couldn’t load. Please try again.
      </p>
    );
  if (!result.data) notFound();
  const i = result.data;
  return (
    <>
      <div className="row-actions invoice-toolbar no-print">
        <Link href="/portal/billing" className="text-link">
          Your billing
        </Link>
        <PrintInvoice />
      </div>
      <section className="panel invoice-document">
        <div className="invoice-doc-header">
          <div>
            <p className="eyebrow">
              {i.business?.name ?? "SQUARED AWAY PERFORMANCE HORSES"}
            </p>
            <h1>SAPH-{i.invoice_number}</h1>
            <p>{invoiceStatus(i, today())}</p>
            {i.business?.phone && <p>{phoneDisplay(i.business.phone)}</p>}
            {i.business?.email && <p>{i.business.email}</p>}
          </div>
          <div>
            <p>Invoice date: {dateLabel(i.issue_date)}</p>
            <p>Due: {dateLabel(i.due_date)}</p>
            {i.period_from && (
              <p>
                Period: {dateLabel(i.period_from)} – {dateLabel(i.period_to)}
              </p>
            )}
          </div>
        </div>
        <div className="invoice-party">
          <p className="eyebrow">BILL TO</p>
          <h2>{i.customer?.name}</h2>
          {i.customer?.email && <p>{i.customer.email}</p>}
          {i.customer?.phone && <p>{phoneDisplay(i.customer.phone)}</p>}
        </div>
        <CustomerInvoiceLines lines={i.lines} />
        <div className="invoice-totals">
          <p>
            <span>Original invoice</span>
            <strong>{money(Number(i.base_cents))}</strong>
          </p>
          {Number(i.adjustment_cents) !== 0 && (
            <p>
              <span>Adjustments</span>
              <strong>{money(Number(i.adjustment_cents))}</strong>
            </p>
          )}
          <p>
            <span>Current total</span>
            <strong>{money(Number(i.total_cents))}</strong>
          </p>
          <p>
            <span>Payments & applied credit</span>
            <strong>{money(Number(i.paid_cents))}</strong>
          </p>
          {Number(i.refunded_cents) > 0 && (
            <p>
              <span>Refunds returned</span>
              <strong>{money(Number(i.refunded_cents))}</strong>
            </p>
          )}
          <p className="invoice-balance">
            <span>
              {i.status === "void" ? "Voided — not payable" : "Balance due"}
            </span>
            <strong>
              {i.status === "void" ? "—" : money(Number(i.balance_cents))}
            </strong>
          </p>
        </div>
        {i.notes && (
          <div className="invoice-notes">
            <h3>Invoice notes</h3>
            <p className="preserve-lines">{i.notes}</p>
          </div>
        )}
        <InvoiceCreditSummary rows={i.account_credits ?? []} />
        <InvoiceRefundSummary rows={i.refunds ?? []} />
        {!!i.adjustments.length && (
          <div className="invoice-notes">
            <h3>Adjustments</h3>
            {i.adjustments.map(
              (a: {
                id: string;
                adjustment_date: string;
                description: string;
                amount_cents: number;
              }) => (
                <p key={a.id}>
                  {dateLabel(a.adjustment_date)} · {a.description} ·{" "}
                  {money(Number(a.amount_cents))}
                </p>
              ),
            )}
          </div>
        )}
        <div className="invoice-notes">
          <h3>Payment history</h3>
          {i.payments.length ? (
            i.payments.map(
              (p: {
                id: string;
                paid_on: string;
                method: string;
                amount_cents: number;
                reversed: boolean;
              }) => (
                <p key={p.id}>
                  {dateLabel(p.paid_on)} ·{" "}
                  {paymentMethodLabels[p.method] ?? p.method} ·{" "}
                  {money(Number(p.amount_cents))}
                  {p.reversed
                    ? " · Reversed (excluded from payments received)"
                    : ""}
                </p>
              ),
            )
          ) : (
            <p>No payments recorded yet.</p>
          )}
        </div>
        {i.status !== "void" && i.business && (
          <div className="invoice-notes">
            <h3>Payment instructions</h3>
            {i.business.payment_instructions && (
              <p className="preserve-lines">
                {i.business.payment_instructions}
              </p>
            )}
            {i.business.apple_cash_instructions && (
              <p className="preserve-lines">
                Apple Cash: {i.business.apple_cash_instructions}
              </p>
            )}
            <div className="row-actions">
              {securePaymentLink(i.business.venmo_url) && (
                <a
                  className="text-link"
                  target="_blank"
                  rel="noreferrer"
                  href={securePaymentLink(i.business.venmo_url)!}
                >
                  Venmo
                </a>
              )}
              {securePaymentLink(i.business.paypal_url) && (
                <a
                  className="text-link"
                  target="_blank"
                  rel="noreferrer"
                  href={securePaymentLink(i.business.paypal_url)!}
                >
                  PayPal
                </a>
              )}
            </div>
            <p className="muted">
              Opening a payment link does not confirm payment. Your trainer
              records money received separately.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
