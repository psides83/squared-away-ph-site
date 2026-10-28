import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { ExpenseAbsorptionForm } from "@/components/expense-absorption-form";
import { money } from "@/lib/format";
import type { ExpenseAbsorption } from "@/lib/expense-absorption";
export async function ExpenseAbsorbedCosts({
  expense,
  cost,
  reserved,
  stock,
  voided,
}: {
  expense: string;
  cost: number;
  reserved: number | null;
  stock: boolean;
  voided: boolean;
}) {
  const { db } = await requireAdmin();
  const [currentResult, history] = await Promise.all([
    db
      .from("expense_absorptions")
      .select("id,amount_cents,reason,created_at,retired_at")
      .eq("expense_id", expense)
      .is("retired_at", null)
      .maybeSingle(),
    db
      .from("expense_absorptions")
      .select("id,amount_cents,reason,created_at,retired_at", {
        count: "exact",
      })
      .eq("expense_id", expense)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(25),
  ]);
  if (currentResult.error || history.error || reserved === null)
    return (
      <p className="notice error">
        Absorbed costs could not load. Check the latest migration before making
        changes.
      </p>
    );
  const current = currentResult.data as ExpenseAbsorption | undefined;
  const amount = current?.amount_cents ?? 0;
  const available = Math.max(0, cost - reserved);
  return (
    <div className="stack">
      <h3>Cost covered by the business</h3>
      <p>
        <strong>{money(amount)} absorbed</strong> ·{" "}
        {money(Math.max(0, available - amount))} not reserved or designated
      </p>
      <p className="muted">
        Absorbed amounts stay separate from costs still awaiting a billing
        decision. Existing invoices are unchanged.
      </p>
      <div className="row-actions">
        {!stock && !voided && available > 0 && (
          <ActionPanel
            id="absorb-cost"
            label={amount ? "Change absorbed cost" : "Absorb a cost"}
          >
            <ExpenseAbsorptionForm
              expense={expense}
              available={available}
              current={current}
            />
          </ActionPanel>
        )}
        {amount > 0 && (
          <ActionPanel id="remove-absorbed-cost" label="Remove designation">
            <ExpenseAbsorptionForm
              expense={expense}
              available={available}
              current={current}
              remove
            />
          </ActionPanel>
        )}
      </div>
      {stock && (
        <p className="muted">
          Feed purchases are billed through consumption, so this expense
          designation is unavailable for stock purchases.
        </p>
      )}
      {Boolean(history.data?.length) && (
        <details>
          <summary>
            Absorbed-cost history ({history.count ?? history.data?.length})
          </summary>
          <div className="stack feed-comparison-detail">
            {(history.count ?? 0) > 25 && (
              <p className="muted">
                Showing the latest 25 decisions. Earlier history remains
                retained.
              </p>
            )}
            {history.data?.map((h) => (
              <article key={h.id} className="customer-invoice-row">
                <strong>
                  {h.amount_cents
                    ? `${money(h.amount_cents)} absorbed`
                    : "Designation removed"}
                </strong>
                <p className="muted">
                  {new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "America/Chicago",
                  }).format(new Date(h.created_at))}{" "}
                  · {h.retired_at ? "Previous decision" : "Current decision"}
                </p>
                <p className="log-notes">{h.reason}</p>
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
