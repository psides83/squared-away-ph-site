import Link from "next/link";
import { Paperclip } from "lucide-react";
import { money, dateLabel } from "@/lib/format";
import { ActionPanel } from "@/components/action-panel";
import { ConfirmButton } from "@/components/confirm-button";
import { SubmitButton } from "@/components/submit-button";
import { Field } from "@/components/ui";
import { supplierReturnAction } from "@/app/admin/inventory/returns/actions";
export type SupplierReturn = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number | string;
  unit_label: string;
  returned_on: string;
  vendor: string;
  reason: string;
  stock_cost_cents: number | string;
  refunded_cents: number;
  cancelled_at: string | null;
  cancel_reason: string | null;
  refund_count: number;
  refunds: {
    id: string;
    amount_cents: number;
    paid_on: string;
    reference: string | null;
    notes: string | null;
    reversed_at: string | null;
    reverse_reason: string | null;
  }[];
};
export type SupplierReturnOverview = { rows: SupplierReturn[]; total: number };
export function SupplierReturnList({
  data,
  date,
  page,
  refundPage = 1,
}: {
  data: SupplierReturnOverview;
  date: string;
  page: number;
  refundPage?: number;
}) {
  return (
    <>
      {!data.rows.length && (
        <section className="panel">
          <p className="record-form">No supplier returns recorded.</p>
        </section>
      )}
      {data.rows.map((r) => (
        <article className="panel" id={`return-${r.id}`} key={r.id}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">
                {dateLabel(r.returned_on)} · {r.vendor}
              </p>
              <h2>{r.product_name}</h2>
            </div>
            {r.cancelled_at && <span className="tag">Entry cancelled</span>}
          </div>
          <div className="record-form">
            <div className="row-actions">
              <Link
                className="button secondary"
                href={`/admin/inventory/returns/${r.id}/documents`}
              >
                <Paperclip size={17} aria-hidden="true" />
                Documents
              </Link>
            </div>
            <p>
              {Number(r.quantity).toLocaleString("en-US", {
                maximumFractionDigits: 6,
              })}{" "}
              {r.unit_label} returned · {r.reason}
            </p>
            <div className="supplier-return-values">
              <div>
                <span className="muted">Stock value returned</span>
                <p>
                  <strong>{money(Number(r.stock_cost_cents))}</strong>
                </p>
              </div>
              <div>
                <span className="muted">Refunds received</span>
                <p>
                  <strong>{money(r.refunded_cents)}</strong>
                </p>
              </div>
              {!r.cancelled_at && r.refunded_cents > 0 && (
                <div>
                  <span className="muted">
                    Refunds minus stock value, to date
                  </span>
                  <p>
                    <strong>
                      {money(r.refunded_cents - Number(r.stock_cost_cents))}
                    </strong>
                  </p>
                </div>
              )}
            </div>
            {r.cancelled_at ? (
              <p className="notice">
                Mistaken entry cancelled; stock restored. {r.cancel_reason}
              </p>
            ) : (
              <p className="muted form-hint">
                Refunds are cash actually received, not a promised credit. Stock
                value can change after an audited cost recalculation. A partial
                refund’s difference is not a final settlement.
              </p>
            )}
            <div className="row-actions">
              <Link
                className="text-link"
                href={`/admin/inventory?product=${r.product_id}#inventory-history`}
              >
                Product stock history
              </Link>
              {!r.cancelled_at && (
                <>
                  <ActionPanel id={`refund-${r.id}`} label="Record refund">
                    <div className="panel-heading">
                      <h2>Record supplier refund</h2>
                    </div>
                    <form
                      className="record-form"
                      action={supplierReturnAction.bind(null, "refund")}
                    >
                      <input
                        type="hidden"
                        name="request_id"
                        value={crypto.randomUUID()}
                      />
                      <input type="hidden" name="return_id" value={r.id} />
                      <input type="hidden" name="page" value={page} />
                      <p>
                        {r.vendor} · {r.product_name}. Log money already
                        received. This does not collect a refund or add stock.
                      </p>
                      <div className="form-grid">
                        <Field
                          label="Refund received ($)"
                          name="amount"
                          type="number"
                          min="0.01"
                          max="1000000"
                          step="0.01"
                          required
                        />
                        <Field
                          label="Received on"
                          name="paid_on"
                          type="date"
                          min={r.returned_on}
                          max={date}
                          defaultValue={date}
                          required
                        />
                        <Field
                          label="Reference"
                          name="reference"
                          maxLength={200}
                        />
                        <Field label="Notes" name="notes" maxLength={2000} />
                      </div>
                      <div className="form-actions">
                        <SubmitButton>Save refund record</SubmitButton>
                      </div>
                    </form>
                  </ActionPanel>
                  <ActionPanel
                    id={`cancel-return-${r.id}`}
                    label="Correct mistaken return"
                  >
                    <div className="panel-heading">
                      <h2>Correct mistaken return entry</h2>
                    </div>
                    <form
                      className="record-form"
                      action={supplierReturnAction.bind(null, "cancel")}
                    >
                      <input type="hidden" name="return_id" value={r.id} />
                      <input type="hidden" name="page" value={page} />
                      <p className="notice">
                        For recording mistakes only. This restores the returned
                        quantity to stock. Incorrect refund entries must be
                        reversed first; valid refunds should not be reversed
                        just to remove a return.
                      </p>
                      <Field
                        label="Correction reason"
                        name="reason"
                        required
                        maxLength={2000}
                      />
                      <div className="form-actions">
                        <ConfirmButton message="Cancel this mistaken return entry and restore its stock? Its history will be retained.">
                          Cancel mistaken return
                        </ConfirmButton>
                      </div>
                    </form>
                  </ActionPanel>
                </>
              )}
            </div>
            <details className="supplier-refund-history">
              <summary>Refund history ({r.refund_count})</summary>
              {!r.refunds.length && <p>No cash refund recorded.</p>}
              {r.refunds.map((f) => (
                <article className="log-entry" key={f.id}>
                  <h3>
                    {money(f.amount_cents)} · {dateLabel(f.paid_on)}
                  </h3>
                  <p>
                    {f.reference}
                    {f.notes ? ` · ${f.notes}` : ""}
                  </p>
                  {f.reversed_at ? (
                    <p className="muted">Reversed entry · {f.reverse_reason}</p>
                  ) : (
                    <ActionPanel
                      id={`reverse-refund-${f.id}`}
                      label="Correct refund entry"
                    >
                      <div className="panel-heading">
                        <h2>Correct mistaken refund record</h2>
                      </div>
                      <form
                        className="record-form"
                        action={supplierReturnAction.bind(
                          null,
                          "reverse-refund",
                        )}
                      >
                        <input type="hidden" name="refund_id" value={f.id} />
                        <input type="hidden" name="return_id" value={r.id} />
                        <input
                          type="hidden"
                          name="refund_page"
                          value={refundPage}
                        />
                        <input type="hidden" name="page" value={page} />
                        <p>
                          Remove this mistaken refund from cash reporting while
                          retaining its history. This records a correction; it
                          does not send money to the supplier.
                        </p>
                        <Field
                          label="Correction reason"
                          name="reason"
                          required
                          maxLength={2000}
                        />
                        <div className="form-actions">
                          <ConfirmButton message="Reverse this mistaken refund record in cash reports? No money will be transferred.">
                            Reverse refund record
                          </ConfirmButton>
                        </div>
                      </form>
                    </ActionPanel>
                  )}
                </article>
              ))}
              {r.refund_count > 20 && (
                <p className="muted">
                  Latest 20 refund entries shown; the total includes all active
                  refunds.
                </p>
              )}
              <div className="row-actions">
                {refundPage > 1 && (
                  <Link
                    className="text-link"
                    href={`/admin/inventory/returns?return=${r.id}&refund_page=${refundPage - 1}#return-${r.id}`}
                  >
                    Newer refunds
                  </Link>
                )}
                {refundPage * 20 < r.refund_count && (
                  <Link
                    className="text-link"
                    href={`/admin/inventory/returns?return=${r.id}&refund_page=${refundPage + 1}#return-${r.id}`}
                  >
                    Older refunds
                  </Link>
                )}
              </div>
            </details>
          </div>
        </article>
      ))}
      <div className="row-actions">
        {page > 1 && (
          <Link
            className="text-link"
            href={`/admin/inventory/returns?page=${page - 1}`}
          >
            Previous returns
          </Link>
        )}
        {page * 25 < data.total && (
          <Link
            className="text-link"
            href={`/admin/inventory/returns?page=${page + 1}`}
          >
            More returns
          </Link>
        )}
      </div>
    </>
  );
}
