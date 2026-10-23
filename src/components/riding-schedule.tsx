import Link from "next/link";
import {
  ridingWeekdays,
  ridingPlanLabel,
  type RidingSchedule,
} from "@/lib/riding-schedule";
export function RidingWeek({
  schedule,
  date,
}: {
  schedule?: RidingSchedule | null;
  date: string;
}) {
  return (
    <>
      <p className="tag">Today: {ridingPlanLabel(schedule, date)}</p>
      {schedule?.days ? (
        <>
          <div className="riding-week">
            {ridingWeekdays.map((day, i) => (
              <div className={`riding-week-day ${schedule.days![i]}`} key={day}>
                <span>{day.slice(0, 3)}</span>
                <strong>
                  {schedule.days![i] === "training" ? "Train" : "Off"}
                </strong>
              </div>
            ))}
          </div>
          {schedule.notes && (
            <p className="muted riding-notes">{schedule.notes}</p>
          )}
        </>
      ) : (
        <p className="muted">Set a repeating week of training and off days.</p>
      )}
    </>
  );
}
export function RidingWeekOverview({
  horses,
  schedules,
  date,
}: {
  horses: { id: string; barn_name: string }[];
  schedules: RidingSchedule[];
  date: string;
}) {
  return (
    <>
      <p className="muted">
        Repeats each week. This is a plan; log actual work separately. Off days
        do not automatically become billable rest days.
      </p>
      <div className="horse-grid">
        {horses.map((h) => (
          <article className="horse-card" key={h.id}>
            <h3>{h.barn_name}</h3>
            <RidingWeek
              schedule={schedules.find((s) => s.horse_id === h.id)}
              date={date}
            />
            <Link
              className="button secondary"
              href={`/admin/horses/${h.id}#horse-riding`}
            >
              Riding schedule
            </Link>
          </article>
        ))}
      </div>
      {!horses.length && (
        <p className="record-form">No horses currently in training.</p>
      )}
    </>
  );
}
