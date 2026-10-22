import Link from "next/link";
import { money } from "@/lib/format";
export type InventoryUsage = {
  totals: {
    feed_cents: number;
    waste_cents: number;
    adjustment_cents: number;
    correction_cents: number;
  };
  products: {
    id: string;
    name: string;
    category: string;
    feed_oz: number;
    feed_cents: number;
    waste_oz: number;
    waste_cents: number;
    adjustment_cents: number;
    correction_cents: number;
  }[];
  horses: {
    horse_id: string | null;
    name: string;
    feed_cents: number;
    feeding_lines: number;
    corrected_lines: number;
  }[];
};
function weight(ounces: number) {
  const n = Number(ounces);
  const pounds = Math.abs(n) >= 16;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(pounds ? n / 16 : n)} ${pounds ? "lb" : "oz"}`;
}
export function InventoryUsageReport({
  report,
}: {
  report: InventoryUsage | null;
}) {
  if (!report)
    return (
      <p className="notice error">
        Feed usage could not load. Check the latest database migration and
        refresh.
      </p>
    );
  return (
    <div className="stack">
      <p className="notice">
        These are saved inventory costs for feed, hay, and supplements actually
        used. They are separate from cash profit, which already includes paid
        feed purchases. Usage and corrections follow their ledger dates. A
        correction can make a period’s net usage negative.
      </p>
      <div className="stats-grid">
        {[
          ["Feed used", report.totals.feed_cents],
          ["Waste", report.totals.waste_cents],
          ["Other stock reductions", report.totals.adjustment_cents],
          ["Corrections credited", report.totals.correction_cents],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <div className="stat-top">{label}</div>
            <strong className="stat-value">{money(Number(value))}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Feed cost by horse</h2>
        </div>
        {report.horses.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Horse</th>
                  <th>Net feed cost</th>
                  <th>Feed lines / corrections</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {report.horses.map((h) => (
                  <tr key={h.horse_id ?? "unassigned"}>
                    <td>
                      {h.horse_id ? (
                        <Link
                          className="text-link"
                          href={`/admin/horses/${h.horse_id}`}
                        >
                          {h.name}
                        </Link>
                      ) : (
                        h.name
                      )}
                    </td>
                    <td>{money(h.feed_cents)}</td>
                    <td>
                      {h.feeding_lines} / {h.corrected_lines}
                    </td>
                    <td>
                      {h.horse_id && (
                        <Link
                          className="text-link"
                          href={`/admin/horses/${h.horse_id}#horse-rations`}
                        >
                          Feeding plan
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="record-form muted">
            No feeding or feeding corrections recorded for these dates.
          </p>
        )}
        <p className="record-form muted">
          Costs use the weighted value saved when feed was recorded. Later
          purchases do not reprice past feeding. Counts represent product lines,
          not meals or days.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Usage by product</h2>
        </div>
        {report.products.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Fed / cost</th>
                  <th>Waste / cost</th>
                  <th>Other reductions</th>
                  <th>Corrections credited</th>
                </tr>
              </thead>
              <tbody>
                {report.products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        className="text-link"
                        href={`/admin/inventory?product=${p.id}#inventory-history`}
                      >
                        {p.name}
                      </Link>
                      <small className="cell-secondary">{p.category}</small>
                    </td>
                    <td>
                      {weight(p.feed_oz)}
                      <small className="cell-secondary">
                        {money(p.feed_cents)}
                      </small>
                    </td>
                    <td>
                      {weight(p.waste_oz)}
                      <small className="cell-secondary">
                        {money(p.waste_cents)}
                      </small>
                    </td>
                    <td>{money(p.adjustment_cents)}</td>
                    <td>{money(p.correction_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="record-form muted">
            No inventory usage recorded for these dates.
          </p>
        )}
        <p className="record-form muted">
          All quantities are weight, shown in lb or oz. Fed, waste, and other
          reduction totals already include their corrections; the credited
          column is a reference, not another deduction.
        </p>
      </section>
    </div>
  );
}
