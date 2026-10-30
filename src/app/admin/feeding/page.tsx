import { FeedingHistory } from "@/components/feeding-history";
import {
  feedingHistoryFilters,
  type FeedingHistoryData,
} from "@/lib/feeding-history";
import { redirect } from "next/navigation";
import { FeedingTimeManager } from "@/components/feeding-time-manager";
import { SectionTabs } from "@/components/section-tabs";
import { SavedRations } from "@/components/saved-rations";
import Link from "next/link";
import {
  DailyFeedingBatch,
  ExtraFeedingBatch,
} from "@/components/bulk-feeding";
import { requireAdmin } from "@/lib/auth";
import { today } from "@/lib/format";
import { PageHeading, Notice } from "@/components/ui";

export default async function Feeding({
  searchParams,
}: {
  searchParams: Promise<{
    history_before?: string | string[];
    history_from?: string | string[];
    history_to?: string | string[];
    history_horse?: string | string[];
    history_q?: string | string[];
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
  const historyFilters = feedingHistoryFilters(params);
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
    historyFilters.error
      ? Promise.resolve({ data: null, error: null })
      : db.rpc("search_feeding_history", {
          p_from: historyFilters.from || null,
          p_to: historyFilters.to || null,
          p_horse: historyFilters.horse || null,
          p_query: historyFilters.query || null,
          p_before: historyFilters.before ?? null,
        }),
    db
      .from("feeding_confirmations")
      .select("id,horse_id,feeding_time_id")
      .is("cancelled_at", null)
      .eq("feeding_date", today()),
    db
      .from("feeding_times")
      .select("*")
      .order("time_of_day", { nullsFirst: false })
      .order("name"),
  ]);
  const historyHorses = [...(horses.data ?? [])];
  let historyHorseError: string | undefined;
  if (
    historyFilters.horse &&
    !historyHorses.some((h) => h.id === historyFilters.horse)
  ) {
    const lookup = await db
      .from("horses")
      .select("id,barn_name")
      .eq("id", historyFilters.horse)
      .maybeSingle();
    if (lookup.data) historyHorses.push(lookup.data);
    else {
      historyHorses.push({
        id: historyFilters.horse,
        barn_name: "Selected horse unavailable",
      });
      historyHorseError = lookup.error
        ? "The selected horse could not load. Refresh or clear the filters."
        : "Choose an existing horse or clear the filters.";
    }
  }
  const selected = rations.data?.find((r) => r.id === params.edit);
  if (selected)
    redirect(
      `/admin/horses/${selected.horse_id}?ration=${selected.id}#ration-form`,
    );
  if (params.new === "1" && horses.data?.some((h) => h.id === params.horse))
    redirect(`/admin/horses/${params.horse}?new=1#ration-form`);
  const failed = [
    rations,
    horses,
    products,
    units,
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
        action={{ href: "/admin/feeding/past", label: "Log a past feeding" }}
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
            Set up rations in each horse’s record. Confirm each feeding only
            after it was actually given. Extras and partial feedings are
            recorded separately.
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
            defaultTab={
              params.history_before ||
              params.history_from ||
              params.history_to ||
              params.history_horse ||
              params.history_q
                ? "history"
                : "rations"
            }
            sections={[
              {
                id: "rations",
                label: "Feed schedules",
                content: (
                  <>
                    {params.horse && (
                      <p className="notice">
                        Feeding plan for{" "}
                        {horses.data?.find((h) => h.id === params.horse)
                          ?.barn_name ?? "unknown horse"}
                        .{" "}
                        <Link
                          className="text-link"
                          href="/admin/feeding#feeding-rations"
                        >
                          Show all horses
                        </Link>
                      </p>
                    )}
                    <SavedRations
                      horses={(horses.data ?? []).filter(
                        (h) => !params.horse || h.id === params.horse,
                      )}
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
                    <FeedingHistory
                      data={
                        (confirmations.data ?? {
                          days: [],
                          next_before: null,
                        }) as FeedingHistoryData
                      }
                      times={times.data ?? []}
                      filters={historyFilters}
                      horses={historyHorses}
                      planHorse={params.horse}
                      error={
                        historyFilters.error ||
                        historyHorseError ||
                        (confirmations.error
                          ? "Feeding history could not load. Check the latest migration and refresh."
                          : undefined)
                      }
                    />
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
