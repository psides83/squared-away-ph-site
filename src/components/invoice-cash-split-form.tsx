"use client";
import { useState, useActionState, startTransition } from "react";
import { saveCashSplit } from "@/app/admin/invoices/cash-split-actions";
import { AppSelect } from "@/components/app-select";
import { FormInput } from "@/components/form-input";
import { ConfirmButton } from "@/components/confirm-button";
import { Field, Notice } from "@/components/ui";
import { money, dateLabel } from "@/lib/format";
import { moneyCents } from "@/lib/receipt-purchase";
import type { CashSplitOptions } from "@/lib/invoice-cash-splits";
export function InvoiceCashSplitForm({
  options,
  clear = false,
}: {
  options: CashSplitOptions;
  clear?: boolean;
}) {
  const [o] = useState(options),
    [request] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState(() =>
    !clear && o.current && !o.current.cleared
      ? o.current.lines.map((l, n) => ({
          id: `saved-${n}`,
          horse: l.horse_id,
          stay: l.stay_id ?? "",
          amount: (l.amount_cents / 100).toFixed(2),
        }))
      : [],
  );
  const [state, action, pending] = useActionState(saveCashSplit, {});
  let valid = true,
    total = 0;
  const payload = rows.map((r) => {
    let n = 0;
    try {
      n = moneyCents(r.amount);
      if (n <= 0) valid = false;
    } catch {
      valid = false;
    }
    if (!r.horse) valid = false;
    total += n;
    return { horse_id: r.horse, stay_id: r.stay || null, amount_cents: n };
  });
  const basis = o.source?.total_cents ?? 0;
  const invalid =
    !clear && (!valid || !rows.length || total > basis || !o.source);
  function patch(id: string, v: Partial<(typeof rows)[number]>) {
    setRows((old) => old.map((r) => (r.id === id ? { ...r, ...v } : r)));
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
        <input type="hidden" name="request_id" value={request} />
        <input type="hidden" name="invoice_id" value={o.invoice_id} />
        <input type="hidden" name="current" value={o.current?.id ?? ""} />
        <input
          type="hidden"
          name="source_token"
          value={
            clear ? o.current!.source_token : (o.source?.source_token ?? "")
          }
        />
        <input
          type="hidden"
          name="rows"
          value={JSON.stringify(clear ? [] : payload)}
        />
        <input type="hidden" name="clear" value={clear ? "yes" : "no"} />
        {clear ? (
          <p>
            Clear the cash split and return to the invoice’s single-horse
            reporting assignment, or Unassigned if none exists? Private split
            history is retained.
          </p>
        ) : (
          <>
            <p>
              Allocate portions of the current {money(basis)} invoice charges.
              Each received payment and cash refund follows these proportions on
              its own recorded date.
            </p>
            {rows.map((r, n) => (
              <div className="stack separated" key={r.id}>
                <h3>Allocation {n + 1}</h3>
                <div className="form-grid">
                  <label>
                    Horse
                    <AppSelect
                      required
                      value={r.horse}
                      onChange={(e) =>
                        patch(r.id, { horse: e.target.value, stay: "" })
                      }
                    >
                      <option value="">Choose horse</option>
                      {o.horses.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.barn_name}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                  <label>
                    Training stay
                    <AppSelect
                      value={r.stay}
                      onChange={(e) => patch(r.id, { stay: e.target.value })}
                    >
                      <option value="">Horse only</option>
                      {o.stays
                        .filter((s) => s.horse_id === r.horse)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {dateLabel(s.arrival_date)} –{" "}
                            {s.departure_date
                              ? dateLabel(s.departure_date)
                              : "ongoing"}
                          </option>
                        ))}
                    </AppSelect>
                  </label>
                  <label>
                    Invoice amount
                    <FormInput
                      type="number"
                      min="0.01"
                      step="0.01"
                      prefix="$"
                      required
                      value={r.amount}
                      onChange={(e) => patch(r.id, { amount: e.target.value })}
                    />
                  </label>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      setRows((old) => old.filter((x) => x.id !== r.id))
                    }
                  >
                    Remove allocation
                  </button>
                </div>
              </div>
            ))}
            <div className="row-actions">
              <button
                className="button secondary"
                type="button"
                disabled={rows.length >= 50}
                onClick={() =>
                  setRows((old) => [
                    ...old,
                    {
                      id: crypto.randomUUID(),
                      horse: "",
                      stay: "",
                      amount: "",
                    },
                  ])
                }
              >
                Add horse / stay
              </button>
            </div>
            <p className={total > basis ? "notice error" : "notice"}>
              Assigned: {money(total)} · Unassigned remainder:{" "}
              {money(basis - total)}
            </p>
            <p className="muted form-hint">
              An unassigned remainder stays visible in cash reports. Refunds use
              the same proportions; pennies are reconciled per transaction by
              largest remainder, with row order breaking ties. Changing this
              split restates earlier cash attribution. Service-date profit
              attribution is separate.
            </p>
          </>
        )}
        <Field
          name="reason"
          label="Private allocation reason"
          required
          maxLength={2000}
        />
        <div className="form-actions">
          <ConfirmButton
            disabled={invalid}
            message={
              clear
                ? "Clear this cash split while keeping its history? Earlier cash reports will use the single-horse assignment or Unassigned."
                : "Save this proportional cash split? Earlier payments and refunds will be reattributed; customer invoices, payments and service-date profit records will not change."
            }
          >
            {pending
              ? "Saving…"
              : clear
                ? "Clear cash split"
                : "Save cash split"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
