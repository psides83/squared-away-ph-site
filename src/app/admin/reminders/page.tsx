import { AppSelect } from "@/components/app-select";
import { ReminderList } from "@/components/reminder-list";
import { reminderBuckets, reminderBucketLabels } from "@/lib/reminders";
import { SectionTabs } from "@/components/section-tabs";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, today } from "@/lib/format";
import { Field, Notice, PageHeading } from "@/components/ui";
import { DeleteButton, SubmitButton } from "@/components/submit-button";
import { deleteRecord, saveRecord } from "@/app/admin/actions";

export default async function Reminders({
  searchParams,
}: {
  searchParams: Promise<{
    horse?: string;
    category?: string;
    q?: string;
    bucket?: string;
    page?: string;
    new?: string;
    edit?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const date = today();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.page) || 1)),
  );
  const filterHorse = /^[0-9a-f-]{36}$/i.test(params.horse ?? "")
    ? params.horse
    : undefined;
  const filterCategory = /^[0-9a-f-]{36}$/i.test(params.category ?? "")
    ? params.category
    : undefined;
  const search = (params.q ?? "").trim().slice(0, 200);
  const views = await Promise.all(
    reminderBuckets.map(async (bucket) => {
      const currentPage = params.bucket === bucket ? page : 1;
      let query = db
        .from("reminders")
        .select("*", { count: "exact" })
        .range((currentPage - 1) * 25, currentPage * 25 - 1);
      if (bucket === "completed")
        query = query
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .order("id");
      else {
        query = query.is("completed_at", null).order("due_date").order("id");
        query =
          bucket === "overdue"
            ? query.lt("due_date", date)
            : bucket === "today"
              ? query.eq("due_date", date)
              : query.gt("due_date", date);
      }
      if (filterHorse) query = query.eq("horse_id", filterHorse);
      if (filterCategory) query = query.eq("category_id", filterCategory);
      if (params.horse === "general") query = query.is("horse_id", null);
      if (params.category === "none") query = query.is("category_id", null);
      if (search)
        query = query.ilike("title", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
      return { bucket, page: currentPage, ...(await query) };
    }),
  );
  const [categories, horses, editing] = await Promise.all([
    db.from("reminder_categories").select("id,name").order("name"),
    db.from("horses").select("id,barn_name").order("barn_name"),
    params.edit && /^[0-9a-f-]{36}$/i.test(params.edit)
      ? db.from("reminders").select("*").eq("id", params.edit).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const selected = editing.data;
  const failed =
    views.some((v) => v.error) ||
    categories.error ||
    horses.error ||
    editing.error;
  const defaultBucket = reminderBuckets.includes(
    params.bucket as (typeof reminderBuckets)[number],
  )
    ? params.bucket
    : (views.find((v) => Number(v.count) > 0)?.bucket ?? "today");
  const closeHref = filterHorse
    ? `/admin/horses/${filterHorse}#horse-reminders`
    : "/admin/reminders";
  const pageHref = (bucket: string, p: number) =>
    `/admin/reminders?${new URLSearchParams({ bucket, page: String(p), ...(params.horse ? { horse: params.horse } : {}), ...(params.category ? { category: params.category } : {}), ...(search ? { q: search } : {}) })}#reminders-${bucket}`;
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE PLANNING GOES A LONG WAY"
        title="Reminders"
        description="Care appointments, barn tasks, and the things worth remembering."
        action={{
          href: `/admin/reminders?${new URLSearchParams({ new: "1", ...(filterHorse ? { horse: filterHorse } : {}), ...(filterCategory ? { category: filterCategory } : {}) })}#record-form`,
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
        <ActionPanel
          id="record-form"
          label="Reminder details"
          defaultOpen
          closeHref={closeHref}
        >
          <div className="panel-heading">
            <h2>
              {selected ? "Edit reminder" : "Take it off your mental list"}
            </h2>
            <Link
              className="dialog-close"
              href={closeHref}
              aria-label="Close reminder form"
            >
              <X size={20} />
            </Link>
          </div>
          <form
            action={saveRecord.bind(null, "reminders")}
            className="record-form"
          >
            <input type="hidden" name="id" value={selected?.id ?? ""} />
            {filterHorse &&
              (!selected || selected.horse_id === filterHorse) && (
                <input type="hidden" name="horse_context" value={filterHorse} />
              )}
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
                <AppSelect
                  name="horse_id"
                  defaultValue={selected?.horse_id ?? filterHorse ?? ""}
                >
                  <option value="">General barn reminder</option>
                  {horses.data?.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.barn_name}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label>
                Category
                <AppSelect
                  name="category_id"
                  defaultValue={selected?.category_id ?? filterCategory ?? ""}
                >
                  <option value="">Uncategorized</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </AppSelect>
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
              <Link href={closeHref} className="text-button">
                Cancel
              </Link>
            </div>
          </form>
        </ActionPanel>
      )}
      <form
        action="/admin/reminders"
        className="panel record-form reminder-filter"
      >
        <div className="form-grid">
          <Field
            name="q"
            label="Find a reminder"
            defaultValue={search}
            maxLength={200}
          />
          <label>
            Horse
            <AppSelect name="horse" defaultValue={params.horse ?? ""}>
              <option value="">All horses and barn tasks</option>
              <option value="general">General barn</option>
              {horses.data?.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.barn_name}
                </option>
              ))}
            </AppSelect>
          </label>
          <label>
            Category
            <AppSelect name="category" defaultValue={params.category ?? ""}>
              <option value="">All categories</option>
              <option value="none">Uncategorized</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </AppSelect>
          </label>
        </div>
        <div className="form-actions">
          <button className="button secondary">Apply filters</button>
          <Link className="text-link" href="/admin/reminders">
            Clear
          </Link>
        </div>
      </form>
      <SectionTabs
        id="reminders"
        label="Reminder sections"
        defaultTab={defaultBucket}
        sections={[
          ...views.map((view) => ({
            id: view.bucket,
            label: `${reminderBucketLabels[view.bucket]} (${view.count ?? 0})`,
            content: (
              <section className="panel">
                <div className="panel-heading">
                  <h2>{reminderBucketLabels[view.bucket]} reminders</h2>
                  <span className="count-badge">{view.count ?? 0} tasks</span>
                </div>
                {view.error ? (
                  <p className="notice error">
                    This reminder list could not load.
                  </p>
                ) : view.data?.length ? (
                  <ReminderList
                    reminders={view.data}
                    horses={horses.data ?? []}
                    categories={categories.data ?? []}
                    date={date}
                    returnFilters={{
                      horse: params.horse,
                      category: params.category,
                      q: search,
                      bucket: view.bucket,
                    }}
                  />
                ) : (
                  <p className="record-form muted">
                    No reminders in this view.
                  </p>
                )}
                {((view.count ?? 0) > 25 || view.page > 1) && (
                  <nav
                    className="log-pagination"
                    aria-label={`${view.bucket} reminder pages`}
                  >
                    {view.page > 1 ? (
                      <Link
                        className="button secondary"
                        href={pageHref(view.bucket, view.page - 1)}
                      >
                        Previous
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span>Page {view.page}</span>
                    {view.page * 25 < (view.count ?? 0) ? (
                      <Link
                        className="button secondary"
                        href={pageHref(view.bucket, view.page + 1)}
                      >
                        Next
                      </Link>
                    ) : (
                      <span />
                    )}
                  </nav>
                )}
              </section>
            ),
          })),
          {
            id: "categories",
            label: "Categories",
            content: (
              <>
                <section className="panel" id="reminder-categories">
                  <div className="panel-heading">
                    <h2>Your categories</h2>
                  </div>
                  <div className="category-content">
                    <p className="muted">
                      Make this list fit your barn. Rename, add, or remove
                      categories anytime.
                    </p>
                    {categories.data?.map((category) => (
                      <div className="category-row" key={category.id}>
                        <form
                          action={saveRecord.bind(null, "reminder_categories")}
                        >
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
                          <SubmitButton className="text-button">
                            Save
                          </SubmitButton>
                        </form>
                        <form
                          action={deleteRecord.bind(
                            null,
                            "reminder_categories",
                          )}
                        >
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
              </>
            ),
          },
        ]}
      />
    </>
  );
}
