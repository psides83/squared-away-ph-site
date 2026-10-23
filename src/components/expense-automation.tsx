import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { HelpPanel } from "@/components/help-panel";
import { configureExpenseAutomation } from "@/app/admin/expenses/recurring/actions";
import { dateLabel } from "@/lib/format";
export type ExpenseAutomationConfig = {
  enabled: boolean;
  last_checked_at: string | null;
};
export type ExpenseAutomationRun = {
  id: string;
  business_date: string;
  started_at: string;
  finished_at: string | null;
  state: string;
  reason: string | null;
  results: {
    template_id: string;
    name: string;
    state: string;
    expense_id?: string;
    expense_date?: string;
    reason?: string;
  }[];
};
const timestamp = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(new Date(value));
const labels: Record<string, string> = {
  complete: "Completed",
  error: "Failed or partly failed",
  blocked: "Access needs review",
  running: "Running",
};
export function ExpenseAutomation({
  config,
  runs,
  ready,
}: {
  config: ExpenseAutomationConfig | null;
  runs: ExpenseAutomationRun[];
  ready: boolean;
}) {
  if (!config)
    return (
      <p className="notice error">
        Automatic expense settings could not load. Check the latest migration.
      </p>
    );
  const stale =
    config.enabled &&
    (!config.last_checked_at ||
      Date.now() - Date.parse(config.last_checked_at) > 36 * 60 * 60 * 1000);
  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-heading">
          <h2>Daily unpaid bill creation</h2>
          <span className="tag">{config.enabled ? "Enabled" : "Off"}</span>
        </div>
        <div className="record-form stack">
          <p>
            Creates one due unpaid bill per active recurring expense schedule
            each day. Review its actual amount, attach receipts and record
            payment normally. This setting is separate from automatic customer
            invoicing.
          </p>
          {!ready && (
            <p className="notice">
              Production scheduler setup is incomplete. Complete the server
              connection before enabling automatic expenses.
            </p>
          )}
          <p className="muted">
            Last scheduler check:{" "}
            {config.last_checked_at
              ? `${timestamp(config.last_checked_at)} Central`
              : "No check recorded yet"}
            .
          </p>
          {stale && (
            <p className="notice error">
              No scheduler check has been recorded in the last 36 hours. Review
              the deployment schedule; due bills can still be created manually.
            </p>
          )}
          <form action={configureExpenseAutomation}>
            <input
              type="hidden"
              name="enabled"
              value={config.enabled ? "false" : "true"}
            />
            {(config.enabled || ready) && (
              <ConfirmButton
                className={config.enabled ? "button secondary" : "button"}
                message={
                  config.enabled
                    ? "Stop future automatic expense creation? Existing bills and history remain."
                    : "Enable daily creation of unpaid bills from active schedules? Backdated schedules advance one occurrence per day. No bills will be marked paid, and no inventory will be added."
                }
              >
                {config.enabled
                  ? "Turn off automatic expenses"
                  : "Enable automatic expenses"}
              </ConfirmButton>
            )}
          </form>
        </div>
      </section>
      <HelpPanel title="How automatic expenses work">
        <p>
          The production daily scheduler checks up to 50 due active schedules,
          oldest dates first, and creates at most one bill per schedule per
          business date. A backdated start can create overdue bills over several
          days. Pause a schedule to stop future creation; skipping or preparing
          a bill manually advances that same sequence.
        </p>
        <p>
          Duplicate scheduler calls do not create another daily run. Each
          occurrence retains its own unique record; voiding a generated expense
          does not recreate it. A failure for one schedule leaves others free to
          process. Review failed runs and fix the schedule; it retries on a
          later day.
        </p>
        <p>
          Enabling authorizes operations as the administrator who enabled this
          feature. Losing that administrator access blocks future runs until
          another administrator re-enables it. The last-check timestamp and
          history indicate activity; enabling alone does not prove the provider
          is running. No payments, receipts, stock entries or customer invoice
          charges are created automatically here.
        </p>
      </HelpPanel>
      <section className="panel">
        <div className="panel-heading">
          <h2>Recent expense runs</h2>
          <span className="count-badge">Latest 20</span>
        </div>
        {!runs.length ? (
          <p>No automatic expense runs recorded yet.</p>
        ) : (
          runs.map((run) => (
            <details key={run.id}>
              <summary>
                {dateLabel(run.business_date)} ·{" "}
                {labels[run.state] ?? run.state} · {run.results.length}{" "}
                {run.results.length === 1 ? "schedule" : "schedules"}
              </summary>
              <p className="muted">
                Started {timestamp(run.started_at)} Central
                {run.finished_at
                  ? ` · Finished ${timestamp(run.finished_at)} Central`
                  : ""}
              </p>
              {run.reason && <p className="notice error">{run.reason}</p>}
              <div className="stack">
                {run.results.map((r, index) => (
                  <div key={`${r.template_id}-${index}`}>
                    <p>
                      <strong>{r.name}</strong> ·{" "}
                      {r.state === "created"
                        ? `Unpaid bill created${r.expense_date ? ` for ${dateLabel(r.expense_date)}` : ""}`
                        : `Failed: ${r.reason ?? "Review the schedule"}`}
                    </p>
                    <div className="row-actions">
                      <Link
                        className="text-link"
                        href={`/admin/expenses/recurring#recurring-${r.template_id}`}
                      >
                        View schedule
                      </Link>
                      {r.expense_id && (
                        <Link
                          className="text-link"
                          href={`/admin/expenses/${r.expense_id}`}
                        >
                          Review expense
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))
        )}
      </section>
    </div>
  );
}
