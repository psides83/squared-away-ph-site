import Link from "next/link";
import { UsersRound, X, ArrowUpRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { EmptyState, Field, Notice, PageHeading } from "@/components/ui";
import { DeleteButton, SubmitButton } from "@/components/submit-button";
import { deleteRecord, saveRecord } from "@/app/admin/actions";

export default async function Customers({
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
  const { data, error } = await db.from("customers").select("*").order("name");
  const selected = data?.find((row) => row.id === params.edit);
  const showForm = params.new === "1" || Boolean(selected);
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE HORSES"
        title="Customers"
        description="Good relationships start with keeping the details straight."
        action={{
          href: "/admin/customers?new=1#record-form",
          label: "Add a customer",
        }}
      />
      <Notice
        error={
          error
            ? "Customers could not be loaded. Check your database setup and refresh."
            : params.error ||
              (params.edit && !selected
                ? "That customer could not be found."
                : undefined)
        }
        success={params.success}
      />
      {showForm && (
        <section className="panel editor-panel" id="record-form">
          <div className="panel-heading">
            <h2>{selected ? "Edit customer" : "A new relationship"}</h2>
            <Link href="/admin/customers" aria-label="Close customer form">
              <X size={20} />
            </Link>
          </div>
          <form
            action={saveRecord.bind(null, "customers")}
            className="record-form"
          >
            <input type="hidden" name="id" value={selected?.id ?? ""} />
            <div className="form-grid">
              <Field
                label="Full name"
                name="name"
                required
                defaultValue={selected?.name}
              />
              <Field
                label="Email address"
                name="email"
                type="email"
                defaultValue={selected?.email}
                maxLength={254}
              />
              <Field
                label="Phone number"
                name="phone"
                type="tel"
                defaultValue={selected?.phone}
                maxLength={50}
              />
            </div>
            <label>
              Private notes
              <textarea
                name="notes"
                rows={3}
                maxLength={5000}
                defaultValue={selected?.notes ?? ""}
                placeholder="Contact preferences, billing details, and anything worth remembering."
              />
            </label>
            <div className="form-actions">
              <SubmitButton>
                {selected ? "Save changes" : "Add customer"}
              </SubmitButton>
              <Link href="/admin/customers" className="text-button">
                Cancel
              </Link>
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Your customers</h2>
          <span className="count-badge">{data?.length ?? 0} on file</span>
        </div>
        {data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link
                        className="record-name"
                        href={`/admin/customers?edit=${row.id}#record-form`}
                      >
                        {row.name}
                        <ArrowUpRight size={14} />
                      </Link>
                    </td>
                    <td>
                      <div className="contact-cell">
                        {row.email ? (
                          <a href={`mailto:${row.email}`}>{row.email}</a>
                        ) : (
                          <span className="muted">No email added</span>
                        )}
                        {row.phone && (
                          <a href={`tel:${row.phone}`}>{row.phone}</a>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link
                          className="text-button"
                          href={`/admin/customers?edit=${row.id}#record-form`}
                        >
                          Edit
                        </Link>
                        <form action={deleteRecord.bind(null, "customers")}>
                          <input type="hidden" name="id" value={row.id} />
                          <DeleteButton />
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !error && (
            <EmptyState
              icon={UsersRound}
              title="Make room for good people."
              description="Add your first customer, then connect them to a horse’s training stay."
              href="/admin/customers?new=1#record-form"
              label="Add your first customer"
            />
          )
        )}
      </section>
    </>
  );
}
