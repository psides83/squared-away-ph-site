"use client";
import { useState, useActionState, startTransition } from "react";
import { saveServiceCost } from "@/app/admin/expenses/service-cost-actions";
import { Field, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { TemporalInput } from "@/components/temporal-input";
import { money } from "@/lib/format";
import type { ServiceCost } from "@/lib/service-profitability";
export function ServiceCostForm({
  expense,
  eligible,
  date,
  current,
  clear = false,
}: {
  expense: string;
  eligible: number;
  date: string;
  current?: ServiceCost;
  clear?: boolean;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [revision] = useState(current?.id ?? "");
  const [state, action, pending] = useActionState(saveServiceCost, {});
  return (
    <form
      className="record-form"
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(() => action(f));
      }}
    >
      <Notice {...state} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input name="request_id" type="hidden" value={request} />
        <input name="expense_id" type="hidden" value={expense} />
        <input name="current" type="hidden" value={revision} />
        <input name="clear" type="hidden" value={clear ? "yes" : "no"} />
        {clear ? (
          <>
            <p>
              Clear this reporting split? The cost will need review again.
              Earlier versions remain in history.
            </p>
            <input
              name="from"
              type="hidden"
              value={current?.covered_from ?? date}
            />
            <input
              name="to"
              type="hidden"
              value={current?.covered_to ?? date}
            />
          </>
        ) : (
          <>
            <p>
              Assign the full {money(eligible)} eligible cost. Enter each
              portion manually, including zero where appropriate.
            </p>
            <div className="form-grid">
              {(["training", "board", "other"] as const).map((key) => (
                <Field
                  key={key}
                  name={key}
                  label={`${key === "board" ? "Board" : key === "training" ? "Training" : "Other"} cost ($)`}
                  type="number"
                  min="0"
                  max={eligible / 100}
                  step="0.01"
                  required
                  defaultValue={
                    current && !current.cleared
                      ? (current[`${key}_cents`] / 100).toFixed(2)
                      : undefined
                  }
                />
              ))}
            </div>
            <div className="form-grid">
              <label>
                Covered from
                <TemporalInput
                  type="date"
                  name="from"
                  required
                  defaultValue={current?.covered_from ?? date}
                />
              </label>
              <label>
                Covered through
                <TemporalInput
                  type="date"
                  name="to"
                  required
                  defaultValue={current?.covered_to ?? date}
                />
              </label>
            </div>
            <p className="muted form-hint">
              This is the overall covered period. Unassigned portions spread
              evenly across it; horse/stay portions follow their own reviewed
              dates. Remaining pennies go to each portion’s earliest days. Both
              paid and unpaid costs are included; payment dates do not shift
              this report. Any existing horse/stay assignments need review after
              revising this business split.
            </p>
          </>
        )}
        <Field name="reason" label="Private reason" required maxLength={2000} />
        <div className="form-actions">
          <ConfirmButton
            message={
              clear
                ? "Clear this internal cost split while retaining its history?"
                : "Save this full cost split and covered dates for internal reporting? This will not change bills, cash or payments."
            }
          >
            {pending ? "Saving…" : clear ? "Clear split" : "Save cost split"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
