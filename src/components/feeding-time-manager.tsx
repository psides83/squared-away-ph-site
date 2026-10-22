"use client";
import { useActionState, useEffect, useState } from "react";
import { manageFeedingTimes } from "@/app/admin/feeding/actions";
import { feedingTimeLabel, type FeedingTime } from "@/lib/feeding-times";
import { FormInput } from "@/components/form-input";
import { type InputHTMLAttributes } from "react";
import { Field, Notice } from "@/components/ui";
function DraftField({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={`field field-${props.type ?? "text"}`}>
      <span className="field-label">{label}</span>
      <FormInput {...props} />
    </label>
  );
}
type Draft = {
  id: string;
  name: string;
  time_of_day: string;
  sort_order: string;
};
export function FeedingTimeManager({ times }: { times: FeedingTime[] }) {
  const [state, action, pending] = useActionState(manageFeedingTimes, {});
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const saved = state.times ?? times;
  useEffect(() => {
    if (!state.revision) return;
    if (state.operation === "create") setDrafts([]);
    if (state.operation === "edit") setEditing(null);
  }, [state.revision, state.operation]);
  function add() {
    setDrafts((rows) => [
      ...rows,
      {
        id: crypto.randomUUID(),
        name: "",
        time_of_day: "",
        sort_order: String(
          Math.min(
            1000,
            Math.max(
              0,
              ...saved.map((t) => t.sort_order),
              ...rows.map((t) => Number(t.sort_order)),
            ) + 10,
          ),
        ),
      },
    ]);
  }
  function change(id: string, values: Partial<Draft>) {
    setDrafts((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...values } : r)),
    );
  }
  return (
    <section className="panel feeding-time-manager" id="feeding-times">
      <div className="panel-heading">
        <h2>Feeding times</h2>
      </div>
      <div className="record-form stack">
        <p>
          Add as many feeding times as your routine needs, then save all new
          times together. Edit saved times individually. Clock times are
          optional.
        </p>
        <Notice error={state.error} success={state.success} />
        {saved.map((t) => (
          <div className="stack separated" key={t.id}>
            {editing === t.id ? (
              <form action={action} className="stack">
                <input name="operation" type="hidden" value="edit" />
                <input name="id" type="hidden" value={t.id} />
                <fieldset className="stack" disabled={pending}>
                  <div className="form-grid">
                    <Field
                      name="name"
                      label="Feeding time name"
                      defaultValue={t.name}
                      required
                      maxLength={60}
                    />
                    <Field
                      name="time_of_day"
                      label="Clock time (optional)"
                      type="time"
                      defaultValue={t.time_of_day?.slice(0, 5)}
                    />
                    <Field
                      name="sort_order"
                      label="Display order"
                      type="number"
                      min={0}
                      max={1000}
                      step="1"
                      defaultValue={t.sort_order}
                      required
                    />
                  </div>
                  <label className="inline-checkbox">
                    <input
                      name="archived"
                      type="checkbox"
                      defaultChecked={t.archived}
                    />
                    Archived — move or pause active rations first
                  </label>
                  <div className="form-actions">
                    <button className="button">
                      {pending ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </fieldset>
              </form>
            ) : (
              <div className="record-row">
                <div>
                  <strong>{feedingTimeLabel(t)}</strong>
                  <p className="muted">
                    Order {t.sort_order}
                    {t.archived ? " · Archived" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={pending}
                  onClick={() => setEditing(t.id)}
                >
                  Edit<span className="sr-only"> {t.name}</span>
                </button>
              </div>
            )}
          </div>
        ))}
        {drafts.length ? (
          <form action={action} className="stack separated">
            <h3>New feeding times</h3>
            <input name="operation" type="hidden" value="create" />
            <input
              name="rows"
              type="hidden"
              value={JSON.stringify(
                drafts.map((r) => ({
                  ...r,
                  name: r.name.trim(),
                  time_of_day: r.time_of_day || null,
                  sort_order: r.sort_order === "" ? null : Number(r.sort_order),
                })),
              )}
            />
            <fieldset className="stack" disabled={pending}>
              {drafts.map((r, i) => (
                <div className="stack separated" key={r.id}>
                  <h4>New time {i + 1}</h4>
                  <div className="form-grid">
                    <DraftField
                      name={`name_${r.id}`}
                      label="Feeding time name"
                      value={r.name}
                      onChange={(e) => change(r.id, { name: e.target.value })}
                      required
                      maxLength={60}
                    />
                    <DraftField
                      name={`clock_${r.id}`}
                      label="Clock time (optional)"
                      type="time"
                      value={r.time_of_day}
                      onChange={(e) =>
                        change(r.id, { time_of_day: e.target.value })
                      }
                    />
                    <DraftField
                      name={`order_${r.id}`}
                      label="Display order"
                      type="number"
                      min={0}
                      max={1000}
                      step="1"
                      required
                      value={r.sort_order}
                      onChange={(e) =>
                        change(r.id, { sort_order: e.target.value })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      setDrafts((rows) => rows.filter((row) => row.id !== r.id))
                    }
                  >
                    Remove new time {i + 1}
                  </button>
                </div>
              ))}
              <div className="form-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={add}
                >
                  Add another time
                </button>
                <button className="button">
                  {pending ? "Saving…" : "Save all new feeding times"}
                </button>
              </div>
            </fieldset>
          </form>
        ) : (
          <div className="form-actions">
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={add}
            >
              Add feeding times
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
