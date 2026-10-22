import {
  DailyFeedingBatch,
  ExtraFeedingBatch,
} from "@/components/bulk-feeding";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel } from "@/lib/format";
import { PageHeading, Notice, Field } from "@/components/ui";
import { SubmitButton, DeleteButton } from "@/components/submit-button";
import { ProductUnitFields } from "@/components/stock-forms";
import {
  saveRation,
  deleteRation,
  confirmFeeding,
} from "@/app/admin/inventory/actions";

export default async function Feeding({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const [rations, horses, products, units, confirmations, todayConfirmations] =
    await Promise.all([
      db.from("feed_rations").select("*").order("horse_id"),
      db.from("horses").select("id,barn_name").order("barn_name"),
      db.from("inventory_products").select("*").order("name"),
      db.from("inventory_units").select("*"),
      db
        .from("feeding_confirmations")
        .select("*")
        .order("feeding_date", { ascending: false })
        .limit(50),
      db
        .from("feeding_confirmations")
        .select("horse_id")
        .eq("feeding_date", today()),
    ]);
  const selected = rations.data?.find((r) => r.id === params.edit);
  const failed = [
    rations,
    horses,
    products,
    units,
    confirmations,
    todayConfirmations,
  ].some((r) => r.error);
  return (
    <>
      <PageHeading
        eyebrow="A GOOD ROUTINE, A CLEAR RECORD"
        title="Daily feeding"
        description="Save the ration. Confirm what was actually fed. Keep stock in step with the barn."
      />
      <Notice
        error={
          failed
            ? "Feeding records couldn’t load. Check the latest migrations."
            : params.error ||
              (params.edit && !selected ? "Ration not found." : undefined)
        }
        success={params.success}
      />
      <p className="notice">
        One confirmation records the entire saved daily ration for a horse.
        Confirm only after it has actually been fed. Use{" "}
        <Link href="/admin/inventory#stock-entry">manual feeding entries</Link>{" "}
        for extras, partial feedings, or corrections.
      </p>
      {!failed && (
        <>
          <div className="feeding-actions">
            <ActionPanel id="batch-daily" label="Confirm daily rations in bulk">
              <DailyFeedingBatch
                date={today()}
                horses={(horses.data ?? [])
                  .filter((h) =>
                    rations.data?.some((r) => r.horse_id === h.id && r.active),
                  )
                  .map((h) => ({
                    ...h,
                    ration: (rations.data ?? [])
                      .filter((r) => r.horse_id === h.id && r.active)
                      .map(
                        (r) =>
                          `${Number(r.quantity)} ${units.data?.find((u) => u.id === r.unit_id)?.label ?? ""} ${products.data?.find((p) => p.id === r.product_id)?.name ?? ""}`,
                      )
                      .join(" · "),
                  }))}
              />
            </ActionPanel>
            <ActionPanel
              id="batch-extras"
              label="Record feedings for multiple horses"
            >
              <ExtraFeedingBatch
                date={today()}
                request={crypto.randomUUID()}
                horses={horses.data ?? []}
                products={products.data ?? []}
                units={units.data ?? []}
              />
            </ActionPanel>
          </div>
          <div className="horse-grid inventory-grid">
            {horses.data?.map((h) => {
              const active =
                rations.data?.filter((r) => r.horse_id === h.id && r.active) ??
                [];
              const confirmed = todayConfirmations.data?.some(
                (c) => c.horse_id === h.id,
              );
              return (
                <section className="horse-card" key={h.id}>
                  <h3>{h.barn_name}</h3>
                  <div className="horse-details">
                    {active.map((r) => (
                      <span key={r.id}>
                        {Number(r.quantity)}{" "}
                        {units.data?.find((u) => u.id === r.unit_id)?.label} ·{" "}
                        {
                          products.data?.find((p) => p.id === r.product_id)
                            ?.name
                        }
                      </span>
                    ))}
                    {!active.length && (
                      <span>No active daily ration saved.</span>
                    )}
                  </div>
                  {active.length > 0 && (
                    <>
                      <p className="muted">
                        {confirmed
                          ? "Today’s ration confirmed"
                          : "Not confirmed today"}
                      </p>
                      <ActionPanel
                        id={`feeding-${h.id}`}
                        label="Record daily feeding"
                      >
                        <form action={confirmFeeding} className="stack">
                          <input name="horse_id" type="hidden" value={h.id} />
                          <Field
                            name="feeding_date"
                            label="Actual feeding date"
                            type="date"
                            required
                            defaultValue={today()}
                            max={today()}
                          />
                          <SubmitButton>
                            {confirmed
                              ? "Today confirmed · safe to retry"
                              : "Confirm daily ration fed"}
                          </SubmitButton>
                        </form>
                      </ActionPanel>
                    </>
                  )}
                </section>
              );
            })}
          </div>
          <ActionPanel
            id="ration-form"
            label={selected ? "Edit daily ration" : "Add a daily ration"}
            defaultOpen={Boolean(selected)}
            closeHref="/admin/feeding"
          >
            <div className="panel-heading">
              <h2>
                {selected
                  ? "Edit daily ration line"
                  : "Add a daily ration line"}
              </h2>
            </div>
            {horses.data?.length && products.data?.some((p) => !p.archived) ? (
              <form
                action={saveRation}
                className="record-form"
                key={selected?.id ?? "new"}
              >
                <input type="hidden" name="id" value={selected?.id ?? ""} />
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
                      {horses.data.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.barn_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ProductUnitFields
                    products={products.data ?? []}
                    units={units.data ?? []}
                    initialProduct={selected?.product_id}
                    initialUnit={selected?.unit_id}
                  />
                  <Field
                    name="quantity"
                    label="Total daily quantity in selected unit"
                    type="number"
                    min={0.000001}
                    max={1000000000}
                    step="0.000001"
                    required
                    defaultValue={selected?.quantity}
                  />
                </div>
                <label className="inline-checkbox">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={selected?.active ?? true}
                  />
                  Active daily ration
                </label>
                <label>
                  Notes
                  <textarea
                    name="notes"
                    rows={3}
                    maxLength={2000}
                    defaultValue={selected?.notes ?? ""}
                  />
                </label>
                <p className="muted form-hint">
                  One line per horse/product. Saving the same horse and product
                  replaces its current ration, without changing previous feeding
                  records or deducting stock.
                </p>
                <SubmitButton>Save ration line</SubmitButton>
              </form>
            ) : (
              <p className="record-form muted">
                Add a horse and an active inventory product first.
              </p>
            )}
          </ActionPanel>
          <section className="panel">
            <div className="panel-heading">
              <h2>Saved rations</h2>
            </div>
            {rations.data?.map((r) => (
              <div className="record-form separated" key={r.id}>
                <strong>
                  {horses.data?.find((h) => h.id === r.horse_id)?.barn_name} ·{" "}
                  {products.data?.find((p) => p.id === r.product_id)?.name}
                </strong>
                <p>
                  {Number(r.quantity)}{" "}
                  {units.data?.find((u) => u.id === r.unit_id)?.label} daily ·{" "}
                  {r.active ? "Active" : "Paused"}
                </p>
                <div className="row-actions">
                  <Link
                    className="text-link"
                    href={`/admin/feeding?edit=${r.id}#ration-form`}
                  >
                    Edit
                  </Link>
                  <form action={deleteRation}>
                    <input name="id" type="hidden" value={r.id} />
                    <DeleteButton />
                  </form>
                </div>
              </div>
            ))}
            {!rations.data?.length && (
              <p className="record-form muted">No saved rations yet.</p>
            )}
          </section>
          <section className="panel management-details">
            <div className="panel-heading">
              <h2>Latest 50 daily confirmations</h2>
            </div>
            {confirmations.data?.map((c) => (
              <div className="record-row record-form" key={c.id}>
                <strong>
                  {horses.data?.find((h) => h.id === c.horse_id)?.barn_name}
                </strong>
                <span>{dateLabel(c.feeding_date)}</span>
              </div>
            ))}
            {!confirmations.data?.length && (
              <p className="record-form muted">
                No confirmed daily feedings yet.
              </p>
            )}
            <p className="record-form muted form-hint">
              For transaction details, extras, or reversals, open{" "}
              <Link href="/admin/inventory" className="text-link">
                stock history
              </Link>
              .
            </p>
          </section>
        </>
      )}
    </>
  );
}
