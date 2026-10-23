import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { AppSelect } from "@/components/app-select";
import { ConfirmButton } from "@/components/confirm-button";
import { HelpPanel } from "@/components/help-panel";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { money, dateLabel, today } from "@/lib/format";
import { recurringExpenseAction } from "@/app/admin/expenses/recurring/actions";
export type RecurringExpense = {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  horse_id: string | null;
  horse_name: string | null;
  vendor: string | null;
  amount_cents: number;
  reimbursable: boolean;
  notes: string | null;
  cadence: string;
  starts_on: string;
  ends_on: string | null;
  active: boolean;
  next_index: number;
  revision: number;
  next_date: string;
  history: {
    id: string;
    expense_date: string;
    expense_id: string | null;
    skipped_reason: string | null;
    paid_on: string | null;
    voided_at: string | null;
  }[];
};
type Options = {
  categories: { id: string; name: string }[];
  horses: { id: string; barn_name: string }[];
};
const frequencies = [
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["quarterly", "Every 3 months"],
  ["yearly", "Yearly"],
];
function ScheduleForm({
  row,
  options,
}: {
  row?: RecurringExpense;
  options: Options;
}) {
  return (
    <form
      action={recurringExpenseAction.bind(null, "save")}
      className="record-form"
    >
      <input type="hidden" name="id" value={row?.id ?? crypto.randomUUID()} />
      <input type="hidden" name="revision" value={row?.revision ?? 0} />
      <div className="form-grid">
        <Field
          label="Schedule name"
          name="name"
          required
          defaultValue={row?.name}
        />
        <Field label="Vendor" name="vendor" defaultValue={row?.vendor} />
        <Field
          label="Expected amount ($)"
          name="amount"
          type="number"
          min="0"
          max="1000000"
          step="0.01"
          required
          defaultValue={row ? (row.amount_cents / 100).toFixed(2) : undefined}
        />
        <label>
          Category
          <AppSelect
            name="category_id"
            required
            defaultValue={row?.category_id ?? ""}
          >
            <option value="">Choose category</option>
            {options.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </AppSelect>
        </label>
        <label>
          Horse (optional)
          <AppSelect name="horse_id" defaultValue={row?.horse_id ?? ""}>
            <option value="">Barn / shared expense</option>
            {options.horses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.barn_name}
              </option>
            ))}
          </AppSelect>
        </label>
        {row && row.next_index > 0 ? (
          <div>
            <input type="hidden" name="cadence" value={row.cadence} />
            <input type="hidden" name="starts_on" value={row.starts_on} />
            <p>
              Frequency: {frequencies.find((f) => f[0] === row.cadence)?.[1]} ·
              Starts {dateLabel(row.starts_on)}
            </p>
            <p className="form-hint muted">
              To change these after an occurrence, pause this schedule and
              create a new one.
            </p>
          </div>
        ) : (
          <>
            <label>
              Frequency
              <AppSelect
                name="cadence"
                defaultValue={row?.cadence ?? "monthly"}
              >
                {frequencies.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </AppSelect>
            </label>
            <Field
              label="First bill date"
              name="starts_on"
              type="date"
              required
              defaultValue={row?.starts_on ?? today()}
            />
          </>
        )}
        <Field
          label="Last bill date (optional)"
          name="ends_on"
          type="date"
          defaultValue={row?.ends_on}
        />
      </div>
      <label className="inline-checkbox">
        <input
          type="checkbox"
          name="active"
          defaultChecked={row?.active ?? true}
        />
        Schedule active
      </label>
      <label className="inline-checkbox">
        <input
          type="checkbox"
          name="reimbursable"
          defaultChecked={row?.reimbursable ?? false}
        />
        Eligible for customer charge-back (requires a horse)
      </label>
      <label>
        Notes
        <textarea
          name="notes"
          maxLength={5000}
          rows={3}
          defaultValue={row?.notes ?? ""}
        />
      </label>
      <p className="form-hint muted">
        Bills start unpaid. Updating this schedule changes future bills only.
        Record stock purchases in Inventory instead; recurring bills do not add
        feed or supplies to stock.
      </p>
      <div className="form-actions">
        <SubmitButton>{row ? "Save schedule" : "Create schedule"}</SubmitButton>
      </div>
    </form>
  );
}
export function RecurringExpenses({
  rows,
  options,
}: {
  rows: RecurringExpense[];
  options: Options;
}) {
  const date = today();
  return (
    <div className="stack">
      <div className="row-actions">
        <ActionPanel id="new-recurring-expense" label="Add recurring expense">
          <div className="panel-heading">
            <h2>New recurring expense</h2>
          </div>
          <ScheduleForm options={options} />
        </ActionPanel>
      </div>
      <HelpPanel title="How recurring expenses work">
        <p>
          Choose the first date you actually want recorded. Each action creates
          one unpaid bill, ready for receipt attachment and payment review.
          Earlier bills are not inferred. A backdated start can leave several
          due occurrences to work through individually.
        </p>
        <p>
          Monthly, quarterly and yearly schedules retain the original calendar
          day, using a shorter month’s last day when needed. Future dates cannot
          be generated early. Pausing preserves the next date; resuming may
          reveal overdue occurrences. Skips require a reason. Voiding a
          generated bill does not recreate it or rewind the schedule.
        </p>
        <p>
          This workflow is operator-started. The automatic invoice scheduler
          does not generate expenses. Amounts are estimates to review on the
          saved expense; no payment or stock receipt is assumed.
        </p>
      </HelpPanel>
      {!rows.length && (
        <section className="panel">
          <p>
            No recurring expenses yet. Add a schedule for a regular bill such as
            facility rent.
          </p>
        </section>
      )}
      {rows.map((row) => {
        const ended =
          Boolean(row.ends_on && row.next_date > row.ends_on) ||
          row.next_index >= 10000;
        const due = row.active && !ended && row.next_date <= date;
        return (
          <section className="panel" id={`recurring-${row.id}`} key={row.id}>
            <div className="panel-heading">
              <div>
                <h2>{row.name}</h2>
                <p className="muted form-hint">
                  {row.vendor || "No vendor"} · {row.category_name}
                  {row.horse_name ? ` · ${row.horse_name}` : " · Barn / shared"}
                </p>
              </div>
              <span className="tag">
                {!row.active
                  ? "Paused"
                  : ended
                    ? "Complete"
                    : due
                      ? "Due"
                      : "Upcoming"}
              </span>
            </div>
            <div className="record-form stack">
              <p>
                <strong>{money(row.amount_cents)}</strong> ·{" "}
                {frequencies.find((f) => f[0] === row.cadence)?.[1]}
                {!ended ? ` · Next bill ${dateLabel(row.next_date)}` : ""}
              </p>
              <div className="row-actions">
                {due && (
                  <form action={recurringExpenseAction.bind(null, "prepare")}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="revision" value={row.revision} />
                    <input
                      type="hidden"
                      name="next_date"
                      value={row.next_date}
                    />
                    <input
                      type="hidden"
                      name="request_id"
                      value={crypto.randomUUID()}
                    />
                    <SubmitButton>Create due bill</SubmitButton>
                  </form>
                )}
                <ActionPanel id={`edit-${row.id}`} label="Edit schedule">
                  <div className="panel-heading">
                    <h2>Edit {row.name}</h2>
                  </div>
                  <ScheduleForm row={row} options={options} />
                </ActionPanel>
                {due && (
                  <ActionPanel id={`skip-${row.id}`} label="Skip occurrence">
                    <form
                      action={recurringExpenseAction.bind(null, "skip")}
                      className="record-form"
                    >
                      <h2>Skip {dateLabel(row.next_date)}</h2>
                      <input type="hidden" name="id" value={row.id} />
                      <input
                        type="hidden"
                        name="revision"
                        value={row.revision}
                      />
                      <input
                        type="hidden"
                        name="next_date"
                        value={row.next_date}
                      />
                      <input
                        type="hidden"
                        name="request_id"
                        value={crypto.randomUUID()}
                      />
                      <Field
                        label="Reason for skipping"
                        name="reason"
                        required
                        maxLength={2000}
                      />
                      <div className="form-actions">
                        <ConfirmButton
                          className="button secondary"
                          message="Skip this occurrence? No expense will be created, and its reason will remain in history."
                        >
                          Skip this bill
                        </ConfirmButton>
                      </div>
                    </form>
                  </ActionPanel>
                )}
              </div>
              <details>
                <summary>Recent occurrences</summary>
                <div className="stack feed-comparison-detail">
                  {!row.history.length ? (
                    <p className="muted">No bills or skips recorded.</p>
                  ) : (
                    row.history.map((h) => (
                      <div key={h.id}>
                        <p>
                          {dateLabel(h.expense_date)} ·{" "}
                          {h.skipped_reason
                            ? `Skipped: ${h.skipped_reason}`
                            : h.voided_at
                              ? "Bill voided"
                              : h.paid_on
                                ? `Paid ${dateLabel(h.paid_on)}`
                                : "Unpaid bill"}
                        </p>
                        {h.expense_id && (
                          <Link
                            className="text-link"
                            href={`/admin/expenses/${h.expense_id}`}
                          >
                            View expense
                          </Link>
                        )}
                      </div>
                    ))
                  )}
                  <small className="muted">
                    Latest five occurrences. All generated bills remain in
                    Expenses.
                  </small>
                </div>
              </details>
            </div>
          </section>
        );
      })}
    </div>
  );
}
