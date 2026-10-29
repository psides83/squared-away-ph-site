import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { AdjustmentReportingForm } from "@/components/adjustment-reporting-form";
import { money, dateLabel } from "@/lib/format";
export async function InvoiceAdjustmentReporting({
  invoice,
}: {
  invoice: string;
}) {
  const { db } = await requireAdmin();
  const result = await db
    .from("invoice_adjustments")
    .select(
      "id,invoice_id,amount_cents,adjustment_date,description,adjustment_reporting_allocations(id,training_cents,feed_cents,board_cents,other_cents,reason,retired_at)",
      { count: "exact" },
    )
    .eq("invoice_id", invoice)
    .order("created_at")
    .range(0, 99);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Internal adjustment allocations</h2>
      </div>
      <div className="record-form stack">
        {result.error ? (
          <p className="notice error" role="alert">
            Adjustment allocations could not load. Check the latest reporting
            migration.
          </p>
        ) : (
          <>
            <p className="muted">
              Assign discounts and other adjustments to reporting categories
              manually. These entries do not change customer charges or
              payments. Feed comparisons use dated feed sources; unsupported
              manual lines remain flagged.
            </p>
            {!result.data?.length && <p>No adjustments to allocate.</p>}
            {(result.data ?? []).map((a) => {
              const current = a.adjustment_reporting_allocations.find(
                (r) => !r.retired_at,
              );
              return (
                <div className="stack" key={a.id}>
                  <p>
                    {dateLabel(a.adjustment_date)} · {a.description} ·{" "}
                    {money(a.amount_cents)}
                  </p>
                  {current ? (
                    <p>
                      Training{" "}
                      {money(
                        Math.sign(a.amount_cents) * current.training_cents,
                      )}{" "}
                      · Feed{" "}
                      {money(Math.sign(a.amount_cents) * current.feed_cents)} ·
                      Board{" "}
                      {money(Math.sign(a.amount_cents) * current.board_cents)} ·
                      Other{" "}
                      {money(Math.sign(a.amount_cents) * current.other_cents)}
                    </p>
                  ) : (
                    <p className="notice">
                      Needs manual allocation before feed margins can be
                      considered complete.
                    </p>
                  )}
                  <ActionPanel
                    id={`reporting-${a.id}`}
                    label={
                      current
                        ? "Edit reporting allocation"
                        : "Allocate adjustment"
                    }
                  >
                    <AdjustmentReportingForm
                      adjustment={{
                        ...a,
                        invoice_number: 0,
                        allocation: current ?? null,
                      }}
                    />
                  </ActionPanel>
                </div>
              );
            })}
            {(result.count ?? 0) > 100 && (
              <p className="notice">
                Showing the first 100 adjustments. Further adjustments still
                require review.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
