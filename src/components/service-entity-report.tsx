import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import type { EntityMargins, ServiceFigures } from "@/lib/service-assignments";
const zero = (service: string): ServiceFigures => ({
  service,
  gross_cents: 0,
  draft_cents: 0,
  adjustment_cents: 0,
  cost_cents: 0,
});
export function ServiceEntityReport({
  report: r,
  from,
  to,
  page,
}: {
  report: EntityMargins | null;
  from: string;
  to: string;
  page: number;
}) {
  if (!r)
    return (
      <p className="notice error" role="alert">
        Horse/stay service margins could not load. Check the latest migration.
      </p>
    );
  const blocked =
    r.unallocated_cost_count +
      r.unsupported_revenue_count +
      r.unresolved_adjustment_count +
      r.invalid_assignment_count >
    0;
  const scope = r.scope === "horse" ? "horses" : "stays";
  const pageUrl = (n: number) => {
    const p = new URLSearchParams({
      from,
      to,
      [r.scope === "horse" ? "horse_service_page" : "stay_service_page"]:
        String(n),
    });
    return `/admin/reports?${p}#service-margins-${scope}`;
  };
  return (
    <div className="stack">
      <p className="notice">
        These are margins from explicitly assigned costs. Unassigned business
        costs{r.scope === "stay" ? " and horse-only costs" : ""} remain
        separate; they have not been treated as zero.
      </p>
      <HelpPanel title="How these margins reconcile">
        <p>
          Revenue uses the invoice’s saved training stay and horse. Reviewed
          invoice adjustments follow the same original service dates as the
          business report. Cost portions use their deliberately selected
          horse/stay and covered dates; other cost categories remain at business
          level. No ownership percentages or existing cash-cost splits are
          applied automatically.
        </p>
        <p>
          Every assigned portion and remaining business portion uses the same
          dated entries in all service reports. Assigning new covered dates can
          restate earlier service-cost timing, while full expense totals,
          customer bills, payments and cash reports stay unchanged. A changed
          source split or excluded stay date requires a fresh review. These
          figures do not establish complete business profit or prove all records
          were entered.
        </p>
      </HelpPanel>
      {blocked && (
        <p className="notice">
          Margins are withheld: {r.unallocated_cost_count} business costs,{" "}
          {r.unsupported_revenue_count} revenue lines,{" "}
          {r.unresolved_adjustment_count} adjustments and{" "}
          {r.invalid_assignment_count} horse/stay assignment reviews need
          attention.{" "}
          <Link className="text-link" href="#service-margins-business">
            Review business records
          </Link>
        </p>
      )}
      {r.assignment_review.map((x) => (
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
      <section className="panel">
        <div className="panel-heading">
          <h2>Unassigned costs & reconciliation</h2>
        </div>
        <div className="record-form stack">
          {["training", "board"].map((service) => {
            const u =
                r.unassigned.find((x) => x.service === service) ??
                zero(service),
              a =
                r.assigned_totals.find((x) => x.service === service) ??
                zero(service),
              b =
                r.business_services.find((x) => x.service === service) ??
                zero(service);
            return (
              <div key={service}>
                <h3>{service === "board" ? "Board" : "Training"}</h3>
                <p>
                  Unassigned cost: <strong>{money(u.cost_cents)}</strong>
                </p>
                <p className="muted">
                  Assigned differences{" "}
                  {money(a.gross_cents + a.adjustment_cents - a.cost_cents)} +
                  unassigned net revenue{" "}
                  {money(u.gross_cents + u.adjustment_cents)} − unassigned cost{" "}
                  {money(u.cost_cents)} = business service difference{" "}
                  {money(b.gross_cents + b.adjustment_cents - b.cost_cents)}.
                </p>
              </div>
            );
          })}
        </div>
      </section>
      {!r.rows.length && (
        <p className="notice">
          No attributed service activity for this page and date range.
        </p>
      )}
      {r.rows.map((e) => (
        <section className="panel" key={e.entity_id}>
          <div className="panel-heading">
            <div>
              <h2>{e.name}</h2>
              {e.stay_id && (
                <p className="muted form-hint">
                  {dateLabel(e.arrival_date!)} –{" "}
                  {e.departure_date ? dateLabel(e.departure_date) : "Open stay"}
                </p>
              )}
            </div>
            <Link
              className="button secondary"
              href={
                e.stay_id
                  ? `/admin/training/${e.stay_id}`
                  : `/admin/horses/${e.horse_id}`
              }
            >
              {e.stay_id ? "Training stay" : "Horse record"}
            </Link>
          </div>
          <div className="record-form stack">
            {e.services.map((s) => {
              const net = s.gross_cents + s.adjustment_cents;
              return (
                <div className="stack" key={s.service}>
                  <h3>{s.service === "board" ? "Board" : "Training"}</h3>
                  <dl className="feed-comparison-metrics">
                    {[
                      ["Net service revenue", money(net)],
                      ["Assigned costs", money(s.cost_cents)],
                      [
                        "Assigned difference",
                        blocked ? "Needs review" : money(net - s.cost_cents),
                      ],
                      [
                        "Assigned margin",
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
                  <div className="row-actions">
                    <span className="tag">
                      Draft revenue: {money(s.draft_cents)}
                    </span>
                    {s.cost_cents === 0 && net > 0 && (
                      <span className="tag">
                        No costs assigned to this service
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div className="row-actions">
        {page > 1 && (
          <Link className="button secondary" href={pageUrl(page - 1)}>
            Previous
          </Link>
        )}
        {page * 25 < r.count && (
          <Link className="button secondary" href={pageUrl(page + 1)}>
            Next
          </Link>
        )}
        <span className="muted">
          {r.count}{" "}
          {r.scope === "horse"
            ? r.count === 1
              ? "horse"
              : "horses"
            : r.count === 1
              ? "stay"
              : "stays"}{" "}
          with recorded activity
        </span>
      </div>
    </div>
  );
}
