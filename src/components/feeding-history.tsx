import Link from "next/link";
import { CircleCheck, Clock3, ChevronDown, CalendarDays } from "lucide-react";
import { dateLabel } from "@/lib/format";
import {
  groupFeedingHistory,
  type FeedingHistoryData,
} from "@/lib/feeding-history";
const recordedTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(new Date(value));
export function FeedingHistory({
  data,
  times,
  before,
}: {
  data: FeedingHistoryData;
  times: { id: string; time_of_day: string | null }[];
  before?: string;
}) {
  return (
    <section
      className="feeding-history"
      aria-label="Daily feeding confirmation history"
    >
      <div className="section-action-heading">
        <div>
          <h2>Feeding history</h2>
          <p className="muted">
            Recorded feedings, grouped by day and feeding time.
          </p>
        </div>
        <Link
          className="button secondary"
          href="/admin/inventory?page=1#inventory-history"
        >
          Stock movement history
        </Link>
      </div>
      {!data.days.length && (
        <div className="panel record-form">
          <p>
            No feeding confirmations{before ? " before this date" : " yet"}.
          </p>
        </div>
      )}
      <div className="feeding-history-days">
        {data.days.map((day) => {
          const groups = groupFeedingHistory(day.confirmations, times);
          const active = day.confirmations.filter((c) => !c.cancelled_at);
          const horseCount = new Set(active.map((c) => c.horse_id)).size;
          return (
            <article className="panel feeding-history-day" key={day.date}>
              <header className="feeding-history-day-heading">
                <div className="feeding-history-date">
                  <CalendarDays size={21} aria-hidden="true" />
                  <div>
                    <h3>{dateLabel(day.date)}</h3>
                    <p className="muted">
                      {new Intl.DateTimeFormat("en-US", {
                        weekday: "long",
                        timeZone: "UTC",
                      }).format(new Date(`${day.date}T12:00:00Z`))}
                    </p>
                  </div>
                </div>
                <span className="feeding-history-total">
                  {active.length}{" "}
                  {active.length === 1 ? "confirmation" : "confirmations"} ·{" "}
                  {horseCount} {horseCount === 1 ? "horse" : "horses"}
                </span>
              </header>
              <div className="feeding-history-times">
                {groups.map((group) => (
                  <section className="feeding-history-time" key={group.id}>
                    <div className="feeding-history-time-heading">
                      <h4>
                        <Clock3 size={17} aria-hidden="true" />
                        {group.label}
                      </h4>
                      <span className="muted">
                        {group.active.length} confirmed
                      </span>
                    </div>
                    {group.active.length ? (
                      <ul className="feeding-history-horses">
                        {group.active.map((c) => (
                          <li key={c.id}>
                            <CircleCheck size={19} aria-hidden="true" />
                            <Link
                              className="inline-link"
                              href={`/admin/horses/${c.horse_id}`}
                            >
                              {c.horse_name}
                            </Link>
                            <span className="feeding-history-recorded">
                              Recorded{" "}
                              <time dateTime={c.created_at}>
                                {recordedTime(c.created_at)}
                              </time>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">
                        No active confirmations for this feeding time.
                      </p>
                    )}
                    {group.corrections.length > 0 && (
                      <details className="feeding-history-corrections">
                        <summary>
                          <ChevronDown size={16} aria-hidden="true" />
                          Corrections ({group.corrections.length})
                        </summary>
                        <ul>
                          {group.corrections.map((c) => (
                            <li key={c.id}>
                              <div>
                                <Link
                                  className="inline-link"
                                  href={`/admin/horses/${c.horse_id}`}
                                >
                                  {c.horse_name}
                                </Link>
                                <span className="feeding-history-undone">
                                  Confirmation undone
                                </span>
                              </div>
                              <p>
                                {c.cancellation_reason ?? "Correction recorded"}
                              </p>
                              <small className="muted">
                                Undone{" "}
                                {new Intl.DateTimeFormat("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                  timeZone: "America/Chicago",
                                }).format(new Date(c.cancelled_at!))}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {(before || data.next_before) && (
        <nav className="row-actions" aria-label="Feeding history pages">
          {before && (
            <Link
              className="button secondary"
              href="/admin/feeding#feeding-history"
            >
              Latest days
            </Link>
          )}
          {data.next_before && (
            <Link
              className="button secondary"
              href={`/admin/feeding?history_before=${data.next_before}#feeding-history`}
            >
              Older days
            </Link>
          )}
        </nav>
      )}
      <p className="muted feeding-history-help">
        This history shows scheduled feeding confirmations. Extras, partial
        feedings and stock corrections are in stock movement history. Recorded
        times use Central Time.
      </p>
    </section>
  );
}
