"use client";
import { useState, useActionState, startTransition } from "react";
import { savePackageReview } from "@/app/admin/invoices/package-review-actions";
import { Field, Notice } from "@/components/ui";
import { FormInput } from "@/components/form-input";
import { ConfirmButton } from "@/components/confirm-button";
import { money } from "@/lib/format";
import { moneyCents } from "@/lib/receipt-purchase";
import type { PackageReviewLine } from "@/lib/package-review";
export function PackageReviewForm({
  line,
  clear = false,
}: {
  line: PackageReviewLine;
  clear?: boolean;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [context] = useState(() => ({
    current: line.current?.id ?? "",
    horse: clear ? line.current?.horse_id : line.horse_id,
    stay: clear ? line.current?.stay_id : line.stay_id,
    amount: clear ? line.current?.amount_cents : line.amount_cents,
  }));
  const initial = clear ? line.current : line.effective;
  const [feed, setFeed] = useState(
    initial ? (initial.feed_cents / 100).toFixed(2) : "",
  );
  const [board, setBoard] = useState(
    initial ? (initial.board_cents / 100).toFixed(2) : "",
  );
  const [feedIncluded, setFeedIncluded] = useState(
    initial?.feed_included ?? false,
  );
  const [boardIncluded, setBoardIncluded] = useState(
    initial?.board_included ?? false,
  );
  const [state, action, pending] = useActionState(savePackageReview, {});
  let feedValue: number | null = null,
    boardValue: number | null = null;
  try {
    feedValue = moneyCents(feed);
  } catch {}
  try {
    boardValue = moneyCents(board);
  } catch {}
  const remainder =
    feedValue === null || boardValue === null
      ? null
      : (context.amount ?? 0) - feedValue - boardValue;
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
        <input name="line_id" type="hidden" value={line.id} />
        <input name="current" type="hidden" value={context.current} />
        <input name="horse_id" type="hidden" value={context.horse ?? ""} />
        <input name="stay_id" type="hidden" value={context.stay ?? ""} />
        <input name="amount_cents" type="hidden" value={context.amount ?? ""} />
        <input name="clear" type="hidden" value={clear ? "yes" : "no"} />
        {clear ? (
          <>
            <p>
              Clear this reviewed split?{" "}
              {line.original
                ? "Reporting will return to the original generated split."
                : "This line will need a reporting split again."}{" "}
              Review history remains available.
            </p>
            <input name="feed" type="hidden" value={feed} />
            <input name="board" type="hidden" value={board} />
            <input
              name="feed_included"
              type="hidden"
              value={initial?.feed_included ? "on" : ""}
            />
            <input
              name="board_included"
              type="hidden"
              value={initial?.board_included ? "on" : ""}
            />
          </>
        ) : (
          <>
            <p>
              Divide the saved {money(context.amount ?? 0)} charge for{" "}
              {line.horse_name ?? "this horse"}. Enter actual line portions,
              including explicit zeros. Today’s monthly agreement is not used.
            </p>
            <div className="form-grid">
              <label>
                Feed portion ($)
                <FormInput
                  prefix="$"
                  name="feed"
                  type="number"
                  min="0"
                  max={(context.amount ?? 0) / 100}
                  step="0.01"
                  required
                  value={feed}
                  onChange={(e) => setFeed(e.target.value)}
                />
              </label>
              <label>
                Board portion ($)
                <FormInput
                  prefix="$"
                  name="board"
                  type="number"
                  min="0"
                  max={(context.amount ?? 0) / 100}
                  step="0.01"
                  required
                  value={board}
                  onChange={(e) => setBoard(e.target.value)}
                />
              </label>
            </div>
            <p
              className={
                remainder !== null && remainder < 0 ? "notice error" : "notice"
              }
            >
              Training remainder:{" "}
              {remainder === null ? "Enter both portions" : money(remainder)}
            </p>
            {feedValue === 0 && (
              <label className="inline-checkbox">
                <input
                  name="feed_included"
                  type="checkbox"
                  checked={feedIncluded}
                  onChange={(e) => setFeedIncluded(e.target.checked)}
                />
                Feed was included with a $0 reporting portion
              </label>
            )}
            {boardValue === 0 && (
              <label className="inline-checkbox">
                <input
                  name="board_included"
                  type="checkbox"
                  checked={boardIncluded}
                  onChange={(e) => setBoardIncluded(e.target.checked)}
                />
                Board was included with a $0 reporting portion
              </label>
            )}
            <p className="muted form-hint">
              Positive portions count as included automatically. Explicit
              zero-value choices preserve which services can receive later
              reviewed adjustments. Revenue follows the line’s saved training
              days; dates and invoice amounts do not change.
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
            disabled={!clear && (remainder === null || remainder < 0)}
            message={
              clear
                ? "Clear this reporting-only override while retaining its history?"
                : "Save this reviewed split and restate internal reports for the original service dates? Customer charges, payments and the original invoice snapshot will remain unchanged."
            }
          >
            {pending
              ? "Saving…"
              : clear
                ? "Clear reviewed split"
                : "Save reviewed split"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
