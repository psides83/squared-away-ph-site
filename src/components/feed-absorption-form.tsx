"use client";
import { useState, useActionState, startTransition } from "react";
import { saveFeedAbsorption } from "@/app/admin/feeding/absorption/actions";
import { AppSelect } from "@/components/app-select";
import { FormInput } from "@/components/form-input";
import { ConfirmButton } from "@/components/confirm-button";
import { Field, Notice } from "@/components/ui";
import { money } from "@/lib/format";
import { moneyCents } from "@/lib/receipt-purchase";
import type { AbsorptionRow } from "@/lib/feed-absorption";
export function FeedAbsorptionForm({
  row: r,
  clear = false,
}: {
  row: AbsorptionRow;
  clear?: boolean;
}) {
  const [context] = useState(r),
    [request] = useState(() => crypto.randomUUID());
  const current =
    context.current && context.current.mode !== "clear"
      ? context.current
      : null;
  const [mode, setMode] = useState<string>(
    clear
      ? "clear"
      : context.claimed || (current && context.needs_review)
        ? "review"
        : (current?.mode ?? "full"),
  );
  const [amount, setAmount] = useState(
    current ? (current.amount_cents / 100).toFixed(2) : "",
  );
  const [state, action, pending] = useActionState(saveFeedAbsorption, {});
  let absorbed = 0,
    invalid = false;
  try {
    absorbed =
      mode === "clear"
        ? 0
        : mode === "full"
          ? context.cost_cents
          : mode === "review"
            ? (current?.amount_cents ?? 0)
            : moneyCents(amount);
    invalid =
      absorbed > context.cost_cents ||
      absorbed < 0 ||
      (mode === "partial" && absorbed === 0);
  } catch {
    invalid = true;
  }
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
        <input name="movement_id" type="hidden" value={context.movement_id} />
        <input name="current" type="hidden" value={context.current?.id ?? ""} />
        <input
          name="source_token"
          type="hidden"
          value={clear ? context.current!.source_token : context.source_token}
        />
        <p>
          {context.barn_name} · {context.product_name}
        </p>
        <p>Recorded feeding cost: {money(context.cost_cents)}</p>
        {clear ? (
          <>
            <input type="hidden" name="mode" value="clear" />
            <p>
              Remove this protection from future actual-cost invoices? Decision
              history remains; this does not change stock or existing invoice
              amounts.
            </p>
          </>
        ) : context.claimed ? (
          <>
            <input type="hidden" name="mode" value="review" />
            <p className="notice">
              This feeding is already on an invoice. You can reconfirm only the
              same saved absorbed amount, {money(current?.amount_cents ?? 0)},
              after checking the corrected cost. Existing invoice amounts and
              their saved protected portions remain unchanged. Resolve invoice
              cost-review flags separately.
            </p>
          </>
        ) : (
          <>
            <label>
              Amount to absorb
              <AppSelect
                name="mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="full">Full recorded cost</option>
                <option value="partial">Fixed partial dollar amount</option>
                {current && (
                  <option value="review">Keep the saved fixed amount</option>
                )}
              </AppSelect>
            </label>
            {mode === "partial" && (
              <label>
                Absorbed amount
                <FormInput
                  name="amount"
                  type="number"
                  prefix="$"
                  min="0.01"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            <p className="muted form-hint">
              Full cost retains the source’s fractional cents without a leftover
              charge. Partial dollar amounts cannot exceed the unrounded
              recorded cost. Any cost change requires a new review; no
              percentage is applied automatically. Fixed monthly/package charges
              are unchanged.
            </p>
          </>
        )}
        {invalid ? (
          <p
            className={
              mode === "partial" && !amount.trim()
                ? "muted form-hint"
                : "notice error"
            }
          >
            {context.claimed
              ? "The saved amount exceeds the current cost. Resolve this feeding’s invoice before changing the protected amount."
              : "Enter a positive partial amount no greater than the unrounded cost, or choose full recorded cost."}
          </p>
        ) : (
          <p className="notice">
            Absorbed: {money(absorbed)} · Remaining recorded cost:{" "}
            {money(context.cost_cents - absorbed)}
          </p>
        )}
        <Field
          name="reason"
          label="Private billing decision reason"
          required
          maxLength={2000}
        />
        <div className="form-actions">
          <ConfirmButton
            disabled={invalid}
            message={
              clear
                ? "Remove this unbilled feeding’s absorbed-cost protection while retaining history?"
                : "Save this fixed feed billing decision? Full feeding cost remains a business cost. Existing invoice amounts and stock will not change."
            }
          >
            {pending
              ? "Saving…"
              : clear
                ? "Clear absorbed amount"
                : context.claimed
                  ? "Review saved amount"
                  : "Save feed decision"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
