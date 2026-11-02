"use client";
import { useActionState, useState, startTransition } from "react";
import { saveProfitReview } from "@/app/admin/reports/profit-actions";
import { AppSelect } from "@/components/app-select";
import { TemporalInput } from "@/components/temporal-input";
import { ConfirmButton } from "@/components/confirm-button";
import { Field, Notice } from "@/components/ui";
import { money, dateLabel } from "@/lib/format";
import type { ProfitInventorySource } from "@/lib/business-profit";
export function ProfitInventoryForm({
  source: s,
  clear = false,
}: {
  source: ProfitInventorySource;
  clear?: boolean;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [context] = useState(() => ({
    current: s.current?.id ?? "",
    token: clear ? s.current!.source_token : s.source_token,
    date: clear
      ? s.current!.recognition_date
      : s.valid
        ? s.current!.recognition_date
        : s.minimum_date,
  }));
  const [effect, setEffect] = useState(
    clear
      ? s.current!.effect
      : s.source_kind === "return"
        ? "settlement"
        : s.valid
          ? s.current!.effect
          : "",
  );
  const cents = clear
    ? s.current!.submitted_cents
    : effect === "none"
      ? 0
      : s.source_kind === "return"
        ? Math.abs(s.cash_cents + s.credit_cents - s.stock_cents)
        : s.stock_cents;
  const impact = clear
    ? s.current!.profit_cents
    : effect === "none"
      ? 0
      : effect === "cost"
        ? -cents
        : s.source_kind === "return"
          ? s.cash_cents + s.credit_cents - s.stock_cents
          : cents;
  const safe = Number.isSafeInteger(cents) && cents >= 0;
  const [state, action, pending] = useActionState(saveProfitReview, {});
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
        <input name="source_kind" type="hidden" value={s.source_kind} />
        <input name="source_id" type="hidden" value={s.source_id} />
        <input name="current" type="hidden" value={context.current} />
        <input name="source_token" type="hidden" value={context.token} />
        <input name="amount_cents" type="hidden" value={safe ? cents : ""} />
        <input name="clear" type="hidden" value={clear ? "yes" : "no"} />
        <p>{s.label}</p>
        {clear ? (
          <>
            <p>
              Clear this financial review? History remains, but the source will
              need review before profit is complete.
            </p>
            <input name="effect" type="hidden" value={effect} />
            <input name="recognition_date" type="hidden" value={context.date} />
          </>
        ) : s.source_kind === "return" ? (
          <>
            <input name="effect" type="hidden" value="settlement" />
            <dl className="feed-comparison-metrics">
              {[
                ["Returned stock value", money(s.stock_cents)],
                ["Cash actually received", money(s.cash_cents)],
                ["Store credit actually issued", money(s.credit_cents)],
                ["Return gain / loss", money(impact)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <label>
              Actual financial settlement date
              <TemporalInput
                name="recognition_date"
                type="date"
                required
                defaultValue={context.date}
              />
            </label>
            <p className="muted form-hint">
              Use the actual date the outcome became final, on or after{" "}
              {dateLabel(s.minimum_date)}. Confirm all received cash and credit
              are recorded, including a zero-refund or short settlement when
              final. This does not receive money, apply credit or close supplier
              follow-up expectations.
            </p>
          </>
        ) : (
          <>
            <label>
              Financial treatment
              <AppSelect
                name="effect"
                value={effect}
                onChange={(e) => setEffect(e.target.value)}
                required
              >
                <option value="">Choose treatment</option>
                <option value="none">
                  Already accounted for / no extra profit effect
                </option>
                {s.detail_kind === "adjustment_out" ? (
                  <option value="cost">
                    Recognize the stock value as a loss
                  </option>
                ) : (
                  <option value="gain">
                    Recognize the stock value as a gain
                  </option>
                )}
              </AppSelect>
            </label>
            <p className="muted">
              Recorded source value: {money(s.stock_cents)}. Profit date:{" "}
              {dateLabel(s.source_date)}.
            </p>
            <input
              name="recognition_date"
              type="hidden"
              value={s.source_date}
            />
            <p className="muted form-hint">
              Review the full movement or credit. Choose no extra effect if its
              impact is already reflected elsewhere; do not count the same cost
              or gain twice. This changes profit reporting only.
            </p>
          </>
        )}
        {!clear && effect && (
          <p className="notice">Reviewed profit effect: {money(impact)}</p>
        )}
        {!safe && (
          <p className="notice error">
            The source value cannot be reviewed safely. Correct the source
            records first.
          </p>
        )}
        <Field
          name="reason"
          label="Private financial review reason"
          required
          maxLength={2000}
        />
        <div className="form-actions">
          <ConfirmButton
            disabled={!safe || !effect}
            message={
              clear
                ? "Clear this reporting review while retaining its history?"
                : `Record ${money(impact)} as the reviewed profit effect? Stock, refunds, supplier credit and cash records will not change.`
            }
          >
            {pending
              ? "Saving…"
              : clear
                ? "Clear financial review"
                : "Save financial review"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
