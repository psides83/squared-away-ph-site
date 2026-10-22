import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { ArrowUpRight, Fence, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { EmptyState, Field, Notice, PageHeading } from "@/components/ui";
import { DeleteButton, SubmitButton } from "@/components/submit-button";
import { deleteRecord, saveRecord } from "@/app/admin/actions";
import { CustomerPicker } from "@/components/customer-picker";

export default async function Horses({
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
  const [horses, customers, relationships] = await Promise.all([
    db.from("horses").select("*").order("barn_name"),
    db.from("customers").select("id, name").order("name"),
    db.from("horse_customers").select("horse_id, customer_id"),
  ]);
  const { data } = horses;
  const error = horses.error || customers.error || relationships.error;
  const selected = data?.find((row) => row.id === params.edit);
  const showForm = params.new === "1" || Boolean(selected);
  return (
    <>
      <PageHeading
        eyebrow="THE HEART OF THE OPERATION"
        title="Your horses"
        description="Every horse has a story. Keep the important parts together."
        action={{
          href: "/admin/horses?new=1#record-form",
          label: "Add a horse",
        }}
      />
      <Notice
        error={
          error
            ? "Horses could not be loaded. Check your database setup and refresh."
            : params.error ||
              (params.edit && !selected
                ? "That horse could not be found."
                : undefined)
        }
        success={params.success}
      />
      {showForm && !error && !customers.data?.length && (
        <p className="notice">
          Add a customer before adding or updating a horse.{" "}
          <Link href="/admin/customers?new=1#record-form">
            Add your first customer
          </Link>
          .
        </p>
      )}
      {showForm && !error && Boolean(customers.data?.length) && (
        <ActionPanel
          id="record-form"
          label="Horse details"
          defaultOpen
          closeHref="/admin/horses"
        >
          <div className="panel-heading">
            <h2>
              {selected
                ? `About ${selected.barn_name}`
                : "Meet your next good horse"}
            </h2>
            <Link href="/admin/horses" aria-label="Close horse form">
              <X size={20} />
            </Link>
          </div>
          <form
            action={saveRecord.bind(null, "horses")}
            className="record-form"
          >
            <input type="hidden" name="id" value={selected?.id ?? ""} />
            <CustomerPicker
              key={selected?.id ?? "new"}
              customers={customers.data ?? []}
              selectedIds={(relationships.data ?? [])
                .filter((link) => link.horse_id === selected?.id)
                .map((link) => link.customer_id)}
            />
            <div className="form-grid">
              <Field
                name="barn_name"
                label="Barn name"
                required
                defaultValue={selected?.barn_name}
              />
              <Field
                name="registered_name"
                label="Registered name"
                defaultValue={selected?.registered_name}
              />
              <Field
                name="registration_number"
                label="Registration number"
                defaultValue={selected?.registration_number}
                maxLength={100}
              />
              <Field
                name="breed"
                label="Breed"
                defaultValue={selected?.breed}
                placeholder="e.g. American Quarter Horse"
                maxLength={100}
              />
              <Field
                name="birth_year"
                label="Birth year"
                type="number"
                min={1900}
                max={new Date().getFullYear()}
                defaultValue={selected?.birth_year}
              />
              <label>
                Sex
                <select name="sex" defaultValue={selected?.sex ?? "unknown"}>
                  <option value="unknown">Not specified</option>
                  <option value="mare">Mare</option>
                  <option value="gelding">Gelding</option>
                  <option value="stallion">Stallion</option>
                </select>
              </label>
            </div>
            {[
              {
                name: "training_goals",
                label: "Training goals",
                placeholder: "What are we working toward?",
              },
              {
                name: "feeding_instructions",
                label: "Feeding instructions",
                placeholder:
                  "Special care or feeding notes. Set quantities in the horse’s Feeding plan tab.",
              },
              {
                name: "health_notes",
                label: "Private health notes",
                placeholder:
                  "Conditions, sensitivities, and care instructions.",
              },
            ].map((field) => (
              <label key={field.name}>
                {field.label}
                <textarea
                  name={field.name}
                  rows={3}
                  maxLength={5000}
                  defaultValue={selected?.[field.name] ?? ""}
                  placeholder={field.placeholder}
                />
              </label>
            ))}
            <p className="muted form-hint">
              Update the customers here if the horse is sold. Billing customers
              on existing training stays remain unchanged.
            </p>
            <div className="form-actions">
              <SubmitButton>
                {selected ? "Save horse" : "Add horse"}
              </SubmitButton>
              <Link href="/admin/horses" className="text-button">
                Cancel
              </Link>
            </div>
          </form>
        </ActionPanel>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>The horse book</h2>
          <span className="count-badge">{data?.length ?? 0} on file</span>
        </div>
        {data?.length ? (
          <div className="horse-grid">
            {data.map((horse) => (
              <article className="horse-card" key={horse.id}>
                <div className="horse-card-top">
                  <span className="horse-initial large">
                    {horse.barn_name.slice(0, 1)}
                  </span>
                  <span className="tag">
                    {horse.sex === "unknown" ? "Horse" : horse.sex}
                  </span>
                </div>
                <h3>
                  <Link href={`/admin/horses?edit=${horse.id}#record-form`}>
                    {horse.barn_name}
                    <ArrowUpRight size={17} />
                  </Link>
                </h3>
                <p className="muted">
                  {horse.registered_name || "Registered name not added"}
                </p>
                <div className="horse-details">
                  <Link
                    className="text-link"
                    href={`/admin/log?horse=${horse.id}`}
                  >
                    Training history
                  </Link>
                  <Link
                    className="text-link"
                    href={`/admin/log?horse=${horse.id}&new=1#record-form`}
                  >
                    Log a session / note
                  </Link>
                  <span>
                    Customers:{" "}
                    {(relationships.data ?? [])
                      .filter((link) => link.horse_id === horse.id)
                      .map(
                        (link) =>
                          customers.data?.find(
                            (customer) => customer.id === link.customer_id,
                          )?.name,
                      )
                      .filter(Boolean)
                      .join(", ") || "Not assigned — edit to add"}
                  </span>
                  <span>{horse.breed || "Breed not added"}</span>
                  <span>
                    {horse.birth_year
                      ? `Born ${horse.birth_year}`
                      : "Birth year not added"}
                  </span>
                </div>
                <div className="row-actions">
                  <Link
                    href={`/admin/horses/${horse.id}`}
                    className="text-link"
                  >
                    View horse record
                  </Link>
                  <Link
                    className="text-link"
                    href={`/admin/horses/${horse.id}#horse-rations`}
                  >
                    Feeding plan
                  </Link>
                  <form action={deleteRecord.bind(null, "horses")}>
                    <input type="hidden" name="id" value={horse.id} />
                    <DeleteButton />
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : (
          !error && (
            <EmptyState
              icon={Fence}
              title="Every good horse deserves good records."
              description="Select a customer and add a barn name. Fill in registration, feeding, health, and training details as you go."
              href="/admin/horses?new=1#record-form"
              label="Add your first horse"
            />
          )
        )}
      </section>
    </>
  );
}
