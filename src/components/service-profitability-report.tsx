import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import type { ServiceProfitability } from "@/lib/service-profitability";
export function ServiceProfitabilityReport({
  report: r,
}: {
  report: ServiceProfitability | null;
}) {
  if (!r)
    return (
      <p className="notice error" role="alert">
        Service margins could not load. Check the latest migration.
      </p>
    );
  const blocked =
    r.unallocated_cost_count +
      r.unsupported_revenue_count +
      r.unresolved_adjustment_count +
      (r.invalid_assignment_count ?? 0) >
    0;
  return (
    <div className="stack">
      <HelpPanel title="How service margins are calculated">
        <p>
          Finalized generated training/package amounts follow saved billable
          days and calendar-month weights. Separate monthly board follows saved
          boarding days. Actual-cost board follows the saved invoice claim’s
          inclusive covered period, spread evenly. Drafts are separate. Manual
          revenue without dated sources and missing package splits require
          review.
        </p>
        <p>
          Reviewed costs include both paid and unpaid non-voided expenses and
          follow the covered dates you entered. Assigned horse/stay portions
          follow their own selected dates; their unassigned remainder keeps the
          overall expense dates. Changing assignments can restate service-cost
          timing without changing full expense totals or cash. Every category
          portion reconciles exactly, with remaining pennies assigned to the
          earliest days. Inventory purchases are excluded; mixed receipts
          contribute only expense-only items. Feed consumption is reported
          separately in Feed cost vs charges. Other costs remain visible outside
          these service margins.
        </p>
        <p>
          Manually allocated adjustments restate original service dates,
          weighted by that invoice’s gross dated revenue for each service;
          zero-valued sources use equal dated shares. Payments/refunds are not
          counted again as revenue adjustments. These are business-wide margins
          from assigned recorded activity, not net cash profit or proof that all
          costs have been entered. Horse/stay service assignments use the same
          dated costs; existing cash-cost splits remain separate.
        </p>
      </HelpPanel>
      {blocked && (
        <p className="notice">
          Review {r.unallocated_cost_count} unallocated or changed costs,{" "}
          {r.unsupported_revenue_count} unsupported revenue lines and{" "}
          {r.unresolved_adjustment_count} unresolved adjustments and{" "}
          {r.invalid_assignment_count ?? 0} changed horse/stay assignment
          reviews. Margins are withheld until these records are reviewed.
        </p>
      )}
      {(r.invalid_assignment_count ?? 0) > 0 && (
        <p className="notice">
          Excluded assignment costs have returned to the unassigned business
          period. Review or clear those assignments before treating the margins
          as complete.
        </p>
      )}
      {(r.assignment_review ?? []).map((x) => (
        <div key={x.expense_id}>
          <p>
            {x.vendor ?? "Expense"}
            {x.expense_date ? ` · ${dateLabel(x.expense_date)}` : ""}
          </p>
          <Link
            className="button secondary"
            href={`/admin/expenses/${x.expense_id}#expense-service-costs`}
          >
            Review assignments
          </Link>
        </div>
      ))}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-top">
            Costs needing review (full source amounts)
          </div>
          <strong>{money(r.unallocated_cost_cents)}</strong>
        </div>
        <div className="stat-card">
          <div className="stat-top">Other allocated costs</div>
          <strong>{money(r.other_cost_cents)}</strong>
        </div>
      </div>
      {r.services.map((s) => {
        const net = s.gross_cents + s.adjustment_cents;
        return (
          <section className="panel" key={s.service}>
            <div className="panel-heading">
              <h2>{s.service === "board" ? "Board" : "Training"} margins</h2>
            </div>
            <div className="record-form stack">
              <dl className="feed-comparison-metrics">
                {[
                  ["Gross invoiced", money(s.gross_cents)],
                  ["Manual adjustments", money(s.adjustment_cents)],
                  ["Net service revenue", money(net)],
                  ["Assigned recorded costs", money(s.cost_cents)],
                  [
                    "Recorded difference",
                    blocked ? "Needs review" : money(net - s.cost_cents),
                  ],
                  [
                    "Service margin",
                    !blocked && net > 0
                      ? `${(((net - s.cost_cents) * 100) / net).toFixed(1)}%`
                      : "—",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <span className="tag">Draft revenue: {money(s.draft_cents)}</span>
            </div>
          </section>
        );
      })}
      <section className="panel">
        <div className="panel-heading">
          <h2>Records needing review</h2>
        </div>
        <div className="record-form stack">
          {r.cost_review.map((c) => (
            <Link
              className="text-link"
              key={c.expense_id}
              href={`/admin/expenses/${c.expense_id}#expense-service-costs`}
            >
              {c.vendor ?? "Expense"} · {money(c.eligible_cents)} · Allocate
              cost
            </Link>
          ))}
          {r.revenue_review.map((l) => (
            <Link
              className="text-link"
              key={l.id}
              href={`/admin/invoices/${l.invoice_id}`}
            >
              Invoice #{l.invoice_number ?? "draft"} · {l.description}
            </Link>
          ))}
          {r.adjustment_review.map((a) => (
            <Link
              className="text-link"
              key={a.id}
              href={`/admin/invoices/${a.invoice_id}#invoice-corrections`}
            >
              Invoice #{a.invoice_number} · Allocate adjustment
            </Link>
          ))}
          {!blocked && (
            <p>
              No unresolved records for these dates. Missing activity cannot be
              detected automatically.
            </p>
          )}
          {(r.unallocated_cost_count > 25 ||
            r.unsupported_revenue_count > 25 ||
            r.unresolved_adjustment_count + (r.invalid_assignment_count ?? 0) >
              25) && (
            <p className="muted">
              Showing the first 25 records per review type; totals include all
              records.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
