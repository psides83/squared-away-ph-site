import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel } from "@/lib/format";
import { PageHeading, Notice } from "@/components/ui";
import { SectionTabs } from "@/components/section-tabs";
import { ActionPanel } from "@/components/action-panel";
import { SavedRations } from "@/components/saved-rations";
import { DailyFeedingBatch } from "@/components/bulk-feeding";
import { QuickTraining } from "@/components/quick-training";
import { type TrainingHorse } from "@/components/training-horse-list";
export default async function QuickActions({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const date = today();
  const [horses, rations, products, units, times, confirmations, worklist] =
    await Promise.all([
      db.from("horses").select("id,barn_name").order("barn_name"),
      db.from("feed_rations").select("*"),
      db.from("inventory_products").select("id,name"),
      db.from("inventory_units").select("id,label"),
      db
        .from("feeding_times")
        .select("*")
        .order("time_of_day", { nullsFirst: false })
        .order("name"),
      db
        .from("feeding_confirmations")
        .select("id,horse_id,feeding_time_id")
        .eq("feeding_date", date)
        .is("cancelled_at", null),
      db.rpc("training_worklist"),
    ]);
  const failed = [
    horses,
    rations,
    products,
    units,
    times,
    confirmations,
    worklist,
  ].some((r) => r.error);
  const training = (worklist.data ?? []) as TrainingHorse[];
  const trainingHorses = training.map((h) => ({
    id: h.horse_id,
    barn_name: h.barn_name,
  }));
  const plannedHorses = (horses.data ?? []).filter((h) =>
    rations.data?.some((r) => r.horse_id === h.id && r.active),
  );
  const legacy = new Set(
    rations.data
      ?.filter((r) => r.active && !r.feeding_time_id)
      .map((r) => r.horse_id),
  );
  return (
    <>
      <PageHeading
        eyebrow={dateLabel(date).toUpperCase()}
        title="Quick actions"
        description="Record feeding and training while the work is fresh."
      />
      <Notice
        error={
          failed
            ? "Quick actions couldn’t load. Refresh after the latest database migrations are applied."
            : params.error
        }
        success={params.success}
      />
      {!failed && (
        <SectionTabs
          id="quick"
          label="Daily work"
          sections={[
            {
              id: "feeding",
              label: "Feeding",
              content: (
                <>
                  <div className="section-action-heading">
                    <div>
                      <h2>Feeding rounds</h2>
                      <p className="muted">
                        Confirm a horse below, or record a feeding time for
                        several horses.
                      </p>
                    </div>
                    {plannedHorses.length > 0 && (
                      <ActionPanel
                        id="quick-bulk-feeding"
                        label="Feed multiple horses"
                      >
                        <DailyFeedingBatch
                          home
                          date={date}
                          times={times.data ?? []}
                          horses={plannedHorses
                            .filter((h) => !legacy.has(h.id))
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
                                  feeding_time_id: r.feeding_time_id!,
                                  summary: `${Number(r.quantity)} ${units.data?.find((u) => u.id === r.unit_id)?.label ?? ""} · ${products.data?.find((p) => p.id === r.product_id)?.name ?? "Feed"}`,
                                })),
                            }))}
                        />
                      </ActionPanel>
                    )}
                  </div>
                  {plannedHorses.length ? (
                    <SavedRations
                      home
                      horses={plannedHorses}
                      rations={rations.data ?? []}
                      products={products.data ?? []}
                      units={units.data ?? []}
                      times={times.data ?? []}
                      todayConfirmations={confirmations.data ?? []}
                    />
                  ) : (
                    <section className="panel record-form">
                      <p>
                        No active feed schedules yet.{" "}
                        <Link className="text-link" href="/admin/horses">
                          Set up a horse’s feed schedule
                        </Link>{" "}
                        to begin.
                      </p>
                    </section>
                  )}
                  <div className="row-actions">
                    <Link
                      className="button secondary"
                      href="/admin/feeding#feeding-extras"
                    >
                      Extras / partial feeding
                    </Link>
                    <Link
                      className="button secondary"
                      href="/admin/feeding#feeding-history"
                    >
                      Feeding history
                    </Link>
                  </div>
                </>
              ),
            },
            {
              id: "training",
              label: "Training",
              content: (
                <>
                  <div className="section-action-heading">
                    <div>
                      <h2>Training today</h2>
                      <p className="muted">
                        Log each horse’s work, individually or with shared
                        session details.
                      </p>
                    </div>
                    {training.length > 0 && (
                      <ActionPanel
                        id="quick-bulk-training"
                        label="Train multiple horses"
                      >
                        <QuickTraining
                          horses={trainingHorses}
                          date={date}
                          request={crypto.randomUUID()}
                        />
                      </ActionPanel>
                    )}
                  </div>
                  <div className="horse-grid">
                    {training.map((h) => (
                      <article className="horse-card" key={h.horse_id}>
                        <h3>
                          <Link
                            className="inline-link"
                            href={`/admin/horses/${h.horse_id}`}
                          >
                            {h.barn_name}
                          </Link>
                        </h3>
                        <dl className="training-activity">
                          <div>
                            <dt>Last trained</dt>
                            <dd>
                              {h.last_trained
                                ? dateLabel(h.last_trained)
                                : "No session recorded"}
                              {h.training_title && (
                                <small>{h.training_title}</small>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Last fed</dt>
                            <dd>
                              {h.last_fed
                                ? dateLabel(h.last_fed)
                                : "No feeding recorded"}
                              {h.feeding_label && (
                                <small>{h.feeding_label}</small>
                              )}
                            </dd>
                          </div>
                        </dl>
                        <ActionPanel
                          id={`quick-train-${h.horse_id}`}
                          label={`Log training · ${h.barn_name}`}
                        >
                          <QuickTraining
                            horses={[
                              { id: h.horse_id, barn_name: h.barn_name },
                            ]}
                            date={date}
                            request={crypto.randomUUID()}
                          />
                        </ActionPanel>
                      </article>
                    ))}
                  </div>
                  {!training.length && (
                    <section className="panel record-form">
                      <p>
                        No horses currently in training.{" "}
                        <Link
                          className="text-link"
                          href="/admin/training?new=1#record-form"
                        >
                          Start a training stay
                        </Link>{" "}
                        to begin.
                      </p>
                    </section>
                  )}
                  <div className="row-actions">
                    <Link className="button secondary" href="/admin/log">
                      Training history & notes
                    </Link>
                  </div>
                </>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
