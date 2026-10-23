import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { AppSelect } from "@/components/app-select";
import { ConfirmButton } from "@/components/confirm-button";
import { HelpPanel } from "@/components/help-panel";
import { SubmitButton } from "@/components/submit-button";
import { Field } from "@/components/ui";
import { careAction } from "@/app/admin/horses/care-actions";
import { careKinds } from "@/lib/horse-care";
import { dateLabel, today } from "@/lib/format";
export type HorseCare = {
  id: string;
  horse_id: string;
  care_date: string;
  kind: keyof typeof careKinds;
  title: string;
  provider: string | null;
  notes: string;
  private_notes: string | null;
  published_at: string | null;
  archived_at: string | null;
  revision: number;
};
function CareForm({ horse, row }: { horse: string; row?: HorseCare }) {
  return (
    <form action={careAction.bind(null, "save")} className="record-form">
      <input type="hidden" name="horse_id" value={horse} />
      <input type="hidden" name="id" value={row?.id ?? ""} />
      <input type="hidden" name="request_id" value={crypto.randomUUID()} />
      <input type="hidden" name="revision" value={row?.revision ?? 0} />
      <div className="form-grid">
        <Field
          label="Care date"
          name="care_date"
          type="date"
          required
          defaultValue={row?.care_date ?? today()}
        />
        <label>
          Care type
          <AppSelect
            aria-label="Care type"
            name="kind"
            defaultValue={row?.kind ?? "farrier"}
          >
            {Object.entries(careKinds).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </AppSelect>
        </label>
        <Field
          label="Summary"
          name="title"
          required
          defaultValue={row?.title}
        />
        <Field
          label="Provider (optional)"
          name="provider"
          defaultValue={row?.provider}
        />
      </div>
      <label>
        Care details
        <textarea
          name="notes"
          rows={4}
          required
          maxLength={5000}
          defaultValue={row?.notes ?? ""}
        />
      </label>
      <p className="form-hint muted">
        The date, type, summary, provider and care details are visible to
        customers only after you share this record.
      </p>
      <label>
        Trainer-only notes
        <textarea
          name="private_notes"
          rows={3}
          maxLength={5000}
          defaultValue={row?.private_notes ?? ""}
        />
      </label>
      <p className="form-hint muted">
        Trainer-only notes are never included in the customer view. New records
        are private; sharing is a separate action.
      </p>
      <div className="form-actions">
        <SubmitButton>Save care record</SubmitButton>
      </div>
    </form>
  );
}
function StatusAction({
  row,
  operation,
  label,
}: {
  row: HorseCare;
  operation: string;
  label: string;
}) {
  return (
    <ActionPanel id={`care-${operation}-${row.id}`} label={label}>
      <form action={careAction.bind(null, "status")} className="record-form">
        <h2>{label}</h2>
        <input type="hidden" name="horse_id" value={row.horse_id} />
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="request_id" value={crypto.randomUUID()} />
        <input type="hidden" name="revision" value={row.revision} />
        <input type="hidden" name="operation" value={operation} />
        {operation === "share" && (
          <>
            <p className="notice">
              Customers with active manual access to this horse can see the care
              details below. Trainer-only notes stay private.
            </p>
            <h3>{row.title}</h3>
            <p>
              {dateLabel(row.care_date)} · {careKinds[row.kind]}
              {row.provider ? ` · ${row.provider}` : ""}
            </p>
            <p className="preserve-lines">{row.notes}</p>
          </>
        )}
        <Field label="Reason" name="reason" required maxLength={2000} />
        <div className="form-actions">
          <ConfirmButton
            className="button secondary"
            message={
              operation === "share"
                ? "Share these care details with customers who have access to this horse? Trainer-only notes stay private."
                : operation === "archive"
                  ? "Archive this care record and remove it from customer view? Its history is retained."
                  : `${label}? The change will be recorded in history.`
            }
          >
            {label}
          </ConfirmButton>
        </div>
      </form>
    </ActionPanel>
  );
}
export function HorseCareRecords({
  horse,
  rows,
  total,
  page,
  archived,
  error,
}: {
  horse: string;
  rows: HorseCare[];
  total: number;
  page: number;
  archived: boolean;
  error: boolean;
}) {
  const href = (p: number, a = archived) =>
    `/admin/horses/${horse}?care_page=${p}&care_status=${a ? "archived" : "current"}#horse-care`;
  return (
    <div className="stack">
      <div className="row-actions">
        <ActionPanel id="add-horse-care" label="Log care">
          <div className="panel-heading">
            <h2>Log completed care</h2>
          </div>
          <CareForm horse={horse} />
        </ActionPanel>
        <Link className="button secondary" href={href(1, !archived)}>
          {archived ? "Current care records" : "Archived care records"}
        </Link>
      </div>
      <HelpPanel title="Care records and customer sharing">
        <p>
          Log completed care here. Records start private. Share only the details
          you want customers to see; trainer-only notes remain private. Sharing
          follows manual horse access and its visible-from publication date,
          just like progress updates. Ownership changes do not grant access.
        </p>
        <p>
          Unshare a published record before editing it. Archiving removes it
          from customer view; restoring returns it to private. These records do
          not create expenses, reminders or treatment recommendations. Record
          bills in Expenses and future tasks in Reminders separately.
        </p>
      </HelpPanel>
      {error ? (
        <p className="notice error">
          Care records could not load. Check the latest migration.
        </p>
      ) : (
        <>
          <p className="muted">
            {archived ? "Archived" : "Current"} care records · {total} total
          </p>
          {!rows.length && (
            <section className="panel">
              <p>No {archived ? "archived" : "current"} care records.</p>
            </section>
          )}
          {rows.map((row) => (
            <section className="panel" key={row.id}>
              <div className="panel-heading">
                <div>
                  <h2>{row.title}</h2>
                  <p className="muted form-hint">
                    {dateLabel(row.care_date)} · {careKinds[row.kind]}
                    {row.provider ? ` · ${row.provider}` : ""}
                  </p>
                </div>
                <span className="tag">
                  {row.archived_at
                    ? "Archived"
                    : row.published_at
                      ? "Shared"
                      : "Private"}
                </span>
              </div>
              <div className="record-form stack">
                <p className="preserve-lines">{row.notes}</p>
                {row.private_notes && (
                  <details>
                    <summary>Trainer-only notes</summary>
                    <p className="preserve-lines feed-comparison-detail">
                      {row.private_notes}
                    </p>
                  </details>
                )}
                <div className="row-actions">
                  {row.archived_at ? (
                    <StatusAction
                      row={row}
                      operation="restore"
                      label="Restore privately"
                    />
                  ) : (
                    <>
                      {!row.published_at && (
                        <ActionPanel
                          id={`edit-care-${row.id}`}
                          label="Edit care"
                        >
                          <div className="panel-heading">
                            <h2>Edit care record</h2>
                          </div>
                          <CareForm horse={horse} row={row} />
                        </ActionPanel>
                      )}
                      <StatusAction
                        row={row}
                        operation={row.published_at ? "unshare" : "share"}
                        label={
                          row.published_at ? "Unshare" : "Share with customers"
                        }
                      />
                      <StatusAction
                        row={row}
                        operation="archive"
                        label="Archive care"
                      />
                    </>
                  )}
                </div>
              </div>
            </section>
          ))}
          <nav className="log-pagination" aria-label="Care record pages">
            {page > 1 ? (
              <Link className="button secondary" href={href(page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>Page {page}</span>
            {page * 25 < total ? (
              <Link className="button secondary" href={href(page + 1)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </div>
  );
}
