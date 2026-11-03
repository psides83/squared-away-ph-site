import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import { InvoiceCashSplitForm } from "@/components/invoice-cash-split-form";
import { money } from "@/lib/format";
import type { CashSplitOptions } from "@/lib/invoice-cash-splits";
export function InvoiceCashSplitContent({
  data: o,
}: {
  data: CashSplitOptions;
}) {
  if (!o.source && !o.current && !o.history.length)
    return (
      <p className="notice">
        Cash splits require a positive invoice created without a training stay.
        Invoices tied to a stay retain their automatic cash assignment.
      </p>
    );
  const a = o.current;
  return (
    <section className="panel" id="invoice-cash-split">
      <div className="panel-heading">
        <h2>Cash allocation by horse / stay</h2>
      </div>
      <div className="record-form stack">
        <HelpPanel title="How does a cash split work?">
          <p>
            Assign dollar portions of the current invoice charges to horses or
            matching training stays. Partial payments, invoice cash refunds and
            cash refunds of invoice-funded customer credit use those proportions
            on each transaction’s own date. Advance receipts and advance-credit
            refunds remain unassigned. Credit applications are not new cash.
          </p>
          <p>
            The full amount of every transaction reconciles exactly. Unallocated
            invoice portions stay Unassigned; horse-only rows remain unassigned
            to stays. Remainder pennies go to the largest fractional shares,
            with row order breaking ties. Customer bills, actual payments,
            expenses, CSV cash totals and service-date profit attribution are
            unchanged.
          </p>
          <p>
            A cash split takes priority over the single-horse reporting match
            for cash reports only. Changing charges, invoice customer or a
            selected stay’s horse/customer invalidates the split: its cash
            becomes Unassigned until reviewed or cleared. Editing or clearing
            can restate earlier reports. Invoices already tied to a training
            stay retain their automatic assignment.
          </p>
        </HelpPanel>
        {a && !a.cleared ? (
          <>
            <p className={a.valid ? "notice" : "notice error"}>
              {a.valid
                ? "Reviewed cash split is active."
                : "Cash split needs review. Payments and refunds are Unassigned until reviewed or cleared."}
            </p>
            {a.lines.map((l, n) => (
              <div key={n}>
                <strong>{l.horse_name}</strong>
                <p className="muted">
                  {l.stay_label ?? "Horse only"} · {money(l.amount_cents)}
                </p>
              </div>
            ))}
            <p className="muted">
              Reviewed invoice basis: {money(a.basis_cents)} · Unassigned
              portion:{" "}
              {money(
                a.basis_cents - a.lines.reduce((v, l) => v + l.amount_cents, 0),
              )}
            </p>
          </>
        ) : (
          <p className="muted">
            No active cash split. Cash uses the invoice’s single-horse match, or
            Unassigned when no match exists.
          </p>
        )}
        {o.options_truncated && (
          <p className="notice">
            Options show the first 1,000 horses and 2,000 matching customer
            stays. Saved history is retained; records outside these options need
            separate review.
          </p>
        )}
        <div className="row-actions">
          {o.source && (
            <ActionPanel
              id={`cash-split-${o.invoice_id}`}
              label={
                a && !a.cleared ? "Edit cash split" : "Split payments by horse"
              }
            >
              <InvoiceCashSplitForm options={o} />
            </ActionPanel>
          )}
          {a && !a.cleared && (
            <ActionPanel
              id={`clear-cash-split-${o.invoice_id}`}
              label="Clear cash split"
            >
              <InvoiceCashSplitForm options={o} clear />
            </ActionPanel>
          )}
          <Link
            className="button secondary"
            href={`/admin/attribution?invoice=${o.invoice_id}`}
          >
            Single-horse match
          </Link>
        </div>
        {!!o.history.length && (
          <details>
            <summary>Cash allocation history</summary>
            <div className="stack feed-comparison-detail">
              {o.history.map((h) => (
                <div key={h.id}>
                  <p>
                    {h.cleared ? "Cleared cash split" : "Reviewed cash split"} ·{" "}
                    {money(h.basis_cents)}
                  </p>
                  <p className="muted">
                    {h.reason}
                    {h.retired_at ? " · Earlier version" : ""}
                  </p>
                  {h.lines?.map((l, n) => (
                    <p className="muted" key={n}>
                      {l.horse_name} · {l.stay_label ?? "Horse only"} ·{" "}
                      {money(l.amount_cents)}
                    </p>
                  ))}
                </div>
              ))}
              {o.history.length === 10 && (
                <p className="muted">
                  Latest ten revisions shown; older private history is retained.
                </p>
              )}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
export async function InvoiceCashSplit({ invoice }: { invoice: string }) {
  const { db } = await requireAdmin();
  const r = await db.rpc("invoice_cash_split_options", { p_invoice: invoice });
  if (r.error || !r.data)
    return (
      <p className="notice error">
        Cash allocation could not load. Check the latest database migration.
      </p>
    );
  return <InvoiceCashSplitContent data={r.data as CashSplitOptions} />;
}
