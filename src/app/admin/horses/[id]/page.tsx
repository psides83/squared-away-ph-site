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
    ration?: string;
    new?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const { id } = await params,
    query = await searchParams;
  const { db } = await requireAdmin();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const [horse, rations, products, units, times, overview] = await Promise.all([
    db.from("horses").select("*").eq("id", id).maybeSingle(),
    db.from("feed_rations").select("*").eq("horse_id", id),
    db.from("inventory_products").select("*").order("name"),
    db.from("inventory_units").select("*"),
    db.from("feeding_times").select("*").order("sort_order").order("name"),
    db.rpc("horse_overview"),
  ]);
  if (!horse.data && !horse.error) notFound();
  const failed = [horse, rations, products, units, times, overview].some(
    (r) => r.error,
  );
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
            query.new || query.ration || query.success || query.error
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
                    <Link href="/admin/feeding#feeding-confirm">
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
