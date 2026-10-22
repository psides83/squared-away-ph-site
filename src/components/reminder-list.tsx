import Link from "next/link";
import { dateLabel } from "@/lib/format";
import { reminderStatus, reminderBucketLabels } from "@/lib/reminders";
import { updateReminder } from "@/app/admin/reminders/actions";
import { deleteRecord } from "@/app/admin/actions";
import { SubmitButton, DeleteButton } from "@/components/submit-button";
export type ReminderRow = {
  id: string;
  title: string;
  horse_id: string | null;
  category_id: string | null;
  due_date: string;
  completed_at: string | null;
  notes: string | null;
};
export function ReminderList({
  reminders,
  horses,
  categories,
  date,
  horseContext,
  returnFilters,
}: {
  reminders: ReminderRow[];
  horses: { id: string; barn_name: string }[];
  categories: { id: string; name: string }[];
  date: string;
  horseContext?: string;
  returnFilters?: {
    horse?: string;
    category?: string;
    q?: string;
    bucket?: string;
  };
}) {
  const returnFields = returnFilters
    ? Object.entries(returnFilters).map(([key, value]) =>
        value ? (
          <input key={key} type="hidden" name={`view_${key}`} value={value} />
        ) : null,
      )
    : null;
  return (
    <>
      {reminders.map((r) => (
        <article
          key={r.id}
          className={`reminder-item ${r.completed_at ? "completed" : ""}`}
        >
          <div className="reminder-item-head">
            <h3>{r.title}</h3>
            <span className="tag">
              {reminderBucketLabels[reminderStatus(r, date)]}
            </span>
          </div>
          <div className="reminder-meta">
            <span>{dateLabel(r.due_date)}</span>
            <span>·</span>
            {r.horse_id ? (
              <Link
                className="text-link"
                href={`/admin/horses/${r.horse_id}#horse-reminders`}
              >
                {horses.find((h) => h.id === r.horse_id)?.barn_name ??
                  "Horse record"}
              </Link>
            ) : (
              <span>General barn</span>
            )}
            <span>·</span>
            <span>
              {categories.find((c) => c.id === r.category_id)?.name ??
                "Uncategorized"}
            </span>
          </div>
          {r.notes && <p className="muted log-notes">{r.notes}</p>}
          <div className="row-actions reminder-quick-actions">
            <form action={updateReminder.bind(null, "complete")}>
              {returnFields}
              <input name="id" type="hidden" value={r.id} />
              <input
                name="complete"
                type="hidden"
                value={r.completed_at ? "no" : "yes"}
              />
              {horseContext && (
                <input
                  name="horse_context"
                  type="hidden"
                  value={horseContext}
                />
              )}
              <SubmitButton className="button secondary">
                {r.completed_at ? "Reopen" : "Mark complete"}
              </SubmitButton>
            </form>
            {!r.completed_at &&
              r.due_date <= date &&
              [1, 7].map((days) => (
                <form action={updateReminder.bind(null, "postpone")} key={days}>
                  {returnFields}
                  <input name="id" type="hidden" value={r.id} />
                  <input name="days" type="hidden" value={days} />
                  <input
                    name="expected_due_date"
                    type="hidden"
                    value={r.due_date}
                  />
                  {horseContext && (
                    <input
                      name="horse_context"
                      type="hidden"
                      value={horseContext}
                    />
                  )}
                  <SubmitButton className="text-button">
                    {days === 1 ? "Move to tomorrow" : "Move to next week"}
                  </SubmitButton>
                </form>
              ))}
            <Link
              className="text-button"
              href={`/admin/reminders?edit=${r.id}${horseContext ? `&horse=${horseContext}` : ""}#record-form`}
            >
              Edit
            </Link>
            {!horseContext && (
              <form action={deleteRecord.bind(null, "reminders")}>
                {returnFields}
                <input name="id" type="hidden" value={r.id} />
                <DeleteButton />
              </form>
            )}
          </div>
        </article>
      ))}
    </>
  );
}
