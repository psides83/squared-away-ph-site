import Link from "next/link";
import { HelpPanel } from "@/components/help-panel";
import { money, dateLabel } from "@/lib/format";
import type { CombinedServiceReportData } from "@/components/combined-service-report";
type Figures = {
  service: string;
  gross_cents: number;
  adjustment_cents: number;
  draft_cents: number;
  cost_cents: number;
};
export type CombinedEntityReportData = {
  scope: "horse" | "stay";
  count: number;
  business: CombinedServiceReportData;
  assigned_totals: Figures[];
  unassigned: Figures[];
  rows: {
    entity_id: string;
    horse_id: string;
    stay_id: string | null;
    name: string;
    customer_name: string | null;
    arrival_date: string | null;
    departure_date: string | null;
    net_cents: number;
    cost_cents: number;
    draft_cents: number;
    feeding_lines: number;
    business_review: boolean;
    package_review: boolean;
    needs_review: boolean;
    difference_cents: number | null;
    margin_percent: number | null;
    services: Figures[];
  }[];
};
const labels: Record<string, string> = {
  feed: "Feed",
  board: "Board",
  training: "Training",
};
export function CombinedEntityReport({
  report: r,
  from,
  to,
  page,
}: {
  report: CombinedEntityReportData | null;
  from: string;
  to: string;
  page: number;
}) {
  if (!r)
    return (
      <p className="notice error" role="alert">
        Combined horse/stay results could not load. Check the latest migration
        and refresh.
      </p>
    );
  const scope = r.scope === "horse" ? "horses" : "stays";
  const pageUrl = (n: number) =>
    `/admin/reports?${new URLSearchParams({ from, to, [r.scope === "horse" ? "combined_horse_page" : "combined_stay_page"]: String(n) })}#combined-services-${scope}`;
  return (
    <div className="stack">
      <p className="notice">
        These margins use assigned recorded activity. Unassigned costs and
        revenue remain separate; they have not been treated as zero.
      </p>
      <HelpPanel title="How combined horse and stay results work">
        <p>
          Feed uses recorded feeding dates and saved weighted inventory costs.
          Board and training use reviewed horse/stay cost portions and their own
          covered dates. Revenue follows saved invoice sources and reviewed
          manual feed assignments. Horse-only feed charges and costs outside a
          stay remain outside stay totals. Ownership does not allocate revenue
          or costs.
        </p>
        <p>
          Each package portion is counted once. Drafts and reviewed other
          business costs are separate. All pages reconcile against the same
          business snapshot. Existing business review issues conservatively
          withhold every combined entity margin; missing feeding or an
          unsupported included-feed package also withholds the affected row. A
          margin from assigned records does not establish complete horse or
          business profit.
        </p>
      </HelpPanel>
      {r.business.review.needs_review && (
        <p className="notice">
          Related business records need review. Combined margins are withheld
          until resolved.{" "}
          <Link className="text-link" href="#combined-services-business">
            Review business results
          </Link>
        </p>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Unassigned amounts & reconciliation</h2>
        </div>
        <div className="record-form stack">
          {r.unassigned.some(
            (s) =>
              s.gross_cents !== 0 ||
              s.adjustment_cents !== 0 ||
              s.cost_cents !== 0 ||
              s.draft_cents !== 0,
          ) ? (
            r.unassigned
              .filter(
                (s) =>
                  s.gross_cents !== 0 ||
                  s.adjustment_cents !== 0 ||
                  s.cost_cents !== 0 ||
                  s.draft_cents !== 0,
              )
              .map((s) => (
                <div key={s.service}>
                  <h3>{labels[s.service] ?? s.service}</h3>
                  <p>
                    Net revenue {money(s.gross_cents + s.adjustment_cents)} ·
                    costs {money(s.cost_cents)} · drafts {money(s.draft_cents)}
                  </p>
                </div>
              ))
          ) : (
            <p>
              No unassigned service revenue, costs or drafts for this scope and
              period.
            </p>
          )}
          <details>
            <summary>Reconcile all pages with business totals</summary>
            <div className="stack feed-comparison-detail">
              {r.business.services.map((b) => {
                const a = r.assigned_totals.find(
                    (x) => x.service === b.service,
                  ),
                  u = r.unassigned.find((x) => x.service === b.service);
                return (
                  <div key={b.service}>
                    <h3>{labels[b.service] ?? b.service}</h3>
                    <p className="muted">
                      Assigned net revenue{" "}
                      {money(
                        (a?.gross_cents ?? 0) + (a?.adjustment_cents ?? 0),
                      )}{" "}
                      + unassigned{" "}
                      {money(
                        (u?.gross_cents ?? 0) + (u?.adjustment_cents ?? 0),
                      )}{" "}
                      = business {money(b.gross_cents + b.adjustment_cents)}.
                    </p>
                    <p className="muted">
                      Assigned costs {money(a?.cost_cents ?? 0)} + unassigned{" "}
                      {money(u?.cost_cents ?? 0)} = business{" "}
                      {money(b.cost_cents)}.
                    </p>
                    <p className="muted">
                      Drafts: assigned {money(a?.draft_cents ?? 0)} + unassigned{" "}
                      {money(u?.draft_cents ?? 0)} = business{" "}
                      {money(b.draft_cents)}.
                    </p>
                  </div>
                );
              })}
              <p className="muted">
                Totals include every matching{" "}
                {r.scope === "horse" ? "horse" : "stay"}, across all pages.
                Reviewed other business costs of{" "}
                {money(r.business.other_cost_cents)} remain outside these
                service totals.
              </p>
            </div>
          </details>
        </div>
      </section>
      {!r.rows.length && (
        <p className="notice">
          No matching activity or training stays for this page and period.
        </p>
      )}
      {r.rows.map((e) => (
        <section className="panel" key={e.entity_id}>
          <div className="panel-heading">
            <div>
              <h2>{e.name}</h2>
              {e.stay_id && (
                <p className="muted form-hint">
                  {e.customer_name} · {dateLabel(e.arrival_date!)} –{" "}
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
            {e.needs_review && (
              <p className="notice">
                {e.business_review
                  ? "Resolve related business review items before comparing this margin."
                  : e.package_review
                    ? "Included feed needs a supported package split for these dates."
                    : "No feeding recorded for these dates. Record actual feeding before judging the combined margin."}
              </p>
            )}
            <dl className="feed-comparison-metrics">
              {[
                ["Net service revenue", money(e.net_cents)],
                ["Assigned costs", money(e.cost_cents)],
                [
                  "Assigned difference",
                  e.difference_cents === null
                    ? "Needs review"
                    : money(e.difference_cents),
                ],
                [
                  "Assigned margin",
                  e.margin_percent === null
                    ? "—"
                    : `${Number(e.margin_percent).toFixed(1)}%`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              Draft service revenue: {money(e.draft_cents)}
            </p>
            <details>
              <summary>Feed, board & training detail</summary>
              <div className="stack feed-comparison-detail">
                {e.services.map((s) => (
                  <div key={s.service}>
                    <h3>{labels[s.service] ?? s.service}</h3>
                    <p>
                      Net revenue {money(s.gross_cents + s.adjustment_cents)} ·
                      assigned costs {money(s.cost_cents)}
                    </p>
                    <p className="muted">
                      Gross revenue {money(s.gross_cents)} · adjustments{" "}
                      {money(s.adjustment_cents)} · drafts{" "}
                      {money(s.draft_cents)}
                    </p>
                  </div>
                ))}
              </div>
            </details>
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
          in the period or with recorded activity
        </span>
      </div>
    </div>
  );
}
