import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import { FeedAbsorptionForm } from "@/components/feed-absorption-form";
import { money, dateLabel } from "@/lib/format";
import type { AbsorptionReport } from "@/lib/feed-absorption";
export function FeedAbsorptionReport({
  data: r,
  from,
  to,
  horse,
  page,
}: {
  data: AbsorptionReport | null;
  from: string;
  to: string;
  horse: string;
  page: number;
}) {
  if (!r)
    return (
      <p className="notice error">
        Feed billing decisions could not load. Check the latest database
        migration.
      </p>
    );
  const url = (n: number) =>
    `/admin/feeding/absorption?${new URLSearchParams({ from, to, horse, page: String(n) })}`;
  return (
    <div className="stack">
      <div className="stats-grid business-profit-summary">
        {[
          ["Recorded feed cost", r.totals.cost_cents],
          ["Reviewed absorbed cost", r.totals.absorbed_cents],
          ["Supported at-cost remainder", r.totals.supported_unbilled_cents],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <div className="stat-top">{label}</div>
            <strong className="stat-value">{money(Number(value))}</strong>
          </div>
        ))}
      </div>
      {!!r.totals.review_count && (
        <p className="notice error">
          {r.totals.review_count} decisions need review after a source change.
          Supported totals exclude their absorbed amounts and unbilled
          remainders; new actual-cost billing is blocked for affected unbilled
          records.
        </p>
      )}
      <HelpPanel title="How do absorbed feed costs affect billing and profit?">
        <p>
          The at-cost remainder includes unreserved records under actual-cost
          agreements only. Absorb all or part of a recorded feeding you do not
          intend to charge separately at actual cost. The full consumption cost
          remains in profit and margin reports. This protects actual-cost
          invoices only; it does not reduce monthly or package charges,
          inventory quantities, payments or expenses.
        </p>
        <p>
          New actual-cost invoice lines subtract reviewed absorbed amounts and
          retain each original gross/protected/net source value. Fully absorbed
          feeding records are reserved by a zero-dollar feed line so they cannot
          be billed again. Values retain fractional cents and are summed before
          rounding the final charge. Separately displayed rounded totals can
          differ by a penny.
        </p>
        <p>
          Cost changes require review. Unbilled designations can be revised or
          cleared explicitly. Already-billed decisions permit only reconfirming
          the same fixed amount when it still fits the corrected cost; invoice
          cost-review flags must be resolved separately. If a billed amount no
          longer fits, use the existing invoice correction workflow before
          revising the designation. Historical invoices are never silently
          repriced.
        </p>
      </HelpPanel>
      <p className="muted">
        {r.count} unreversed feeding records in this period. Totals include
        every page.
      </p>
      {!r.rows.length && (
        <p className="notice">
          No feeding records match these dates and horse.
        </p>
      )}
      {r.rows.map((s) => {
        const active = s.current && s.current.mode !== "clear";
        return (
          <section className="panel" key={s.movement_id}>
            <div className="panel-heading">
              <div>
                <h2>{s.barn_name}</h2>
                <p className="muted">
                  {s.product_name} · {dateLabel(s.movement_date)} ·{" "}
                  {s.entered_quantity} {s.unit_label}
                </p>
              </div>
              <span className="tag">
                {s.needs_review
                  ? "Needs review"
                  : active
                    ? "Absorbed cost saved"
                    : "No absorbed amount"}
              </span>
            </div>
            <div className="record-form stack">
              <dl className="feed-comparison-metrics">
                <div>
                  <dt>Full feeding cost</dt>
                  <dd>{money(s.cost_cents)}</dd>
                </div>
                <div>
                  <dt>Reviewed absorbed amount</dt>
                  <dd>
                    {s.needs_review ? "Needs review" : money(s.absorbed_cents)}
                  </dd>
                </div>
              </dl>
              <p className="muted">
                {s.claimed
                  ? "Already linked to an invoice; its saved amount is unchanged."
                  : "Not reserved on an actual-cost invoice."}
              </p>
              <div className="row-actions">
                {(!s.claimed || (active && s.needs_review)) && (
                  <ActionPanel
                    id={`absorb-${s.movement_id}`}
                    label={
                      s.claimed
                        ? "Review saved amount"
                        : active
                          ? "Edit absorbed cost"
                          : "Absorb feed cost"
                    }
                  >
                    <FeedAbsorptionForm row={s} />
                  </ActionPanel>
                )}
                {active && !s.claimed && (
                  <ActionPanel
                    id={`clear-absorb-${s.movement_id}`}
                    label="Clear designation"
                  >
                    <FeedAbsorptionForm row={s} clear />
                  </ActionPanel>
                )}
                {s.claim_invoice_id && (
                  <Link
                    className="button secondary"
                    href={`/admin/invoices/${s.claim_invoice_id}`}
                  >
                    View invoice
                  </Link>
                )}
              </div>
              <details>
                <summary>Decision history</summary>
                <div className="stack feed-comparison-detail">
                  {s.history.map((h) => (
                    <div key={h.id}>
                      <p>
                        {h.mode === "clear"
                          ? "Removed protection"
                          : "Absorbed cost"}{" "}
                        · {money(h.amount_cents)}
                      </p>
                      <p className="muted">
                        {h.reason}
                        {h.retired_at ? " · Earlier version" : ""}
                      </p>
                    </div>
                  ))}
                  {!s.history.length && <p>No saved billing decisions.</p>}
                  {s.history.length === 10 && (
                    <p className="muted">
                      Latest ten versions shown; older private evidence is
                      retained.
                    </p>
                  )}
                </div>
              </details>
            </div>
          </section>
        );
      })}
      <div className="row-actions">
        {page > 1 && (
          <Link className="button secondary" href={url(page - 1)}>
            Previous
          </Link>
        )}
        {page * 25 < r.count && (
          <Link className="button secondary" href={url(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </div>
  );
}
