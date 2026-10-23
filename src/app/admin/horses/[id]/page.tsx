import {
  OwnershipHistory,
  type OwnershipEvent,
} from "@/components/ownership-history";
import { ReminderList } from "@/components/reminder-list";
import { today } from "@/lib/format";
import {
  HorseStatus,
  HorseQuickActions,
  type HorseStatusData,
} from "@/components/horse-status";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { SectionTabs } from "@/components/section-tabs";
import { PageHeading, Notice } from "@/components/ui";
import { SavedRations } from "@/components/saved-rations";
import { HorseRationEditor } from "@/components/horse-ration-editor";

export default async function HorseRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    ownership_page?: string;
    ration?: string;
    new?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const { id } = await params,
    query = await searchParams;
  const { db } = await requireAdmin();
  const ownershipPage = Math.max(
    1,
    Math.min(10000, Math.floor(Number(query.ownership_page) || 1)),
  );
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const [
    horse,
    rations,
    products,
    units,
    times,
    overview,
    reminders,
    categories,
    owners,
    ownershipEvents,
  ] = await Promise.all([
    db.from("horses").select("*").eq("id", id).maybeSingle(),
    db.from("feed_rations").select("*").eq("horse_id", id),
    db.from("inventory_products").select("*").order("name"),
    db.from("inventory_units").select("*"),
    db.from("feeding_times").select("*").order("sort_order").order("name"),
    db.rpc("horse_overview"),
    db
      .from("reminders")
      .select("*", { count: "exact" })
      .eq("horse_id", id)
      .is("completed_at", null)
      .order("due_date")
      .order("id")
      .limit(25),
    db.from("reminder_categories").select("id,name"),
    db
      .from("horse_customers")
      .select("customer_id,relationship,customers(name)")
      .eq("horse_id", id)
      .order("customer_id"),
    db
      .from("horse_ownership_events")
      .select("*", { count: "exact" })
      .eq("horse_id", id)
      .order("recorded_at", { ascending: false })
      .order("id")
      .range((ownershipPage - 1) * 25, ownershipPage * 25 - 1),
  ]);
  if (!horse.data && !horse.error) notFound();
  const failed = [
    horse,
    rations,
    products,
    units,
    times,
    overview,
    reminders,
    categories,
  ].some((r) => r.error);
  const selected = rations.data?.find((r) => r.id === query.ration);
  const h = horse.data;
  return (
    <>
      <Link className="text-link" href="/admin/horses">
        Back to horses
      </Link>
      <PageHeading
        title={h?.barn_name ?? "Horse record"}
        description="Profile, care instructions, and feeding plan."
      />
      <Notice
        error={
          failed
            ? "The horse record could not load. Please refresh."
            : query.error ||
              (query.ration && !selected
                ? "That ration could not be found for this horse."
                : undefined)
        }
        success={query.success}
      />
      {h && (
        <section className="panel">
          <div className="record-form">
            <HorseQuickActions id={id} />
            <HorseStatus
              status={(overview.data as HorseStatusData[] | null)?.find(
                (s) => s.horse_id === id,
              )}
            />
          </div>
        </section>
      )}
      {!failed && h && (
        <SectionTabs
          id="horse"
          label="Horse record sections"
          defaultTab={
            query.ownership_page
              ? "ownership"
              : query.new || query.ration || query.success || query.error
                ? "rations"
                : "profile"
          }
          sections={[
            {
              id: "profile",
              label: "Profile",
              content: (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>About {h.barn_name}</h2>
                    <Link
                      className="text-link"
                      href={`/admin/horses?edit=${id}#record-form`}
                    >
                      Edit profile
                    </Link>
                  </div>
                  <div className="record-form stack">
                    <p>
                      {h.registered_name || h.barn_name} ·{" "}
                      {h.breed || "Breed not added"}
                      {h.birth_year ? ` · Born ${h.birth_year}` : ""}
                    </p>
                    <h3>Training goals</h3>
                    <p className="preserve-lines">
                      {h.training_goals || "No goals added yet."}
                    </p>
                    <h3>Care and feeding notes</h3>
                    <p className="preserve-lines">
                      {h.feeding_instructions || "No additional instructions."}
                    </p>
                    <h3>Private health notes</h3>
                    <p className="preserve-lines">
                      {h.health_notes || "No health notes added."}
                    </p>
                    <Link className="text-link" href={`/admin/log?horse=${id}`}>
                      Training history
                    </Link>
                  </div>
                </section>
              ),
            },
            {
              id: "ownership",
              label: "Customers & ownership",
              content: (
                <OwnershipHistory
                  horseId={id}
                  current={(owners.data ?? []).map((o) => ({
                    customer_id: o.customer_id,
                    relationship: o.relationship,
                    name:
                      (Array.isArray(o.customers)
                        ? o.customers[0]
                        : o.customers
                      )?.name ?? "Customer",
                  }))}
                  events={(ownershipEvents.data ?? []) as OwnershipEvent[]}
                  count={ownershipEvents.count ?? 0}
                  page={ownershipPage}
                  error={Boolean(owners.error || ownershipEvents.error)}
                />
              ),
            },
            {
              id: "reminders",
              label: `Reminders (${reminders.count ?? 0})`,
              content: (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Open reminders for {h.barn_name}</h2>
                    <Link
                      className="button secondary"
                      href={`/admin/reminders?new=1&horse=${id}#record-form`}
                    >
                      Add reminder
                    </Link>
                  </div>
                  {reminders.error || categories.error ? (
                    <p className="notice error">
                      Reminders could not load. Refresh and try again.
                    </p>
                  ) : reminders.data?.length ? (
                    <ReminderList
                      reminders={reminders.data}
                      horses={[h]}
                      categories={categories.data ?? []}
                      date={today()}
                      horseContext={id}
                    />
                  ) : (
                    <p className="record-form muted">
                      No open reminders for this horse.
                    </p>
                  )}
                  <div className="record-form">
                    {Number(reminders.count) > 25 && (
                      <p className="muted">
                        Showing the next 25 of {reminders.count} open reminders.
                      </p>
                    )}
                    <Link
                      className="text-link"
                      href={`/admin/reminders?horse=${id}`}
                    >
                      View all reminders and completed history
                    </Link>
                  </div>
                </section>
              ),
            },
            {
              id: "rations",
              label: "Feeding plan",
              content: (
                <>
                  <HorseRationEditor
                    horse={h}
                    selected={selected}
                    isNew={query.new === "1"}
                    products={products.data ?? []}
                    units={units.data ?? []}
                    times={times.data ?? []}
                  />
                  <SavedRations
                    editable
                    horses={[h]}
                    rations={rations.data ?? []}
                    products={products.data ?? []}
                    units={units.data ?? []}
                    times={times.data ?? []}
                    todayConfirmations={[]}
                  />
                  <p className="notice">
                    Saving a ration sets this horse’s plan without deducting
                    inventory.{" "}
                    <Link
                      className="inline-link"
                      href="/admin/feeding#feeding-confirm"
                    >
                      Go to daily feeding
                    </Link>{" "}
                    to record feed actually given.
                  </p>
                </>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
