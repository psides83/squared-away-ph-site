import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { BookOpen, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, today } from "@/lib/format";
import { identifier } from "@/lib/validation";
import { EmptyState, Field, Notice, PageHeading } from "@/components/ui";
import { DeleteButton, SubmitButton } from "@/components/submit-button";
import { TrainingEntryFields } from "@/components/training-entry-fields";
import { deleteRecord, saveRecord } from "@/app/admin/actions";

export default async function TrainingLog({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    edit?: string;
    horse?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const filterForm = new FormData();
  filterForm.set("horse", params.horse ?? "");
  let horseId: string | null = null;
  let filterError: string | undefined;
  try {
    horseId = identifier(filterForm, "horse");
  } catch {
    filterError = "Please select a valid horse.";
  }
  const page = Math.max(
    1,
    Math.min(
      10000,
      Number.isInteger(Number(params.page)) ? Number(params.page) : 1,
    ),
  );
  const pageSize = 25;
  let query = db
    .from("training_entries")
    .select("*", { count: "exact" })
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (horseId) query = query.eq("horse_id", horseId);
  const [entries, horses, editing] = await Promise.all([
    query,
    db.from("horses").select("id, barn_name").order("barn_name"),
    params.edit && /^[0-9a-f-]{36}$/i.test(params.edit)
      ? db
          .from("training_entries")
          .select("*")
          .eq("id", params.edit)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const selected = editing.data;
  const failed = entries.error || horses.error || editing.error;
  const selectedHorse = horses.data?.find((h) => h.id === horseId);
  if (horseId && !horses.error && !selectedHorse)
    filterError =
      "That horse could not be found. Choose another horse or clear the filter.";
  const queryFor = (nextPage: number) =>
    `/admin/log?${new URLSearchParams({ ...(horseId ? { horse: horseId } : {}), page: String(nextPage) })}`;
  const addLink = `/admin/log?new=1${horseId ? `&horse=${horseId}` : ""}#record-form`;
  return (
    <>
      <PageHeading
        eyebrow="ONE RIDE AT A TIME"
        title="Training log"
        description="Record the work, notice the progress, and remember what comes next."
        action={{ href: addLink, label: "Add an entry" }}
      />
      <Notice
        error={
          failed
            ? "The training log couldn’t load. Confirm the latest Supabase migration has been applied, then refresh."
            : filterError ||
              params.error ||
              (params.edit && !selected
                ? "That entry could not be found."
                : undefined)
        }
        success={params.success}
      />
      {(params.new === "1" || selected) &&
        !failed &&
        (horses.data?.length ? (
          <ActionPanel
            id="record-form"
            label="Training entry"
            defaultOpen
            closeHref="/admin/log"
          >
            <div className="panel-heading">
              <h2>
                {selected ? "Edit your entry" : "Put the day’s work on paper"}
              </h2>
              <Link
                href={horseId ? `/admin/log?horse=${horseId}` : "/admin/log"}
                aria-label="Close entry form"
              >
                <X size={20} />
              </Link>
            </div>
            <form
              action={saveRecord.bind(null, "training_entries")}
              className="record-form"
            >
              <input type="hidden" name="id" value={selected?.id ?? ""} />
              <div className="form-grid">
                <label>
                  Horse <span className="required">*</span>
                  <select
                    name="horse_id"
                    required
                    defaultValue={selected?.horse_id ?? selectedHorse?.id ?? ""}
                  >
                    <option value="" disabled>
                      Select a horse
                    </option>
                    {horses.data.map((horse) => (
                      <option key={horse.id} value={horse.id}>
                        {horse.barn_name}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label="Date"
                  name="entry_date"
                  type="date"
                  required
                  defaultValue={selected?.entry_date ?? today()}
                />
                <TrainingEntryFields
                  key={selected?.id ?? "new"}
                  initialKind={selected?.kind ?? "session"}
                  duration={selected?.duration_minutes}
                />
                <Field
                  label="Focus / title"
                  name="title"
                  required
                  defaultValue={selected?.title}
                  placeholder="e.g. Rating cattle and staying quiet"
                />
              </div>
              <label>
                Notes <span className="required">*</span>
                <textarea
                  name="notes"
                  required
                  rows={5}
                  maxLength={5000}
                  defaultValue={selected?.notes ?? ""}
                  placeholder="What you worked on, what improved, and what to work on next."
                />
              </label>
              <p className="muted form-hint">
                Private barn notes. These entries are not shared with customers.
              </p>
              <div className="form-actions">
                <SubmitButton>
                  {selected ? "Save changes" : "Save entry"}
                </SubmitButton>
                <Link href="/admin/log" className="text-button">
                  Cancel
                </Link>
              </div>
            </form>
          </ActionPanel>
        ) : (
          <p className="notice">
            First <Link href="/admin/horses?new=1">add a horse</Link> to begin
            their training log.
          </p>
        ))}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">THE WORK ADDS UP</p>
            <h2>
              {selectedHorse
                ? `${selectedHorse.barn_name}’s history`
                : "From the training pen"}
            </h2>
          </div>
          <span className="count-badge">{entries.count ?? 0} entries</span>
        </div>
        <form action="/admin/log" className="log-filter">
          <label>
            Show horse
            <select name="horse" defaultValue={horseId ?? ""}>
              <option value="">All horses</option>
              {horses.data?.map((horse) => (
                <option key={horse.id} value={horse.id}>
                  {horse.barn_name}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary">Apply filter</button>
          {params.horse && (
            <Link className="text-link" href="/admin/log">
              Clear
            </Link>
          )}
        </form>
        {!failed &&
          !filterError &&
          (entries.data?.length ? (
            entries.data.map((entry) => (
              <article className="log-entry" key={entry.id}>
                <div className="log-entry-heading">
                  <div>
                    <p className="eyebrow">
                      {horses.data?.find((horse) => horse.id === entry.horse_id)
                        ?.barn_name ?? "Horse"}{" "}
                      · {dateLabel(entry.entry_date)}
                    </p>
                    <h3>{entry.title}</h3>
                  </div>
                  <span className="tag">
                    {entry.kind === "session"
                      ? "Training session"
                      : "Progress note"}
                    {entry.duration_minutes
                      ? ` · ${entry.duration_minutes} min`
                      : ""}
                  </span>
                </div>
                <p className="log-notes">{entry.notes}</p>
                <div className="row-actions">
                  <Link
                    className="text-button"
                    href={`/admin/log?edit=${entry.id}${horseId ? `&horse=${horseId}` : ""}#record-form`}
                  >
                    Edit
                  </Link>
                  <form action={deleteRecord.bind(null, "training_entries")}>
                    <input type="hidden" name="id" value={entry.id} />
                    <DeleteButton confirmText="Delete this training entry? This cannot be undone." />
                  </form>
                </div>
              </article>
            ))
          ) : (
            <EmptyState
              icon={BookOpen}
              title="Every ride tells you something."
              description={
                selectedHorse
                  ? "This horse has no entries on this page yet. Record a session or a progress note to begin their history."
                  : "Capture a training session or a quick note so the useful details don’t get left in the arena."
              }
              href={addLink}
              label="Add a training entry"
            />
          ))}
        {!failed &&
          !filterError &&
          ((entries.count ?? 0) > pageSize || page > 1) && (
            <nav className="log-pagination" aria-label="Training log pages">
              {page > 1 ? (
                <Link className="text-link" href={queryFor(page - 1)}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="muted">Page {page}</span>
              {page * pageSize < (entries.count ?? 0) ? (
                <Link className="text-link" href={queryFor(page + 1)}>
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
      </section>
    </>
  );
}
