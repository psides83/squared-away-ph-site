import Link from "next/link";
import { CircleCheck, Clock3, Pencil } from "lucide-react";
import { ActionPanel } from "@/components/action-panel";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import {
  confirmFeeding,
  undoFeedingConfirmation,
} from "@/app/admin/inventory/actions";
import { feedingTimeLabel, type FeedingTime } from "@/lib/feeding-times";
import { today } from "@/lib/format";

export type Ration = {
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
  editable = false,
  home = false,
}: {
  editable?: boolean;
  home?: boolean;
  horses: { id: string; barn_name: string }[];
  rations: Ration[];
  times: FeedingTime[];
  products: { id: string; name: string }[];
  units: { id: string; label: string }[];
  todayConfirmations: {
    id: string;
    horse_id: string;
    feeding_time_id: string | null;
  }[];
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
        <h2>{editable ? "Feed schedule" : "Feed schedules"}</h2>
        {!editable && (
          <span className="muted">Grouped by horse and feeding time</span>
        )}
      </div>
      <div className="horse-grid file-grid ration-horse-grid">
        {horses?.map((h) => {
          const lines = rations?.filter((r) => r.horse_id === h.id) ?? [];
          const activeGroups = groups.filter(
            (g) =>
              !g.archived &&
              lines.some((r) => r.active && r.feeding_time_id === g.id),
          );
          const recordedCount = activeGroups.filter((g) =>
            todayConfirmations.some(
              (c) =>
                c.horse_id === h.id &&
                (c.feeding_time_id === g.id || c.feeding_time_id === null),
            ),
          ).length;
          const allFed =
            !editable &&
            activeGroups.length > 0 &&
            recordedCount === activeGroups.length;
          return (
            <article
              className={`horse-card feeding-horse-card${allFed ? " is-fed" : ""}`}
              key={h.id}
            >
              <h3>{h.barn_name}</h3>
              {!editable && activeGroups.length > 0 && (
                <p
                  className={`feeding-day-progress${allFed ? " is-complete" : ""}`}
                >
                  {allFed && <CircleCheck size={18} aria-hidden="true" />}
                  {allFed
                    ? "All feedings recorded today"
                    : `${recordedCount} of ${activeGroups.length} feedings recorded today`}
                </p>
              )}
              {groups
                .filter((g) => lines.some((r) => r.feeding_time_id === g.id))
                .map((g) => {
                  const groupLines = lines
                    .filter((r) => r.feeding_time_id === g.id)
                    .sort((a, b) =>
                      (
                        products.find((p) => p.id === a.product_id)?.name ?? ""
                      ).localeCompare(
                        products.find((p) => p.id === b.product_id)?.name ?? "",
                      ),
                    );
                  const active = groupLines.some((r) => r.active);
                  const confirmed = todayConfirmations?.find(
                    (c) =>
                      c.horse_id === h.id &&
                      (c.feeding_time_id === g.id ||
                        c.feeding_time_id === null),
                  );
                  return (
                    <div
                      className={`feeding-time-group${!editable && active && !g.archived ? (confirmed ? " is-confirmed" : " is-pending") : ""}`}
                      key={g.id ?? "unassigned"}
                    >
                      <div className="feeding-time-heading">
                        <div className="feeding-time-title">
                          <h4>
                            {g.label}
                            {g.archived ? " (archived)" : ""}
                          </h4>
                          {!editable && active && !g.archived && (
                            <span
                              className={`feeding-status ${confirmed ? "confirmed" : "pending"}`}
                            >
                              {confirmed ? (
                                <CircleCheck size={17} aria-hidden="true" />
                              ) : (
                                <Clock3 size={17} aria-hidden="true" />
                              )}
                              {confirmed ? "Fed today" : "Not recorded"}
                            </span>
                          )}
                        </div>
                        <Link
                          className="feeding-time-edit"
                          href={`/admin/horses/${h.id}?feed_time=${g.id ?? "unassigned"}#ration-form`}
                          aria-label={`${g.id ? "Edit" : "Assign"} ${g.label} feed schedule for ${h.barn_name}`}
                          title={
                            g.id
                              ? "Edit feeding schedule"
                              : "Assign feeding time"
                          }
                        >
                          <Pencil size={18} aria-hidden="true" />
                        </Link>
                      </div>
                      {!editable &&
                        confirmed &&
                        active &&
                        !g.archived &&
                        confirmed.feeding_time_id === null && (
                          <p className="feeding-legacy-note">
                            Recorded as a full-day feeding.
                          </p>
                        )}
                      {groupLines.map((r) => (
                        <div className="ration-line" key={r.id}>
                          <p>
                            <strong>{summary(r)}</strong>
                            {!r.active && <span className="tag">Paused</span>}
                          </p>
                          {r.notes && <p className="muted">{r.notes}</p>}
                        </div>
                      ))}
                      {!editable && active && g.id && !g.archived && (
                        <>
                          {confirmed && (
                            <ActionPanel
                              id={`undo-feeding-${h.id}-${g.id}`}
                              label="Undo confirmation"
                            >
                              <form
                                action={undoFeedingConfirmation}
                                className="record-form"
                              >
                                <input
                                  type="hidden"
                                  name="return_to"
                                  value={home ? "home" : "feeding"}
                                />
                                <input
                                  type="hidden"
                                  name="confirmation_id"
                                  value={confirmed.id}
                                />
                                <p>
                                  Undo {h.barn_name} ·{" "}
                                  {confirmed.feeding_time_id
                                    ? g.label
                                    : "full-day feeding"}
                                  . This restores all stock deducted by this
                                  confirmation and retains its history.
                                </p>
                                <Field
                                  name="reason"
                                  label="Correction reason"
                                  required
                                  maxLength={5000}
                                />
                                <ConfirmButton
                                  destructive
                                  message="Undo this feeding confirmation and restore its stock? Only use this if the feeding was recorded by mistake."
                                >
                                  Undo confirmation
                                </ConfirmButton>
                              </form>
                            </ActionPanel>
                          )}
                          {!confirmed && !legacyActive.has(h.id) && (
                            <ActionPanel
                              id={`feeding-${h.id}-${g.id}`}
                              label={`Confirm ${g.label}`}
                            >
                              <form
                                action={confirmFeeding}
                                className="record-form"
                              >
                                <input
                                  type="hidden"
                                  name="return_to"
                                  value={home ? "home" : "feeding"}
                                />
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
              {!editable && (
                <Link
                  className="text-link"
                  href={`/admin/horses/${h.id}#horse-rations`}
                >
                  Manage feed schedule
                </Link>
              )}
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
