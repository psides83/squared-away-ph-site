import Link from "next/link";
import { dateLabel } from "@/lib/format";
export type TrainingHorse = {
  horse_id: string;
  barn_name: string;
  arrival_date: string;
  last_trained: string | null;
  training_title: string | null;
  last_fed: string | null;
  feeding_label: string | null;
};
export function TrainingHorseList({ horses }: { horses: TrainingHorse[] }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Currently in training</h2>
        <span className="count-badge">{horses.length} horses</span>
      </div>
      <p className="record-form muted">
        Choose a horse to log a session or note. Dates reflect recorded
        activity.
      </p>
      {horses.length ? (
        <div className="horse-grid file-grid">
          {horses.map((h) => (
            <article className="horse-card training-work-card" key={h.horse_id}>
              <h3>
                <Link
                  className="inline-link"
                  href={`/admin/horses/${h.horse_id}`}
                >
                  {h.barn_name}
                </Link>
              </h3>
              <p className="muted">
                In training since {dateLabel(h.arrival_date)}
              </p>
              <dl className="training-activity">
                <div>
                  <dt>Last fed</dt>
                  <dd>
                    {h.last_fed ? dateLabel(h.last_fed) : "No feeding recorded"}
                    {h.last_fed && (
                      <small>
                        {h.feeding_label || "Extra / unscheduled feeding"}
                      </small>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Last trained</dt>
                  <dd>
                    {h.last_trained
                      ? dateLabel(h.last_trained)
                      : "No session recorded"}
                    {h.training_title && <small>{h.training_title}</small>}
                  </dd>
                </div>
              </dl>
              <div className="row-actions">
                <Link
                  className="button"
                  href={`/admin/log?new=1&horse=${h.horse_id}#record-form`}
                >
                  Log session
                </Link>
                <Link
                  className="button secondary"
                  href={`/admin/log?new=1&kind=note&horse=${h.horse_id}#record-form`}
                >
                  Add note
                </Link>
              </div>
              <div className="row-actions">
                <Link
                  className="text-link"
                  href={`/admin/log?horse=${h.horse_id}#training-log-history`}
                >
                  History
                </Link>
                <Link
                  className="text-link"
                  href={`/admin/horses/${h.horse_id}#horse-rations`}
                >
                  Feeding plan
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="record-form">
          No horses have a current training stay.{" "}
          <Link className="text-link" href="/admin/training?new=1#record-form">
            Start a training stay
          </Link>
        </p>
      )}
    </section>
  );
}
