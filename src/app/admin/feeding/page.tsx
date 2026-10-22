import { FeedingTimeManager } from "@/components/feeding-time-manager";
import { SectionTabs } from "@/components/section-tabs";
import { SavedRations } from "@/components/saved-rations";
import Link from "next/link";
import {
  DailyFeedingBatch,
  ExtraFeedingBatch,
} from "@/components/bulk-feeding";
import { ActionPanel } from "@/components/action-panel";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel } from "@/lib/format";
import { feedingTimeLabel } from "@/lib/feeding-times";
import { PageHeading, Notice, Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ProductQuantityFields } from "@/components/stock-forms";
import { saveRation } from "@/app/admin/inventory/actions";

export default async function Feeding({
  searchParams,
}: {
  searchParams: Promise<{
    edit?: string;
    new?: string;
    horse?: string;
    time?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const [
    rations,
    horses,
    products,
    units,
    confirmations,
    todayConfirmations,
    times,
  ] = await Promise.all([
    db.from("feed_rations").select("*").order("horse_id"),
    db.from("horses").select("id,barn_name").order("barn_name"),
    db.from("inventory_products").select("*").order("name"),
    db.from("inventory_units").select("*"),
    db
      .from("feeding_confirmations")
      .select("*")
      .order("feeding_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("feeding_confirmations")
      .select("horse_id,feeding_time_id")
      .eq("feeding_date", today()),
    db.from("feeding_times").select("*").order("sort_order").order("name"),
  ]);
  const selected = rations.data?.find((r) => r.id === params.edit);
  const failed = [
    rations,
    horses,
    products,
    units,
    confirmations,
    todayConfirmations,
    times,
  ].some((r) => r.error);
  const summary = (r: NonNullable<typeof rations.data>[number]) =>
    `${Number(r.quantity)} ${units.data?.find((u) => u.id === r.unit_id)?.label ?? ""} · ${products.data?.find((p) => p.id === r.product_id)?.name ?? "Unknown product"}`;
  const legacyActive = new Set(
    rations.data
      ?.filter((r) => r.active && !r.feeding_time_id)
      .map((r) => r.horse_id),
  );
  return (
    <>
      <PageHeading
        eyebrow="A GOOD ROUTINE, A CLEAR RECORD"
        title="Daily feeding"
        description="Each horse, each feeding time, and exactly what was fed."
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
      {!failed && (
        <>
          <p className="notice">
            Save quantities for one feeding, such as morning or evening. Confirm
            each feeding only after it was actually given. Extras and partial
            feedings are recorded separately.
          </p>
          {legacyActive.size > 0 && (
            <p className="notice">
              Existing daily totals have not been split or assigned to a feeding
              time. Edit each unassigned line and enter the amount for that
              feeding. If a product is fed twice, add a separate line for the
              other time. Assign all active lines for a horse before confirming
              its scheduled feedings.
            </p>
          )}
          <SectionTabs
            id="feeding"
            label="Feeding sections"
            sections={[
              {
                id: "rations",
                label: "Rations",
                content: (
                  <>
                    <ActionPanel
                      id="ration-form"
                      label={selected ? "Edit ration" : "Add a ration"}
                      defaultOpen={Boolean(selected) || params.new === "1"}
                      closeHref="/admin/feeding"
                    >
                      {horses.data?.length &&
                      products.data?.some((p) => !p.archived) ? (
                        <form
                          action={saveRation}
                          className="record-form"
                          key={selected?.id ?? "new"}
                        >
                          <input
                            type="hidden"
                            name="id"
                            value={selected?.id ?? ""}
                          />
                          <div className="form-grid">
                            <label>
                              Horse
                              <select
                                name="horse_id"
                                required
                                defaultValue={
                                  selected?.horse_id ?? params.horse ?? ""
                                }
                              >
                                <option value="" disabled>
                                  Choose a horse
                                </option>
                                {horses.data.map((h) => (
                                  <option key={h.id} value={h.id}>
                                    {h.barn_name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Feeding time
                              <select
                                name="feeding_time_id"
                                required
                                defaultValue={
                                  selected?.feeding_time_id ?? params.time ?? ""
                                }
                              >
                                <option value="" disabled>
                                  Choose a feeding time
                                </option>
                                {times.data
                                  ?.filter(
                                    (t) =>
                                      !t.archived ||
                                      t.id === selected?.feeding_time_id,
                                  )
                                  .map((t) => (
                                    <option
                                      key={t.id}
                                      value={t.id}
                                      disabled={t.archived}
                                    >
                                      {feedingTimeLabel(t)}
                                      {t.archived ? " (archived)" : ""}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <ProductQuantityFields
                              products={products.data ?? []}
                              units={units.data ?? []}
                              initialProduct={selected?.product_id}
                              initialUnit={selected?.unit_id}
                              initialQuantity={selected?.quantity}
                            />
                          </div>
                          <label className="inline-checkbox">
                            <input
                              name="active"
                              type="checkbox"
                              defaultChecked={selected?.active ?? true}
                            />
                            Active ration
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
                          <p className="muted">
                            One line per horse, product, and feeding time.
                            Morning and evening quantities are separate. Saving
                            a ration does not deduct stock or change past
                            feedings.
                          </p>
                          <SubmitButton>Save ration</SubmitButton>
                        </form>
                      ) : (
                        <p className="record-form muted">
                          Add a horse and an active inventory product first.
                        </p>
                      )}
                    </ActionPanel>{" "}
                    <SavedRations
                      horses={horses.data ?? []}
                      rations={rations.data ?? []}
                      times={times.data ?? []}
                      products={products.data ?? []}
                      units={units.data ?? []}
                      todayConfirmations={todayConfirmations.data ?? []}
                    />
                  </>
                ),
              },
              {
                id: "confirm",
                label: "Confirm feeding",
                content: (
                  <>
                    <section className="panel" id="batch-daily">
                      <div className="panel-heading">
                        <h2>Confirm scheduled feeding</h2>
                      </div>
                      <DailyFeedingBatch
                        date={today()}
                        times={times.data ?? []}
                        horses={(horses.data ?? [])
                          .filter((h) => !legacyActive.has(h.id))
                          .map((h) => ({
                            ...h,
                            rations: (rations.data ?? [])
                              .filter(
                                (r) =>
                                  r.horse_id === h.id &&
                                  r.active &&
                                  r.feeding_time_id,
                              )
                              .map((r) => ({
                                feeding_time_id: r.feeding_time_id,
                                summary: summary(r),
                              })),
                          }))}
                      />
                    </section>
                  </>
                ),
              },
              {
                id: "extras",
                label: "Extras",
                content: (
                  <>
                    <section className="panel" id="batch-extras">
                      <div className="panel-heading">
                        <h2>Record extras or partial feedings</h2>
                      </div>
                      <ExtraFeedingBatch
                        date={today()}
                        request={crypto.randomUUID()}
                        horses={horses.data ?? []}
                        products={products.data ?? []}
                        units={units.data ?? []}
                        times={times.data ?? []}
                      />
                    </section>
                  </>
                ),
              },
              {
                id: "times",
                label: "Feeding times",
                content: (
                  <>
                    <FeedingTimeManager times={times.data ?? []} />
                  </>
                ),
              },
              {
                id: "history",
                label: "History",
                content: (
                  <>
                    {" "}
                    <section className="panel management-details">
                      <div className="panel-heading">
                        <h2>Latest 50 feeding confirmations</h2>
                      </div>
                      {confirmations.data?.map((c) => (
                        <div className="record-row record-form" key={c.id}>
                          <strong>
                            {
                              horses.data?.find((h) => h.id === c.horse_id)
                                ?.barn_name
                            }
                          </strong>
                          <span>
                            {dateLabel(c.feeding_date)} ·{" "}
                            {c.feeding_time_label ?? "Full-day ration (legacy)"}
                          </span>
                        </div>
                      ))}
                      {!confirmations.data?.length && (
                        <p className="record-form muted">
                          No confirmed feedings yet.
                        </p>
                      )}
                      <p className="record-form muted">
                        For extras or corrections, open{" "}
                        <Link
                          className="text-link"
                          href="/admin/inventory#stock-entry"
                        >
                          inventory and feeding history
                        </Link>
                        .
                      </p>
                    </section>
                  </>
                ),
              },
            ]}
          />
        </>
      )}
    </>
  );
}
