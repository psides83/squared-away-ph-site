import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { Field } from "@/components/ui";
import { SubmitButton, DeleteButton } from "@/components/submit-button";
import { confirmFeeding, deleteRation } from "@/app/admin/inventory/actions";
import { feedingTimeLabel, type FeedingTime } from "@/lib/feeding-times";
import { today } from "@/lib/format";

type Ration = {
  id: string;
  horse_id: string;
  product_id: string;
  unit_id: string;
  feeding_time_id: string | null;
  quantity: number | string;
  active: boolean;
  notes: string | null;
};
export function SavedRations({
  horses,
  rations,
  times,
  products,
  units,
  todayConfirmations,
}: {
  horses: { id: string; barn_name: string }[];
  rations: Ration[];
  times: FeedingTime[];
  products: { id: string; name: string }[];
  units: { id: string; label: string }[];
  todayConfirmations: { horse_id: string; feeding_time_id: string | null }[];
}) {
  const summary = (r: Ration) =>
    `${Number(r.quantity)} ${units.find((u) => u.id === r.unit_id)?.label ?? ""} · ${products.find((p) => p.id === r.product_id)?.name ?? "Unknown product"}`;
  const groups = [
    ...times.map((t) => ({
      id: t.id,
      label: feedingTimeLabel(t),
      archived: t.archived,
    })),
    { id: null, label: "Unassigned daily total", archived: false },
  ];
  const legacyActive = new Set(
    rations
      .filter((r) => r.active && !r.feeding_time_id)
      .map((r) => r.horse_id),
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Saved rations</h2>
        <span className="muted">Grouped by horse and feeding time</span>
      </div>
      <div className="horse-grid file-grid ration-horse-grid">
        {horses?.map((h) => {
          const lines = rations?.filter((r) => r.horse_id === h.id) ?? [];
          return (
            <article className="horse-card" key={h.id}>
              <h3>{h.barn_name}</h3>
              {groups
                .filter((g) => lines.some((r) => r.feeding_time_id === g.id))
                .map((g) => {
                  const groupLines = lines.filter(
                    (r) => r.feeding_time_id === g.id,
                  );
                  const active = groupLines.some((r) => r.active);
                  const confirmed = todayConfirmations?.some(
                    (c) =>
                      c.horse_id === h.id &&
                      (c.feeding_time_id === g.id ||
                        c.feeding_time_id === null),
                  );
                  return (
                    <div
                      className="feeding-time-group"
                      key={g.id ?? "unassigned"}
                    >
                      <h4>
                        {g.label}
                        {g.archived ? " (archived)" : ""}
                      </h4>
                      {groupLines.map((r) => (
                        <div className="ration-line" key={r.id}>
                          <p>
                            <strong>{summary(r)}</strong>
                            {!r.active && <span className="tag">Paused</span>}
                          </p>
                          {r.notes && <p className="muted">{r.notes}</p>}
                          <div className="row-actions">
                            <Link
                              className="text-link"
                              href={`/admin/feeding?edit=${r.id}#ration-form`}
                            >
                              {r.feeding_time_id
                                ? "Edit"
                                : "Assign feeding time"}
                            </Link>
                            <form action={deleteRation}>
                              <input name="id" type="hidden" value={r.id} />
                              <DeleteButton label="Remove" />
                            </form>
                          </div>
                        </div>
                      ))}
                      {active && g.id && !g.archived && (
                        <>
                          <p className="muted">
                            {confirmed
                              ? "Already recorded today (this feeding or a full-day total)"
                              : "Not confirmed today"}
                          </p>
                          {!legacyActive.has(h.id) && (
                            <ActionPanel
                              id={`feeding-${h.id}-${g.id}`}
                              label={`Confirm ${g.label}`}
                            >
                              <form
                                action={confirmFeeding}
                                className="record-form"
                              >
                                <input
                                  name="horse_id"
                                  type="hidden"
                                  value={h.id}
                                />
                                <input
                                  name="feeding_time_id"
                                  type="hidden"
                                  value={g.id}
                                />
                                <p>
                                  {h.barn_name} · {g.label}
                                </p>
                                {groupLines
                                  .filter((r) => r.active)
                                  .map((r) => (
                                    <p key={r.id}>{summary(r)}</p>
                                  ))}
                                <Field
                                  name="feeding_date"
                                  label="Actual feeding date"
                                  type="date"
                                  required
                                  defaultValue={today()}
                                  max={today()}
                                />
                                <p className="muted">
                                  Records only this feeding time. Repeating the
                                  same date and time does not deduct stock
                                  twice.
                                </p>
                                <SubmitButton>
                                  Confirm this feeding was given
                                </SubmitButton>
                              </form>
                            </ActionPanel>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              {!lines.length && <p className="muted">No rations saved yet.</p>}
              <Link
                className="text-link"
                href={`/admin/feeding?new=1&horse=${h.id}#ration-form`}
              >
                Add a ration for {h.barn_name}
              </Link>
            </article>
          );
        })}
      </div>
      {!horses?.length && (
        <p className="record-form muted">
          Add a horse to start its feeding plan.
        </p>
      )}
    </section>
  );
}
