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
      : (context.claimed && current) || (current && context.needs_review)
        ? "review"
        : (current?.mode ?? "full"),
  );
  const [amount, setAmount] = useState(
    current ? (current.amount_cents / 100).toFixed(2) : "",
  );
  const [acknowledgement, setAcknowledgement] = useState("");
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
              Remove this protected designation? Existing invoice amounts remain
              unchanged. If billed, the invoice will be flagged for your manual
              review. Decision history is retained.
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
        {context.claimed && (
          <>
            <p className="notice">
              This feeding is already invoiced. A changed protected amount will
              flag the invoice for manual review. It will not create a credit,
              extra charge, refund or payment. Enter any billing corrections
              separately.
            </p>
            <label>
              Invoice follow-up
              <AppSelect
                name="invoice_review_ack"
                required
                value={acknowledgement}
                onChange={(e) => setAcknowledgement(e.target.value)}
              >
                <option value="">Choose review acknowledgement</option>
                <option value="yes">
                  Flag invoice; I will review billing manually
                </option>
              </AppSelect>
            </label>
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
              ? "The saved amount exceeds the current cost. Choose a new fixed partial amount or full recorded cost and acknowledge manual invoice review."
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
            disabled={invalid || (context.claimed && acknowledgement !== "yes")}
            message={
              clear
                ? "Remove this feeding’s absorbed-cost protection? If billed, its invoice will be flagged for manual correction. History is retained."
                : "Save this fixed feed billing decision? Any billed amount change will flag its invoice for manual correction; invoice amounts, stock and payments will not change."
            }
          >
            {pending
              ? "Saving…"
              : clear
                ? "Clear absorbed amount"
                : context.claimed
                  ? "Save billed feed decision"
                  : "Save feed decision"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
