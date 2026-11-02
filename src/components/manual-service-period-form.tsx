"use client";
import { useActionState, useState, startTransition } from "react";
import { saveManualServicePeriod } from "@/app/admin/invoices/manual-service-actions";
import { AppSelect } from "@/components/app-select";
import { FormInput } from "@/components/form-input";
import { moneyCents } from "@/lib/receipt-purchase";
import { Field, Notice } from "@/components/ui";
import { TemporalInput } from "@/components/temporal-input";
import { ConfirmButton } from "@/components/confirm-button";
import { money } from "@/lib/format";
import type { ManualServiceLine } from "@/lib/manual-service-periods";
export function ManualServicePeriodForm({
  line,
  clear = false,
}: {
  line: ManualServiceLine;
  clear?: boolean;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [context] = useState(() => ({
    current: line.current?.id ?? "",
    token: clear ? line.current?.source_token : line.source_token,
    horse: clear ? line.current?.horse_id : line.horse_id,
    stay: clear ? line.current?.stay_id : line.stay_id,
    amount: clear ? line.current?.amount_cents : line.amount_cents,
    from: line.current?.covered_from ?? line.period_from ?? "",
    to: line.current?.covered_to ?? line.period_to ?? "",
  }));
  const [isPackage, setIsPackage] = useState(
    clear
      ? Boolean(line.current?.package_reviewed)
      : line.source_kind === "training" ||
          (line.service === "training" &&
            (context.amount ?? 0) >= 0 &&
            Boolean(line.current?.package_reviewed && !line.current.cleared)),
  );
  const [feed, setFeed] = useState(
    line.current?.package_reviewed
      ? ((line.current.feed_cents ?? 0) / 100).toFixed(2)
      : "",
  );
  const [board, setBoard] = useState(
    line.current?.package_reviewed
      ? ((line.current.board_cents ?? 0) / 100).toFixed(2)
      : "",
  );
  let remainder: number | null = null;
  try {
    remainder = (context.amount ?? 0) - moneyCents(feed) - moneyCents(board);
  } catch {}
  const [state, action, pending] = useActionState(saveManualServicePeriod, {});
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
        <input name="line_id" type="hidden" value={line.id} />
        <input name="current" type="hidden" value={context.current} />
        <input name="source_token" type="hidden" value={context.token ?? ""} />
        <input name="horse_id" type="hidden" value={context.horse ?? ""} />
        <input name="stay_id" type="hidden" value={context.stay ?? ""} />
        <input name="amount_cents" type="hidden" value={context.amount ?? ""} />
        <input name="clear" type="hidden" value={clear ? "yes" : "no"} />
        <input name="package" type="hidden" value={isPackage ? "yes" : "no"} />
        {clear && (
          <>
            <input name="feed" type="hidden" value={feed} />
            <input name="board" type="hidden" value={board} />
          </>
        )}
        {clear ? (
          <>
            <p>
              Clear this service-period assignment? Its dates and review history
              remain available, but the charge will need review in the
              comparison again.
            </p>
            <input name="from" type="hidden" value={context.from} />
            <input name="to" type="hidden" value={context.to} />
          </>
        ) : (
          <>
            {line.source_kind === "training" && (
              <p className="notice">
                Historical generated charge: this review restores reporting
                dates, never billing reservations.
              </p>
            )}
            <p>
              Assign covered dates to this {money(context.amount ?? 0)}{" "}
              {line.service === "training" ? "training" : "board"}{" "}
              {(context.amount ?? 0) < 0 ? "credit" : "charge"} for{" "}
              {line.horse_name ?? "the assigned horse"}.
            </p>
            {line.source_kind !== "training" &&
              line.service === "training" &&
              (context.amount ?? 0) >= 0 && (
                <label>
                  Reporting allocation
                  <AppSelect
                    value={isPackage ? "package" : "training"}
                    onChange={(e) => setIsPackage(e.target.value === "package")}
                  >
                    <option value="training">Training only</option>
                    <option value="package">
                      Training, feed & board package
                    </option>
                  </AppSelect>
                </label>
              )}
            {isPackage && (
              <div className="stack">
                <div className="form-grid">
                  <label>
                    Feed portion
                    <FormInput
                      name="feed"
                      type="number"
                      min="0"
                      step="0.01"
                      prefix="$"
                      value={feed}
                      onChange={(e) => setFeed(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Board portion
                    <FormInput
                      name="board"
                      type="number"
                      min="0"
                      step="0.01"
                      prefix="$"
                      value={board}
                      onChange={(e) => setBoard(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <p
                  className={
                    remainder !== null && remainder >= 0
                      ? "notice"
                      : "notice error"
                  }
                >
                  Training remainder:{" "}
                  {remainder !== null
                    ? money(remainder)
                    : "Enter valid amounts"}
                </p>
                <p className="muted form-hint">
                  {line.source_kind === "training"
                    ? "Enter explicit portions of this historical generated charge, including known zeros. All three portions follow recorded worked/billable rest days and calendar-month weighting, matching generated-charge reporting. Nonbillable dates receive no package revenue."
                    : "Enter portions of this actual saved charge, not monthly rates. Feed and board spread across every covered physical boarding day, including nonbillable training days. Explicit zero portions are saved."}{" "}
                  Current agreement rates are not copied.
                </p>
              </div>
            )}
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
              {line.source_kind === "training"
                ? "Classify every covered stay day first. All portions use recorded worked/billable rest days weighted by calendar-month length. Nonbillable dates receive no revenue. Changed classifications require another review."
                : line.service === "training"
                  ? `Classify every covered stay day first. The ${isPackage ? "training remainder" : "saved amount"} spreads evenly across recorded worked and billable rest days; nonbillable days receive no revenue. Changed classifications require another review.`
                  : "The saved amount spreads evenly across all covered calendar days. Any assigned stay bounds apply."}{" "}
              The sign is preserved and remaining pennies go to earliest
              eligible dates. This review does not reserve billing days or
              costs.
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
            disabled={
              !clear && isPackage && (remainder === null || remainder < 0)
            }
            message={
              clear
                ? "Clear this internal service-period assignment while retaining its history?"
                : isPackage
                  ? `Save these covered dates and reporting portions: feed ${money(remainder === null ? 0 : moneyCents(feed))}, board ${money(remainder === null ? 0 : moneyCents(board))}, training ${money(remainder ?? 0)}? Customer charges, payments and inventory remain unchanged.`
                  : "Save these covered dates for reporting? Invoice charges, payments and inventory will remain unchanged."
            }
          >
            {pending
              ? "Saving…"
              : clear
                ? "Clear service period"
                : "Save service period"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
