"use client";
import { useState, useActionState, startTransition } from "react";
import { AppSelect } from "@/components/app-select";
import { TemporalInput } from "@/components/temporal-input";
import { FormInput } from "@/components/form-input";
import { Field, Notice } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { saveServiceAssignments } from "@/app/admin/expenses/service-assignment-actions";
import { money, dateLabel } from "@/lib/format";
import { moneyCents } from "@/lib/receipt-purchase";
import type {
  AssignmentOptions,
  AssignmentDraft,
} from "@/lib/service-assignments";
export function ServiceAssignmentForm({
  options,
  clear = false,
}: {
  options: AssignmentOptions;
  clear?: boolean;
}) {
  const [snapshot] = useState(options);
  const parent = snapshot.parent;
  const [request] = useState(() => crypto.randomUUID());
  const [rows, setRows] = useState<AssignmentDraft[]>(() =>
    !clear &&
    parent &&
    snapshot.current &&
    snapshot.current.parent_id === parent.id &&
    !snapshot.current.cleared
      ? snapshot.current.lines.map((l, index) => ({
          ...l,
          id: `saved-${snapshot.current!.id}-${index}`,
          stay_id: l.stay_id ?? "",
          amount: (l.amount_cents / 100).toFixed(2),
        }))
      : [],
  );
  const [state, action, pending] = useActionState(saveServiceAssignments, {});
  const availableHorses = snapshot.horses.filter(
    (h) => !snapshot.source_horse_id || h.id === snapshot.source_horse_id,
  );
  let training = 0,
    board = 0,
    invalid = false;
  for (const r of rows) {
    try {
      const n = moneyCents(r.amount);
      if (n <= 0) invalid = true;
      if (r.service === "training") training += n;
      else board += n;
    } catch {
      invalid = true;
    }
  }
  const over =
    training > (parent?.training_cents ?? 0) ||
    board > (parent?.board_cents ?? 0);
  function patch(id: string, values: Partial<AssignmentDraft>) {
    setRows((old) => old.map((r) => (r.id === id ? { ...r, ...values } : r)));
  }
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
        <input name="expense_id" type="hidden" value={snapshot.expense_id} />
        <input
          name="parent_id"
          type="hidden"
          value={
            clear ? (snapshot.current?.parent_id ?? "") : (parent?.id ?? "")
          }
        />
        <input
          name="current"
          type="hidden"
          value={snapshot.current?.id ?? ""}
        />
        <input
          name="rows"
          type="hidden"
          value={JSON.stringify(clear ? [] : rows)}
        />
        <input name="clear" type="hidden" value={clear ? "yes" : "no"} />
        {clear ? (
          <p>
            Clear all current horse/stay assignments for this cost? The service
            cost will return to unassigned business cost using its overall
            covered dates. History remains available.
          </p>
        ) : (
          <>
            <p>
              Enter the amounts each horse or stay should carry. No existing
              shared-cost percentages are copied.
            </p>
            <p>
              Available: training {money(parent?.training_cents ?? 0)} · Board{" "}
              {money(parent?.board_cents ?? 0)}
            </p>
            {rows.map((r, index) => {
              const stays = snapshot.stays.filter(
                (s) =>
                  s.horse_id === r.horse_id &&
                  s.arrival_date <= (parent?.covered_to ?? "") &&
                  (!s.departure_date ||
                    s.departure_date >= (parent?.covered_from ?? "")),
              );
              const stay = stays.find((s) => s.id === r.stay_id);
              const min = [parent?.covered_from ?? "", stay?.arrival_date ?? ""]
                .sort()
                .at(-1)!;
              const max = [
                parent?.covered_to ?? "",
                stay?.departure_date ?? parent?.covered_to ?? "",
              ].sort()[0];
              return (
                <section className="panel" key={r.id}>
                  <div className="panel-heading">
                    <h3>Portion {index + 1}</h3>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        setRows((old) => old.filter((x) => x.id !== r.id))
                      }
                    >
                      Remove portion
                    </button>
                  </div>
                  <div className="record-form stack">
                    <div className="form-grid">
                      <label>
                        Service
                        <AppSelect
                          name={`service_${r.id}`}
                          value={r.service}
                          onChange={(e) =>
                            patch(r.id, { service: e.target.value })
                          }
                        >
                          {(parent?.training_cents ?? 0) > 0 && (
                            <option value="training">Training</option>
                          )}
                          {(parent?.board_cents ?? 0) > 0 && (
                            <option value="board">Board</option>
                          )}
                        </AppSelect>
                      </label>
                      <label>
                        Horse
                        <AppSelect
                          required
                          name={`horse_${r.id}`}
                          value={r.horse_id}
                          onChange={(e) =>
                            patch(r.id, {
                              horse_id: e.target.value,
                              stay_id: "",
                              covered_from: parent?.covered_from ?? "",
                              covered_to: parent?.covered_to ?? "",
                            })
                          }
                        >
                          <option value="">Choose horse</option>
                          {availableHorses.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.barn_name}
                            </option>
                          ))}
                        </AppSelect>
                      </label>
                      <label>
                        Training stay (optional)
                        <AppSelect
                          name={`stay_${r.id}`}
                          value={r.stay_id}
                          disabled={!r.horse_id}
                          onChange={(e) => {
                            const s = stays.find(
                              (s) => s.id === e.target.value,
                            );
                            patch(r.id, {
                              stay_id: e.target.value,
                              covered_from: [
                                parent?.covered_from ?? "",
                                s?.arrival_date ?? "",
                              ]
                                .sort()
                                .at(-1)!,
                              covered_to: [
                                parent?.covered_to ?? "",
                                s?.departure_date ?? parent?.covered_to ?? "",
                              ].sort()[0],
                            });
                          }}
                        >
                          <option value="">Horse only — no stay</option>
                          {stays.map((s) => (
                            <option key={s.id} value={s.id}>
                              {dateLabel(s.arrival_date)} –{" "}
                              {s.departure_date
                                ? dateLabel(s.departure_date)
                                : "Open stay"}
                            </option>
                          ))}
                        </AppSelect>
                      </label>
                      <label>
                        Assigned cost ($)
                        <FormInput
                          prefix="$"
                          type="number"
                          min="0.01"
                          step="0.01"
                          max={
                            (r.service === "training"
                              ? (parent?.training_cents ?? 0)
                              : (parent?.board_cents ?? 0)) / 100
                          }
                          required
                          name={`amount_${r.id}`}
                          value={r.amount}
                          onChange={(e) =>
                            patch(r.id, { amount: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <div className="form-grid">
                      <label>
                        Covered from
                        <TemporalInput
                          type="date"
                          required
                          name={`from_${r.id}`}
                          min={min}
                          max={max}
                          value={r.covered_from}
                          onChange={(e) =>
                            patch(r.id, { covered_from: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Covered through
                        <TemporalInput
                          type="date"
                          required
                          name={`to_${r.id}`}
                          min={min}
                          max={max}
                          value={r.covered_to}
                          onChange={(e) =>
                            patch(r.id, { covered_to: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  </div>
                </section>
              );
            })}
            <div className="row-actions">
              <button
                type="button"
                className="button secondary"
                disabled={rows.length >= 50}
                onClick={() =>
                  setRows((old) => [
                    ...old,
                    {
                      id: crypto.randomUUID(),
                      service:
                        (parent?.training_cents ?? 0) > 0
                          ? "training"
                          : "board",
                      horse_id: snapshot.source_horse_id ?? "",
                      stay_id: "",
                      amount: "",
                      covered_from: parent?.covered_from ?? "",
                      covered_to: parent?.covered_to ?? "",
                    },
                  ])
                }
              >
                Add portion
              </button>
            </div>
            <p className={over ? "notice error" : "notice"}>
              {invalid
                ? "Finish the amounts to see the remainder."
                : `Unassigned business cost: training ${money((parent?.training_cents ?? 0) - training)} · Board ${money((parent?.board_cents ?? 0) - board)}`}
            </p>
            <p className="muted form-hint">
              Each assigned portion spreads evenly across its own dates, with
              remaining pennies on its earliest days. Unassigned amounts keep
              the overall expense dates. Assignments can restate service-cost
              timing in business reports; full-period totals, bills and cash
              remain unchanged. Other service costs stay at business level.
            </p>
            {snapshot.options_truncated && (
              <p className="notice">
                Horse/stay options are limited to the first 1,000 horses and
                2,000 stays.
              </p>
            )}
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
            disabled={!clear && (!rows.length || invalid || over)}
            message={
              clear
                ? "Clear these reporting assignments and return their cost to the business period, retaining history?"
                : "Save these manual horse/stay portions and covered dates? This may restate service margins by date, without changing bills, payments or cash."
            }
          >
            {pending
              ? "Saving…"
              : clear
                ? "Clear assignments"
                : "Save assignments"}
          </ConfirmButton>
        </div>
      </fieldset>
    </form>
  );
}
