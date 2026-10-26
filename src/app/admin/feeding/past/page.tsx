import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel } from "@/lib/format";
import { missedFeedingDate } from "@/lib/past-feeding";
import { PageHeading, Notice, Field } from "@/components/ui";
import { SectionTabs } from "@/components/section-tabs";
import {
  DailyFeedingBatch,
  ExtraFeedingBatch,
} from "@/components/bulk-feeding";
export default async function PastFeeding({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams,
    { db } = await requireAdmin(),
    current = today();
  let date: string | null = null,
    dateError: string | undefined;
  try {
    date = missedFeedingDate(params.date, current);
  } catch (error) {
    dateError =
      error instanceof Error ? error.message : "Choose an actual feeding date.";
  }
  const [horses, rations, times, products, units, confirmations] =
    await Promise.all([
      db.from("horses").select("id,barn_name").order("barn_name"),
      db.from("feed_rations").select("*").eq("active", true),
      db
        .from("feeding_times")
        .select("*")
        .order("time_of_day", { nullsFirst: false })
        .order("name"),
      db.from("inventory_products").select("*").order("name"),
      db.from("inventory_units").select("*"),
      date
        ? db
            .from("feeding_confirmations")
            .select("horse_id,feeding_time_id")
            .eq("feeding_date", date)
            .is("cancelled_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);
  const failed = [horses, rations, times, products, units, confirmations].some(
    (r) => r.error,
  );
  const legacy = new Set(
    rations.data?.filter((r) => !r.feeding_time_id).map((r) => r.horse_id),
  );
  return (
    <>
      <Link className="text-link" href="/admin/feeding">
        Back to daily feeding
      </Link>
      <PageHeading
        title="Log a past feeding"
        description="Choose the day and feeding time you missed recording, then log one horse or a whole group."
      />
      <Notice
        error={
          failed
            ? "Feeding records could not load. Refresh before logging a feeding."
            : (dateError ?? params.error)
        }
        success={params.success}
      />
      <section className="panel">
        <div className="record-form stack">
          <form action="/admin/feeding/past" method="get" className="form-grid">
            <Field
              name="date"
              label="Day the horses were fed"
              type="date"
              defaultValue={date ?? current}
              max={current}
              required
            />
            <div className="form-actions">
              <button className="button secondary" type="submit">
                Show this day
              </button>
            </div>
          </form>
          {date && (
            <p>
              Recording for <strong>{dateLabel(date)}</strong>. Horses already
              confirmed for this day and feeding time are marked below.
            </p>
          )}
        </div>
      </section>
      {date && !failed && (
        <>
          <Notice
            error={
              legacy.size
                ? `${legacy.size} horse(s) have unassigned daily rations and cannot use scheduled confirmation. Assign their current feeding times in the horse record, or record actual quantities below.`
                : undefined
            }
          />
          <SectionTabs
            key={date}
            id="past-feeding"
            label="Past feeding entry"
            sections={[
              {
                id: "scheduled",
                label: "Saved rations",
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Log a missed feeding time</h2>
                    </div>
                    <DailyFeedingBatch
                      date={current}
                      past={{ date, confirmations: confirmations.data ?? [] }}
                      times={times.data ?? []}
                      horses={(horses.data ?? [])
                        .filter((h) => !legacy.has(h.id))
                        .map((h) => ({
                          ...h,
                          rations: (rations.data ?? [])
                            .filter(
                              (r) => r.horse_id === h.id && r.feeding_time_id,
                            )
                            .map((r) => ({
                              feeding_time_id: r.feeding_time_id!,
                              summary: `${Number(r.quantity)} ${units.data?.find((u) => u.id === r.unit_id)?.label ?? ""} · ${products.data?.find((p) => p.id === r.product_id)?.name ?? "Feed"}`,
                            })),
                        }))}
                    />
                  </section>
                ),
              },
              {
                id: "extras",
                label: "Actual quantities",
                content: (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Different rations, extras or partial feedings</h2>
                    </div>
                    <ExtraFeedingBatch
                      date={current}
                      pastDate={date}
                      request={crypto.randomUUID()}
                      times={times.data ?? []}
                      horses={horses.data ?? []}
                      products={products.data ?? []}
                      units={units.data ?? []}
                    />
                  </section>
                ),
              },
            ]}
          />
        </>
      )}
    </>
  );
}
