import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { ActionPanel } from "@/components/action-panel";
import { ServiceAssignmentForm } from "@/components/service-assignment-form";
import { money, dateLabel } from "@/lib/format";
import type {
  AssignmentOptions,
  AssignmentLine,
} from "@/lib/service-assignments";
function Lines({ lines }: { lines: AssignmentLine[] }) {
  return (
    <div className="stack">
      {lines.map((l, n) => (
        <div key={n}>
          <p>
            {l.horse_name} · {l.service === "board" ? "Board" : "Training"} ·{" "}
            {money(l.amount_cents)}
          </p>
          <p className="muted">
            {dateLabel(l.covered_from)} – {dateLabel(l.covered_to)} ·{" "}
            {l.stay_id ? (
              <Link className="text-link" href={`/admin/training/${l.stay_id}`}>
                Training stay
              </Link>
            ) : (
              "Horse only"
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
export function ExpenseServiceAssignmentsContent({
  options: o,
}: {
  options: AssignmentOptions;
}) {
  const current = o.current;
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Assign service costs to horses & stays</h2>
      </div>
      <div className="record-form stack">
        {!o.parent ? (
          <p className="notice">
            No current eligible business service split is available. Review the
            split above; voided expenses and inventory-only costs cannot receive
            assignments.
          </p>
        ) : (
          <>
            <p>
              Training {money(o.parent.training_cents)} · Board{" "}
              {money(o.parent.board_cents)} available within{" "}
              {dateLabel(o.parent.covered_from)} –{" "}
              {dateLabel(o.parent.covered_to)}.
            </p>
            {(o.parent.training_cents > 0 || o.parent.board_cents > 0) && (
              <ActionPanel
                id="service-horse-assignments"
                label={
                  current && !current.cleared
                    ? "Edit horse/stay assignments"
                    : "Assign horses & stays"
                }
              >
                <ServiceAssignmentForm options={o} />
              </ActionPanel>
            )}
          </>
        )}
        {current && !current.cleared ? (
          <>
            {!current.valid && (
              <p className="notice">
                The business split, source horse or stay dates changed. These
                assignments are excluded until reviewed; costs return to the
                unassigned business period.
              </p>
            )}
            <Lines lines={current.lines} />
            <ActionPanel
              id="clear-service-assignments"
              label="Clear horse/stay assignments"
            >
              <ServiceAssignmentForm options={o} clear />
            </ActionPanel>
          </>
        ) : (
          <p className="muted">
            No current horse/stay portions. Cost remains unassigned at business
            level.
          </p>
        )}
        <details>
          <summary>Assignment review history</summary>
          <div className="stack">
            {o.history.map((h) => (
              <div key={h.id}>
                <h3>
                  {h.cleared ? "Cleared assignments" : "Reviewed assignments"}
                </h3>
                <p className="muted">
                  {h.reason}
                  {h.retired_at ? " · Earlier version" : ""}
                </p>
                <Lines lines={h.lines} />
              </div>
            ))}
            {!o.history.length && <p>No saved assignments.</p>}
            {o.history.length === 10 && (
              <p className="muted">
                Up to ten recent versions are shown; all history is retained.
              </p>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
export async function ExpenseServiceAssignments({
  expense,
}: {
  expense: string;
}) {
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("service_assignment_options", {
    p_expense: expense,
  });
  if (error || !data)
    return (
      <p className="notice error" role="alert">
        Horse/stay assignments could not load. Check the latest migration.
      </p>
    );
  return (
    <ExpenseServiceAssignmentsContent options={data as AssignmentOptions} />
  );
}
