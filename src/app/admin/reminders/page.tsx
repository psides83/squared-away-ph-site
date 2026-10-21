import Link from "next/link";
import { CalendarDays, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, today } from "@/lib/format";
import { EmptyState, Field, Notice, PageHeading } from "@/components/ui";
import { DeleteButton, SubmitButton } from "@/components/submit-button";
import { deleteRecord, saveRecord, toggleReminder } from "@/app/admin/actions";

export default async function Reminders({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    edit?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const [reminders, categories, horses] = await Promise.all([
    db.from("reminders").select("*").order("due_date"),
    db.from("reminder_categories").select("id, name").order("name"),
    db.from("horses").select("id, barn_name").order("barn_name"),
  ]);
  const selected = reminders.data?.find((row) => row.id === params.edit);
  const failed = reminders.error || categories.error || horses.error;
  const sorted = [...(reminders.data ?? [])].sort(
    (a, b) =>
      Number(Boolean(a.completed_at)) - Number(Boolean(b.completed_at)) ||
      a.due_date.localeCompare(b.due_date),
  );
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE PLANNING GOES A LONG WAY"
        title="Reminders"
        description="Care appointments, barn tasks, and the things worth remembering."
        action={{
          href: "/admin/reminders?new=1#record-form",
          label: "Add a reminder",
        }}
      />
      <Notice
        error={
          failed
            ? "Reminders could not be loaded. Check your database setup and refresh."
            : params.error ||
              (params.edit && !selected
                ? "That reminder could not be found."
                : undefined)
        }
        success={params.success}
      />
      {(params.new === "1" || selected) && (
        <section className="panel editor-panel" id="record-form">
          <div className="panel-heading">
            <h2>
              {selected ? "Edit reminder" : "Take it off your mental list"}
            </h2>
            <Link href="/admin/reminders" aria-label="Close reminder form">
              <X size={20} />
            </Link>
          </div>
          <form
            action={saveRecord.bind(null, "reminders")}
            className="record-form"
          >
            <input type="hidden" name="id" value={selected?.id ?? ""} />
            <div className="form-grid">
              <Field
                name="title"
                label="What needs doing?"
                required
                defaultValue={selected?.title}
                placeholder="e.g. Schedule farrier visit"
              />
              <Field
                name="due_date"
                label="Due date"
                type="date"
                required
                defaultValue={selected?.due_date ?? today()}
              />
              <label>
                Horse
                <select name="horse_id" defaultValue={selected?.horse_id ?? ""}>
                  <option value="">General barn reminder</option>
                  {horses.data?.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.barn_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  name="category_id"
                  defaultValue={selected?.category_id ?? ""}
                >
                  <option value="">Uncategorized</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Private notes
              <textarea
                name="notes"
                rows={3}
                maxLength={5000}
                defaultValue={selected?.notes ?? ""}
              />
            </label>
            <p className="muted form-hint">
              Reminders appear in your office. Email and push notifications are
              not enabled.
            </p>
            <div className="form-actions">
              <SubmitButton>
                {selected ? "Save changes" : "Create reminder"}
              </SubmitButton>
              <Link href="/admin/reminders" className="text-button">
                Cancel
              </Link>
            </div>
          </form>
        </section>
      )}
      <div className="reminder-layout">
        <section className="panel">
          <div className="panel-heading">
            <h2>On your radar</h2>
            <span className="count-badge">
              {sorted.filter((r) => !r.completed_at).length} open
            </span>
          </div>
          {sorted.length
            ? sorted.map((reminder) => (
                <article
                  key={reminder.id}
                  className={`reminder-item ${reminder.completed_at ? "completed" : ""}`}
                >
                  <div className="reminder-item-head">
                    <h3>{reminder.title}</h3>
                    <span className="tag">
                      {reminder.completed_at
                        ? "Completed"
                        : reminder.due_date < today()
                          ? "Overdue"
                          : reminder.due_date === today()
                            ? "Today"
                            : "Upcoming"}
                    </span>
                  </div>
                  <div className="reminder-meta">
                    <span>{dateLabel(reminder.due_date)}</span>
                    <span>·</span>
                    <span>
                      {horses.data?.find((h) => h.id === reminder.horse_id)
                        ?.barn_name ?? "General barn"}
                    </span>
                    <span>·</span>
                    <span>
                      {categories.data?.find(
                        (c) => c.id === reminder.category_id,
                      )?.name ?? "Uncategorized"}
                    </span>
                  </div>
                  {reminder.notes && <p className="muted">{reminder.notes}</p>}
                  <div className="row-actions">
                    <form action={toggleReminder}>
                      <input type="hidden" name="id" value={reminder.id} />
                      <input
                        type="hidden"
                        name="complete"
                        value={reminder.completed_at ? "no" : "yes"}
                      />
                      <SubmitButton className="text-button">
                        {reminder.completed_at ? "Reopen" : "Mark complete"}
                      </SubmitButton>
                    </form>
                    <Link
                      className="text-button"
                      href={`/admin/reminders?edit=${reminder.id}#record-form`}
                    >
                      Edit
                    </Link>
                    <form action={deleteRecord.bind(null, "reminders")}>
                      <input type="hidden" name="id" value={reminder.id} />
                      <DeleteButton />
                    </form>
                  </div>
                </article>
              ))
            : !failed && (
                <EmptyState
                  icon={CalendarDays}
                  title="A clear head for the work ahead."
                  description="Add a farrier visit, a vaccination date, or any task you want to keep on your radar."
                  href="/admin/reminders?new=1#record-form"
                  label="Create your first reminder"
                />
              )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Your categories</h2>
          </div>
          <div className="category-content">
            <p className="muted">
              Make this list fit your barn. Rename, add, or remove categories
              anytime.
            </p>
            {categories.data?.map((category) => (
              <div className="category-row" key={category.id}>
                <form action={saveRecord.bind(null, "reminder_categories")}>
                  <input type="hidden" name="id" value={category.id} />
                  <label>
                    <span className="sr-only">Category name</span>
                    <input
                      name="name"
                      required
                      maxLength={100}
                      defaultValue={category.name}
                    />
                  </label>
                  <SubmitButton className="text-button">Save</SubmitButton>
                </form>
                <form action={deleteRecord.bind(null, "reminder_categories")}>
                  <input type="hidden" name="id" value={category.id} />
                  <DeleteButton
                    label="Remove"
                    confirmText="Remove this category? Its reminders will stay and become uncategorized."
                  />
                </form>
              </div>
            ))}
            <form action={saveRecord.bind(null, "reminder_categories")}>
              <Field
                label="New category"
                name="name"
                required
                maxLength={100}
                placeholder="e.g. Dental"
              />
              <SubmitButton>Add category</SubmitButton>
            </form>
          </div>
        </section>
      </div>
    </>
  );
}
