import { requireAdmin } from "@/lib/auth";
import { ServiceCostForm } from "@/components/service-cost-form";
import { ActionPanel } from "@/components/action-panel";
import { money, dateLabel } from "@/lib/format";
import type { ServiceCost } from "@/lib/service-profitability";
export async function ExpenseServiceCosts({ expense }: { expense: string }) {
  const { db } = await requireAdmin();
  const [source, history] = await Promise.all([
    db
      .from("service_cost_sources")
      .select("*")
      .eq("expense_id", expense)
      .maybeSingle(),
    db
      .from("service_cost_allocations")
      .select("*", { count: "exact" })
      .eq("expense_id", expense)
      .order("created_at", { ascending: false })
      .order("id")
      .limit(25),
  ]);
  const currentResult = await db
    .from("service_cost_allocations")
    .select("*")
    .eq("expense_id", expense)
    .is("retired_at", null)
    .maybeSingle();
  if (source.error || history.error || currentResult.error)
    return (
      <p className="notice error">
        Service cost splits could not load. Check the latest reporting
        migration.
      </p>
    );
  const current = currentResult.data as ServiceCost | undefined;
  const eligible = Number(source.data?.eligible_cents ?? 0);
  const active = current && !current.cleared;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Board & training cost split</h2>
      </div>
      <div className="record-form stack">
        <p className="muted">
          Review business service totals here. Use the horse/stay assignments
          below for service margins. Existing cash-cost splits, customer charges
          and cash reports remain separate.
        </p>
        {eligible > 0 ? (
          <>
            <p>
              Eligible non-inventory cost: <strong>{money(eligible)}</strong>
            </p>
            {active ? (
              <>
                <p>
                  Training {money(current.training_cents)} · Board{" "}
                  {money(current.board_cents)} · Other{" "}
                  {money(current.other_cents)}
                </p>
                <p>
                  {dateLabel(current.covered_from)} –{" "}
                  {dateLabel(current.covered_to)}
                </p>
                {current.source_cents !== eligible && (
                  <p className="notice">
                    The source amount changed. This split is excluded from
                    margins until reviewed again.
                  </p>
                )}
              </>
            ) : (
              <p className="notice">
                This cost needs a service split before margins can be considered
                complete.
              </p>
            )}
            <ActionPanel
              id="service-cost-split"
              label={
                active ? "Edit service cost split" : "Allocate service cost"
              }
            >
              <ServiceCostForm
                expense={expense}
                eligible={eligible}
                date={source.data!.expense_date}
                current={current}
              />
            </ActionPanel>
          </>
        ) : (
          <p className="muted">
            No eligible non-inventory cost. Voided expenses and feed inventory
            purchases are excluded; mixed receipts include only expense-only
            items.
          </p>
        )}
        {active && (
          <ActionPanel id="clear-service-cost" label="Clear service cost split">
            <ServiceCostForm
              expense={expense}
              eligible={eligible}
              date={current.covered_from}
              current={current}
              clear
            />
          </ActionPanel>
        )}
        <details>
          <summary>Allocation history</summary>
          <div className="stack">
            {(history.data ?? []).map((a) => (
              <div key={a.id}>
                <p>
                  {a.cleared
                    ? "Cleared split"
                    : `Training ${money(a.training_cents)} · Board ${money(a.board_cents)} · Other ${money(a.other_cents)}`}
                </p>
                <p className="muted">
                  {dateLabel(a.covered_from)} – {dateLabel(a.covered_to)} ·{" "}
                  {a.reason}
                  {a.retired_at ? " · Earlier version" : ""}
                </p>
              </div>
            ))}
            {!history.data?.length && <p>No saved splits.</p>}
            {(history.count ?? 0) > 25 && (
              <p className="muted">
                Showing the latest 25 versions; earlier history is retained.
              </p>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
