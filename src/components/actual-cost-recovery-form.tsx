"use client";
import { useState, useActionState, startTransition } from "react";
import { recoverActualSources } from "@/app/admin/invoices/actual-recovery-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { Field, Notice } from "@/components/ui";
import { money, dateLabel } from "@/lib/format";
import type { RecoveryLine } from "@/lib/actual-cost-recovery";
export function ActualCostRecoveryForm({ line: l }: { line: RecoveryLine }) {
  const [request] = useState(() => crypto.randomUUID());
  const [token] = useState(l.source_token ?? "");
  const [state, action, pending] = useActionState(recoverActualSources, {});
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
      <fieldset
        className="stack"
        disabled={pending || Boolean(state.success) || !l.ready}
      >
        <input type="hidden" name="request_id" value={request} />
        <input type="hidden" name="line_id" value={l.id} />
        <input type="hidden" name="source_token" value={token} />
        <p>{l.description}</p>
        <dl className="feed-comparison-metrics">
          <div>
            <dt>Saved charge</dt>
            <dd>{money(l.amount_cents)}</dd>
          </div>
          <div>
            <dt>Matched source cost</dt>
            <dd>
              {l.source_cost_cents === null
                ? "Unavailable"
                : money(l.source_cost_cents)}
            </dd>
          </div>
        </dl>
        <p>
          {l.sources.length} original{" "}
          {l.service === "feed" ? "feeding record(s)" : "expense assignment(s)"}{" "}
          · {l.from && dateLabel(l.from)} – {l.to && dateLabel(l.to)}
        </p>
        <p className="notice">
          Restoring these links reserves the original sources against duplicate
          billing. Later corrections must follow the existing invoice correction
          rules. The saved invoice amount and payments stay unchanged.
        </p>
        <Field
          name="reason"
          label="Private recovery reason"
          required
          maxLength={2000}
        />
        <div className="form-actions">
          <ConfirmButton message="Restore these original billing-source links? They will be protected from duplicate billing and ordinary reversal. The saved invoice amount will not change.">
            {pending ? "Restoring…" : "Restore original links"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
