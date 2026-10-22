import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, today } from "@/lib/format";
import { PageHeading, Notice, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { InvoiceConfirmButton } from "@/components/invoice-buttons";
import { saveCustomerUpdate, changeCustomerUpdate } from "./actions";
export default async function PublishedUpdates({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    edit?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const q = await searchParams;
  const { db } = await requireAdmin();
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q.page) || 1)));
  const [updates, horses, editing] = await Promise.all([
    db
      .from("horse_updates")
      .select("*", { count: "exact" })
      .order("update_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 25, page * 25 - 1),
    db.from("horses").select("id,barn_name").order("barn_name"),
    q.edit && /^[0-9a-f-]{36}$/i.test(q.edit)
      ? db.from("horse_updates").select("*").eq("id", q.edit).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const selected = editing.data;
  const history = selected
    ? await db
        .from("portal_admin_events")
        .select("id,kind,reason,created_at")
        .eq("update_id", selected.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  const failed = [updates, horses, editing, history].some((r) => r.error);
  return (
    <>
      <PageHeading
        eyebrow="KEEP OWNERS IN THE LOOP"
        title="Customer updates"
        description="Write updates deliberately for customers, then publish them when ready."
        action={{ href: "/admin/updates?new=1", label: "Write an update" }}
      />
      <Notice
        error={
          failed
            ? "Customer updates could not load. Check the latest migration."
            : q.error
        }
        success={q.success}
      />
      <p className="notice">
        Private training notes, health notes, and reminders stay private. These
        updates are separate customer-visible text. Only published updates are
        shared, and only with customers you grant horse access to in{" "}
        <Link href="/admin/portal">Customer portal access</Link>.
      </p>
      {!failed && (selected || q.new === "1") && (
        <section className="panel">
          <div className="panel-heading">
            <h2>
              {selected?.archived_at
                ? "Archived update"
                : selected?.published_at
                  ? "Published update"
                  : selected
                    ? "Edit draft"
                    : "New customer update"}
            </h2>
            <Link className="text-link" href="/admin/updates">
              Close
            </Link>
          </div>
          {!selected?.published_at && !selected?.archived_at ? (
            <form action={saveCustomerUpdate} className="record-form">
              <input
                name="request_id"
                type="hidden"
                value={crypto.randomUUID()}
              />
              <input name="id" type="hidden" value={selected?.id ?? ""} />
              <div className="form-grid">
                <label>
                  Horse
                  <select
                    name="horse_id"
                    required
                    defaultValue={selected?.horse_id ?? ""}
                  >
                    <option value="" disabled>
                      Select a horse
                    </option>
                    {horses.data?.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.barn_name}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label="Update date"
                  name="update_date"
                  type="date"
                  required
                  max={today()}
                  defaultValue={selected?.update_date ?? today()}
                />
              </div>
              <Field
                label="Customer-visible title"
                name="title"
                required
                maxLength={200}
                defaultValue={selected?.title}
              />
              <label>
                Customer-visible update
                <textarea
                  name="body"
                  required
                  maxLength={10000}
                  rows={8}
                  defaultValue={selected?.body ?? ""}
                />
              </label>
              <SubmitButton>Save draft</SubmitButton>
            </form>
          ) : (
            <article className="record-form">
              <p className="eyebrow">
                {
                  horses.data?.find((h) => h.id === selected.horse_id)
                    ?.barn_name
                }{" "}
                · {dateLabel(selected.update_date)}
              </p>
              <h3>{selected.title}</h3>
              <p className="preserve-lines">{selected.body}</p>
            </article>
          )}
          {selected && !selected.archived_at && (
            <div className="record-form separated">
              <h3>
                {selected.published_at
                  ? "Manage publication"
                  : "Review before publishing"}
              </h3>
              {!selected.published_at && (
                <>
                  <h4>{selected.title}</h4>
                  <p className="preserve-lines">{selected.body}</p>
                  <p className="muted">
                    Publishing shares this update with customers whose horse
                    access permits it. A customer’s starting-date filter uses
                    the publication date. Unpublish before editing; republishing
                    uses a new publication date.
                  </p>
                </>
              )}
              <form
                action={changeCustomerUpdate.bind(
                  null,
                  selected.published_at ? "unpublish" : "publish",
                )}
                className="stack"
              >
                <input name="id" type="hidden" value={selected.id} />
                <Field
                  name="reason"
                  label="Publication reason"
                  required
                  maxLength={2000}
                />
                <InvoiceConfirmButton
                  prompt={
                    selected.published_at
                      ? "Unpublish this update? Customers will no longer see it."
                      : "Publish this customer-visible update to customers with access to this horse?"
                  }
                >
                  {selected.published_at
                    ? "Unpublish update"
                    : "Publish to customers"}
                </InvoiceConfirmButton>
              </form>
              <form
                action={changeCustomerUpdate.bind(null, "archive")}
                className="stack separated"
              >
                <input name="id" type="hidden" value={selected.id} />
                <Field
                  name="reason"
                  label="Reason for archiving"
                  required
                  maxLength={2000}
                />
                <InvoiceConfirmButton prompt="Archive this update? It will be hidden from customers and its history retained.">
                  Archive update
                </InvoiceConfirmButton>
              </form>
            </div>
          )}
          {selected && (
            <div className="record-form separated">
              <h3>Update history (latest 20)</h3>
              {history.data?.map((e) => (
                <p key={e.id}>
                  {e.kind.replaceAll("_", " ")} · {e.reason}
                  <small className="cell-secondary">
                    {new Date(e.created_at).toLocaleString("en-US", {
                      timeZone: "America/Chicago",
                    })}{" "}
                    Central
                  </small>
                </p>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Updates for your customers</h2>
          <span className="count-badge">{updates.count ?? 0} records</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date / horse</th>
                <th>Title</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {updates.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    {dateLabel(u.update_date)}
                    <small className="cell-secondary">
                      {horses.data?.find((h) => h.id === u.horse_id)?.barn_name}
                    </small>
                  </td>
                  <td>{u.title}</td>
                  <td>
                    {u.archived_at
                      ? "Archived"
                      : u.published_at
                        ? "Published"
                        : "Draft"}
                  </td>
                  <td>
                    <Link
                      className="text-link"
                      href={`/admin/updates?edit=${u.id}`}
                    >
                      Review / edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!updates.data?.length && !failed && (
          <p className="record-form muted">
            Write your first customer update when you’re ready to share
            progress.
          </p>
        )}
        <nav className="log-pagination" aria-label="Customer update pages">
          {page > 1 ? (
            <Link href={`/admin/updates?page=${page - 1}`}>Previous</Link>
          ) : (
            <span />
          )}
          <span>Page {page}</span>
          {page * 25 < (updates.count ?? 0) ? (
            <Link href={`/admin/updates?page=${page + 1}`}>Next</Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}
