import { HelpPanel } from "@/components/help-panel";
import { AppSelect } from "@/components/app-select";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel } from "@/lib/format";
import { dayLabels, monthDates, summarizeDays } from "@/lib/billing-days";
import { PageHeading, Notice, Field, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { classifyDays } from "./actions";

export default async function Calendar({
  searchParams,
}: {
  searchParams: Promise<{
    stay?: string;
    month?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const date = today();
  const [stays, horses, customers] = await Promise.all([
    db
      .from("training_stays")
      .select("id,horse_id,billing_customer_id,arrival_date,departure_date")
      .order("arrival_date", { ascending: false }),
    db.from("horses").select("id,barn_name"),
    db.from("customers").select("id,name"),
  ]);
  const selected = params.stay
    ? stays.data?.find((s) => s.id === params.stay)
    : (stays.data?.find(
        (s) =>
          s.arrival_date <= date &&
          (!s.departure_date || s.departure_date >= date),
      ) ?? stays.data?.[0]);
  const month = params.month ?? date.slice(0, 7);
  let dates: string[] = [];
  let issue: string | undefined;
  try {
    monthDates(month, "1900-01-01", null, "9999-12-31");
    if (selected)
      dates = monthDates(
        month,
        selected.arrival_date,
        selected.departure_date,
        date,
      );
  } catch {
    issue = "Choose a valid calendar month.";
  }
  if (params.stay && !selected && !stays.error)
    issue = "That training stay could not be found.";
  const [days, events] = await Promise.all([
    selected && dates.length
      ? db
          .from("training_days")
          .select("day,status,notes")
          .eq("stay_id", selected.id)
          .gte("day", dates[0])
          .lte("day", dates.at(-1)!)
      : Promise.resolve({ data: [], error: null }),
    selected
      ? db
          .from("training_day_events")
          .select("*")
          .eq("stay_id", selected.id)
          .order("created_at", { ascending: false })
          .order("id")
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const failed = [stays, horses, customers, days, events].some((r) => r.error);
  const totals = summarizeDays(dates, days.data ?? []);
  const lookup = new Map((days.data ?? []).map((d) => [d.day, d]));
  const stayLabel = (s: {
    horse_id: string;
    billing_customer_id: string;
    arrival_date: string;
  }) =>
    `${horses.data?.find((h) => h.id === s.horse_id)?.barn_name ?? "Horse"} · ${customers.data?.find((c) => c.id === s.billing_customer_id)?.name ?? "Customer"} · arrived ${dateLabel(s.arrival_date)}`;
  return (
    <>
      <PageHeading
        eyebrow="BILL FOR THE WORK THAT HAPPENED"
        title="Billing calendar"
        description="Mark worked days, billable rest, and non-billable time. Leave no room for assumptions."
      />
      <Notice
        error={
          failed
            ? "Billing records couldn’t load. Confirm the latest Supabase migration has completed."
            : (issue ?? params.error)
        }
        success={params.success}
      />
      <HelpPanel title="How billable days work">
        <p>
          Arrival/departure dates describe the physical stay. Only days
          explicitly marked <strong>Worked</strong> or{" "}
          <strong>Billable rest</strong> count here. Training notes do not
          automatically classify days, and this calendar does not create
          invoices.
        </p>
      </HelpPanel>
      <section className="panel">
        <form action="/admin/calendar" className="log-filter">
          <label>
            Training stay
            <AppSelect name="stay" required defaultValue={selected?.id ?? ""}>
              <option value="" disabled>
                Select a stay
              </option>
              {stays.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {stayLabel(s)}
                </option>
              ))}
            </AppSelect>
          </label>
          <Field
            name="month"
            label="Month"
            type="month"
            required
            defaultValue={issue ? date.slice(0, 7) : month}
          />
          <button className="button secondary">View month</button>
        </form>
      </section>
      {!failed && !issue && selected && (
        <>
          <div className="stats-grid calendar-stats">
            {[
              { label: "BILLABLE DAYS", value: totals.billable },
              {
                label: "WORKED / REST",
                value: `${totals.worked} / ${totals.rest}`,
              },
              { label: "NON-BILLABLE", value: totals.nonbillable },
              { label: "UNCLASSIFIED", value: totals.unmarked },
            ].map((s) => (
              <div className="stat-card" key={s.label}>
                <p className="eyebrow">{s.label}</p>
                <strong>{s.value}</strong>
              </div>
            ))}
          </div>
          {dates.length ? (
            <ActionPanel id="classify-days" label="Mark training days">
              <div className="panel-heading">
                <h2>Mark a day or date range</h2>
                <Link
                  className="text-link"
                  href={`/admin/training?edit=${selected.id}#record-form`}
                >
                  Stay agreement
                </Link>
              </div>
              <form action={classifyDays} className="record-form">
                <input name="stay_id" type="hidden" value={selected.id} />
                <div className="form-grid">
                  <Field
                    name="from"
                    label="From"
                    type="date"
                    required
                    min={selected.arrival_date}
                    max={
                      selected.departure_date && selected.departure_date < date
                        ? selected.departure_date
                        : date
                    }
                    defaultValue={dates.at(-1)}
                  />
                  <Field
                    name="to"
                    label="Through"
                    type="date"
                    required
                    min={selected.arrival_date}
                    max={
                      selected.departure_date && selected.departure_date < date
                        ? selected.departure_date
                        : date
                    }
                    defaultValue={dates.at(-1)}
                  />
                  <label>
                    Classification
                    <AppSelect name="status" required defaultValue="">
                      <option value="" disabled>
                        Choose a status
                      </option>
                      <option value="worked">Worked</option>
                      <option value="rest">Billable rest</option>
                      <option value="nonbillable">Non-billable</option>
                      <option value="clear">
                        Clear classification (unclassified)
                      </option>
                    </AppSelect>
                  </label>
                </div>
                <label>
                  Notes / reason for this classification
                  <textarea name="notes" rows={3} maxLength={5000} />
                </label>
                <p className="muted form-hint">
                  The range is inclusive, must fall within the stay, and cannot
                  include future days. A rest day must be explicitly chosen;
                  unclassified days are never silently charged.
                </p>
                <SubmitButton>Save day classification</SubmitButton>
              </form>
            </ActionPanel>
          ) : (
            <p className="notice management-details">
              No elapsed days of this stay fall in the selected month. Choose
              another month.
            </p>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>{month} · Daily record</h2>
              <span className="count-badge">{dates.length} eligible days</span>
            </div>
            <div className="billing-calendar-grid">
              {dates.map((d) => {
                const entry = lookup.get(d);
                const status = entry?.status ?? "unmarked";
                return (
                  <article
                    className={`billing-day billing-day-${status}`}
                    key={d}
                  >
                    <p>{dateLabel(d)}</p>
                    <strong>{dayLabels[status]}</strong>
                    {entry?.notes && <p className="day-notes">{entry.notes}</p>}
                  </article>
                );
              })}
            </div>
            {!dates.length && (
              <p className="record-form muted">
                Nothing to classify for this month.
              </p>
            )}
          </section>
          <details className="panel management-details">
            <summary>Latest 20 classification changes</summary>
            {events.data?.map((event) => (
              <article className="log-entry" key={event.id}>
                <strong>{dateLabel(event.day)}</strong>
                <p>
                  {dayLabels[event.previous_status ?? "unmarked"]} →{" "}
                  {dayLabels[event.new_status ?? "unmarked"]}
                </p>
                {event.notes && <p className="log-notes">{event.notes}</p>}
                <p className="muted form-hint">
                  Recorded{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "America/Chicago",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.created_at))}
                </p>
              </article>
            ))}
            {!events.data?.length && (
              <p className="record-form muted">
                No classifications recorded yet.
              </p>
            )}
          </details>
        </>
      )}
      {!failed && !selected && !issue && (
        <section className="panel management-details">
          <EmptyState
            icon={CalendarCheck}
            title="Start with a training stay."
            description="Once a horse’s stay is recorded, you can classify actual worked and rest days here."
            href="/admin/training?new=1#record-form"
            label="Start a stay"
          />
        </section>
      )}
    </>
  );
}
