"use client";
import { useActionState, useState, startTransition } from "react";
import { saveMonthlyServicePeriod } from "@/app/admin/invoices/monthly-service-actions";
import { Field, Notice } from "@/components/ui";
import { TemporalInput } from "@/components/temporal-input";
import { ConfirmButton } from "@/components/confirm-button";
import { money } from "@/lib/format";
import type { MonthlyServiceLine } from "@/lib/monthly-service-periods";
export function MonthlyServicePeriodForm({
  line,
  clear = false,
}: {
  line: MonthlyServiceLine;
  clear?: boolean;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [context] = useState(() => ({
    current: line.current?.id ?? "",
    token: clear ? line.current!.source_token : line.source_token,
    horse: clear ? line.current?.horse_id : line.horse_id,
    stay: clear ? line.current?.stay_id : line.stay_id,
    amount: clear ? line.current?.amount_cents : line.amount_cents,
    from: line.current?.covered_from ?? line.period_from ?? "",
    to: line.current?.covered_to ?? line.period_to ?? "",
  }));
  const [state, action, pending] = useActionState(saveMonthlyServicePeriod, {});
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        startTransition(() => action(f));
      }}
    >
      <Notice {...state} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input name="request_id" type="hidden" value={request} />
        <input name="source_token" type="hidden" value={context.token} />
        <input name="line_id" type="hidden" value={line.id} />
        <input name="current" type="hidden" value={context.current} />
        <input name="horse_id" type="hidden" value={context.horse ?? ""} />
        <input name="stay_id" type="hidden" value={context.stay ?? ""} />
        <input name="amount_cents" type="hidden" value={context.amount ?? ""} />
        <input name="clear" type="hidden" value={clear ? "yes" : "no"} />
        {clear ? (
          <>
            <p>
              Clear this monthly service-period assignment? Its dates and review
              history remain available, but the charge will need review in the
              comparison again.
            </p>
            <input name="from" type="hidden" value={context.from} />
            <input name="to" type="hidden" value={context.to} />
          </>
        ) : (
          <>
            <p>
              Assign physical boarding dates to this{" "}
              {money(context.amount ?? 0)}{" "}
              {line.service === "feed" ? "feed" : "board"}{" "}
              {(context.amount ?? 0) < 0 ? "credit" : "charge"} for{" "}
              {line.horse_name ?? "the assigned horse"}.
            </p>
            <div className="form-grid">
              <label>
                Covered from
                <TemporalInput
                  type="date"
                  name="from"
                  required
                  defaultValue={context.from}
                />
              </label>
              <label>
                Covered through
                <TemporalInput
                  type="date"
                  name="to"
                  required
                  defaultValue={context.to}
                />
              </label>
            </div>
            <p className="muted form-hint">
              The saved monthly charge spreads across all covered physical
              boarding days, including training off days. Each day is weighted
              by its calendar month’s length, matching generated monthly
              charges; remainder pennies use stable date order. Dates must be
              elapsed and within the assigned stay. This review does not reserve
              billing days, claim feedings, prove actual-cost reimbursement or
              change the customer’s bill.
            </p>
          </>
        )}
        <Field
          name="reason"
          label="Private review reason"
          required
          maxLength={2000}
        />
        <div className="form-actions">
          <ConfirmButton
            message={
              clear
                ? "Clear this internal monthly service-period assignment while retaining its history?"
                : "Save these covered dates for reporting? Invoice charges, payments and inventory will remain unchanged."
            }
          >
            {pending
              ? "Saving…"
              : clear
                ? "Clear monthly period"
                : "Save monthly period"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
