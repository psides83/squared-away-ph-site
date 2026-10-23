"use client";
import Link from "next/link";
import { useActionState, useState, startTransition } from "react";
import { ActionPanel } from "@/components/action-panel";
import { Field, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { money, dateLabel } from "@/lib/format";
import {
  expectedRecovery,
  type ReturnExpectation,
} from "@/lib/return-expectations";
import { saveReturnExpectations } from "@/app/admin/inventory/returns/expectation-actions";
export function ReturnExpectations({
  id,
  expectation,
  cash,
  credit,
  date,
  cancelled,
}: {
  id: string;
  expectation?: ReturnExpectation | null;
  cash: number;
  credit: number;
  date: string;
  cancelled: boolean;
}) {
  return (
    <section className="stack" aria-label="Expected supplier recovery">
      <h3>Expected from supplier</h3>
      {!expectation && (
        <p className="muted">No refund or store-credit expectations set.</p>
      )}
      {expectation && (
        <>
          <div className="supplier-return-values">
            {(
              [
                [
                  "Cash refund",
                  expectation.cash_cents,
                  cash,
                  expectation.cash_due,
                ],
                [
                  "Store credit",
                  expectation.credit_cents,
                  credit,
                  expectation.credit_due,
                ],
              ] as const
            ).map(([label, target, actual, due]) => {
              const status = expectedRecovery(
                target,
                actual,
                due,
                date,
                cancelled,
              );
              return (
                <div key={label}>
                  <strong>{label}</strong>
                  <p>
                    {target === null
                      ? "Not set"
                      : `${money(target)} expected · ${money(status.remaining!)} remaining`}
                  </p>
                  {target !== null && status.remaining === 0 && (
                    <span className="tag">
                      {target === 0 ? "None expected" : "Received"}
                    </span>
                  )}
                  {status.excess > 0 && (
                    <p className="muted">
                      {money(status.excess)} above expectation
                    </p>
                  )}
                  {due && (
                    <p className={status.overdue ? "notice" : "muted"}>
                      {status.overdue ? "Overdue · " : ""}Due {dateLabel(due)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {expectation.notes && <p>{expectation.notes}</p>}
        </>
      )}
      <div className="row-actions">
        {!cancelled && (
          <ActionPanel
            id={`expectations-${id}`}
            label={expectation ? "Edit expectations" : "Set expectations"}
          >
            <div className="panel-heading">
              <h2>Expected refund & store credit</h2>
            </div>
            <ExpectationForm id={id} expectation={expectation} />
          </ActionPanel>
        )}
        {expectation && (
          <Link
            className="button secondary"
            href={`/admin/inventory/returns/${id}/expectations`}
          >
            Expectation history
          </Link>
        )}
      </div>
    </section>
  );
}
function ExpectationForm({
  id,
  expectation,
}: {
  id: string;
  expectation?: ReturnExpectation | null;
}) {
  const [snapshot] = useState(expectation);
  const [version] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(saveReturnExpectations, {});
  return (
    <form
      className="record-form"
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <Notice error={state.error} success={state.success} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input type="hidden" name="return_id" value={id} />
        <input type="hidden" name="expected" value={snapshot?.version ?? ""} />
        <input type="hidden" name="version" value={version} />
        <p>
          Record what the supplier has agreed to return. Leave an amount blank
          if unknown, or enter zero if none is expected. These targets do not
          record money received or issue store credit.
        </p>
        <div className="form-grid">
          <Field
            label="Expected cash refund ($)"
            name="cash"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={
              snapshot?.cash_cents == null
                ? ""
                : (snapshot.cash_cents / 100).toFixed(2)
            }
          />
          <Field
            label="Cash refund due"
            name="cash_due"
            type="date"
            defaultValue={snapshot?.cash_due ?? ""}
          />
          <Field
            label="Expected store credit ($)"
            name="credit"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={
              snapshot?.credit_cents == null
                ? ""
                : (snapshot.credit_cents / 100).toFixed(2)
            }
          />
          <Field
            label="Store credit due"
            name="credit_due"
            type="date"
            defaultValue={snapshot?.credit_due ?? ""}
          />
        </div>
        <Field
          name="notes"
          label="Agreement / notes"
          maxLength={2000}
          defaultValue={snapshot?.notes ?? ""}
        />
        <p className="muted">
          A due date requires a positive target. Clear an amount and its due
          date to remove that expectation. Previous versions remain in history.
        </p>
        <div className="form-actions">
          <SubmitButton>Save expectations</SubmitButton>
        </div>
      </fieldset>
    </form>
  );
}
