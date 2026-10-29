"use client";
import { useActionState, useState, startTransition } from "react";
import { savePackageReporting } from "@/app/admin/training/reporting-actions";
import { Field, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { money } from "@/lib/format";
import type { PackageAgreement } from "@/lib/package-reporting";
export function PackageReportingForm({
  stay,
  monthly,
  current,
  feedIncluded,
  boardIncluded,
}: {
  stay: string;
  monthly: number;
  current?: PackageAgreement;
  feedIncluded: boolean;
  boardIncluded: boolean;
}) {
  const [request] = useState(() => crypto.randomUUID());
  const [revision] = useState(current?.id ?? "");
  const [state, action, pending] = useActionState(savePackageReporting, {});
  return (
    <form
      action={action}
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => action(form));
      }}
    >
      <Notice {...state} />
      <fieldset className="stack" disabled={pending || Boolean(state.success)}>
        <input type="hidden" name="request_id" value={request} />
        <input type="hidden" name="stay_id" value={stay} />
        <input type="hidden" name="current" value={revision} />
        <p>
          Divide the {money(monthly)} monthly package for internal reporting.
          Training receives the remainder. Enter zero to explicitly assign none
          to an included service.
        </p>
        <div className="form-grid">
          {feedIncluded ? (
            <Field
              name="feed"
              label="Monthly feed allocation ($)"
              type="number"
              min="0"
              max={monthly / 100}
              step="0.01"
              required
              defaultValue={
                current ? (current.feed_cents / 100).toFixed(2) : undefined
              }
            />
          ) : (
            <input name="feed" type="hidden" value="0" />
          )}
          {boardIncluded ? (
            <Field
              name="board"
              label="Monthly board allocation ($)"
              type="number"
              min="0"
              max={monthly / 100}
              step="0.01"
              required
              defaultValue={
                current ? (current.board_cents / 100).toFixed(2) : undefined
              }
            />
          ) : (
            <input name="board" type="hidden" value="0" />
          )}
        </div>
        <Field name="reason" label="Private reason" required maxLength={2000} />
        <p className="muted form-hint">
          Each new generated training line uses these proportions, including
          prorated lines. Feed and board are rounded down to cents; remaining
          pennies stay with training. This does not add charges or change the
          customer’s invoice. Changing the package rate or included services
          requires a new reporting split.
        </p>
        <div className="form-actions">
          <ConfirmButton message="Save this reporting agreement for newly generated training lines? Existing lines and customer totals will remain unchanged.">
            {pending ? "Saving…" : "Save reporting split"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
