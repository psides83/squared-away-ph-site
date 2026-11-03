import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { HelpPanel } from "@/components/help-panel";
import { ActionPanel } from "@/components/action-panel";
import { ActualCostRecoveryForm } from "@/components/actual-cost-recovery-form";
import { money, dateLabel } from "@/lib/format";
import type { RecoveryOptions } from "@/lib/actual-cost-recovery";
export function ActualCostRecoveryContent({
  invoice,
  page,
  data,
}: {
  invoice: string;
  page: number;
  data: RecoveryOptions;
}) {
  if (!data.count && !data.history.length) return null;
  const url = (n: number) =>
    `/admin/invoices/${invoice}?actual_recovery_page=${n}#actual-source-recovery`;
  return (
    <section className="panel" id="actual-source-recovery">
      <div className="panel-heading">
        <h2>Restore actual-cost source links</h2>
      </div>
      <div className="record-form stack">
        <HelpPanel title="When should I restore original links?">
          <p>
            Use this for an older generated actual-cost charge that retains
            original feeding or expense identifiers but has no billing-source
            links. Only those original records can be restored; dates alone are
            not evidence of an actual-cost charge.
          </p>
          <p>
            Feedings must match the invoice horse and original period and be
            unreversed. Boarding must match the current original expense/stay
            assignment. Costs must reconcile to the saved charge, rounded once
            to cents. Missing records, changed amounts, absorbed costs and
            conflicts with other bills block recovery. No current agreement rate
            is substituted.
          </p>
          <p>
            Restoring links enables existing service-date reporting and
            duplicate-billing protection. Feed revenue uses matched saved
            consumption values/dates; board revenue uses the original saved
            covered period. No stock, invoice money or payments change. Undoing
            a mistaken recovery uses the existing draft removal or eligible
            invoice-void workflow, not an unprotected unlink button.
          </p>
        </HelpPanel>
        {data.lines.map((l) => (
          <article className="stack separated" key={l.id}>
            <h3>{l.description}</h3>
            <dl className="feed-comparison-metrics">
              <div>
                <dt>Saved {l.service === "feed" ? "feed" : "board"} charge</dt>
                <dd>{money(l.amount_cents)}</dd>
              </div>
              <div>
                <dt>Matched source cost</dt>
                <dd>
                  {l.source_cost_cents === null
                    ? "Unavailable"
                    : money(l.source_cost_cents)}
                </dd>
              </div>
            </dl>
            {l.ready ? (
              <p className="notice">
                Original records match. Review the source evidence before
                restoring links.
              </p>
            ) : (
              <p className="notice error">{l.reason}</p>
            )}
            <details>
              <summary>
                Original source evidence · {l.sources.length} records
              </summary>
              <div className="stack feed-comparison-detail">
                <p className="muted">
                  Feed source values can contain fractions of a cent. The
                  matched total is rounded once; individually displayed amounts
                  may not add to that rounded total.
                </p>
                {l.sources.slice(0, 25).map((s, n) => (
                  <div key={s.movement_id ?? s.split_id ?? n}>
                    <p>
                      {s.date && dateLabel(s.date)} ·{" "}
                      {s.label || "Original source"} · {money(s.cost_cents)}
                    </p>
                    {s.expense_id && (
                      <Link
                        className="button secondary"
                        href={`/admin/expenses/${s.expense_id}`}
                      >
                        View expense
                      </Link>
                    )}
                  </div>
                ))}
                {l.sources.length > 25 && (
                  <p className="muted">
                    First 25 original records shown. The total and recovery
                    include all {l.sources.length} records.
                  </p>
                )}
                {!l.sources.length && (
                  <p>No matching original records available.</p>
                )}
              </div>
            </details>
            {l.ready && (
              <div className="row-actions">
                <ActionPanel
                  id={`recover-${l.id}`}
                  label="Review & restore original links"
                >
                  <ActualCostRecoveryForm line={l} />
                </ActionPanel>
              </div>
            )}
          </article>
        ))}
        {!!data.history.length && (
          <details>
            <summary>Source recovery history</summary>
            <div className="stack feed-comparison-detail">
              {data.history.map((h) => (
                <div key={h.id}>
                  <p>
                    Original links restored ·{" "}
                    {dateLabel(h.created_at.slice(0, 10))}
                  </p>
                  <p className="muted">{h.reason}</p>
                </div>
              ))}
              {data.history.length === 10 && (
                <p className="muted">
                  Latest ten recoveries shown; older private evidence is
                  retained.
                </p>
              )}
            </div>
          </details>
        )}
        <div className="row-actions">
          {page > 1 && (
            <Link className="button secondary" href={url(page - 1)}>
              Previous
            </Link>
          )}
          {page * 25 < data.count && (
            <Link className="button secondary" href={url(page + 1)}>
              Next
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
export async function ActualCostRecovery({
  invoice,
  page,
}: {
  invoice: string;
  page: number;
}) {
  const { db } = await requireAdmin();
  const r = await db.rpc("actual_cost_recovery_options", {
    p_invoice: invoice,
    p_page: page,
  });
  if (r.error || !r.data)
    return (
      <p className="notice error">
        Original source recovery could not load. Check the latest database
        migration.
      </p>
    );
  return (
    <ActualCostRecoveryContent
      invoice={invoice}
      page={page}
      data={r.data as RecoveryOptions}
    />
  );
}
