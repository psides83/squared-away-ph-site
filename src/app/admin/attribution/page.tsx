import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { money, dateLabel } from "@/lib/format";
import { PageHeading, Notice } from "@/components/ui";
import { DeleteButton } from "@/components/submit-button";
import {
  InvoiceReportingForm,
  CostStayForm,
  type ReportingStay,
} from "@/components/reporting-link-forms";
import { reportingAction } from "./actions";
const uuid = (value?: string) =>
  value &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
const pageNumber = (value?: string) =>
  Math.max(1, Math.min(10000, Math.floor(Number(value) || 1)));
type Options = {
  horses: { id: string; barn_name: string }[];
  stays: ReportingStay[];
};
export default async function Attribution({
  searchParams,
}: {
  searchParams: Promise<{
    invoice?: string;
    expense?: string;
    horse?: string;
    allocation?: string;
    ipage?: string;
    cpage?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const invoiceId = uuid(params.invoice),
    expenseId = uuid(params.expense),
    horseId = uuid(params.horse),
    allocationId = uuid(params.allocation);
  const ipage = pageNumber(params.ipage),
    cpage = pageNumber(params.cpage);
  let sourceQuery = db
    .from("reporting_cost_sources")
    .select("*")
    .eq("expense_id", expenseId ?? "")
    .eq("horse_id", horseId ?? "");
  sourceQuery = allocationId
    ? sourceQuery.eq("shared_allocation_id", allocationId)
    : sourceQuery.is("shared_allocation_id", null);
  const [invoices, costs, invoice, source, options] = await Promise.all([
    db
      .from("invoices")
      .select(
        "id,invoice_number,issue_date,status,customer_id,invoice_reporting_links(id,retired_at)",
        { count: "exact" },
      )
      .is("stay_id", null)
      .neq("status", "void")
      .order("issue_date", { ascending: false })
      .order("id")
      .range((ipage - 1) * 25, ipage * 25 - 1),
    db
      .from("reporting_cost_sources")
      .select("*", { count: "exact" })
      .order("expense_date", { ascending: false })
      .order("expense_id")
      .order("horse_id")
      .range((cpage - 1) * 25, cpage * 25 - 1),
    invoiceId
      ? db
          .from("invoices")
          .select("id,invoice_number,status,stay_id,customer_id")
          .eq("id", invoiceId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    expenseId && horseId && (!params.allocation || allocationId)
      ? sourceQuery.maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.rpc("reporting_assignment_options"),
  ]);
  let costHistoryQuery = db
    .from("cost_stay_splits")
    .select("*,cost_stay_split_lines(*)")
    .eq("expense_id", expenseId ?? "")
    .eq("horse_id", horseId ?? "")
    .order("created_at", { ascending: false })
    .limit(10);
  costHistoryQuery = allocationId
    ? costHistoryQuery.eq("shared_allocation_id", allocationId)
    : costHistoryQuery.is("shared_allocation_id", null);
  const [invoiceHistory, costHistory] = await Promise.all([
    invoice.data
      ? db
          .from("invoice_reporting_links")
          .select("*")
          .eq("invoice_id", invoice.data.id)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
    expenseId && horseId && (!params.allocation || allocationId)
      ? costHistoryQuery
      : Promise.resolve({ data: [], error: null }),
  ]);
  const data = options.data as Options | null;
  const activeInvoice = invoiceHistory.data?.find((r) => !r.retired_at),
    activeCost = costHistory.data?.find((r) => !r.retired_at);
  const failed = [
    invoices,
    costs,
    invoice,
    source,
    options,
    invoiceHistory,
    costHistory,
  ].some((r) => r.error);
  const invoiceLabel = (i: { invoice_number: number | null }) =>
    i.invoice_number ? `SAPH-${i.invoice_number}` : "Draft invoice";
  const sourceUrl = (s: {
    expense_id: string;
    horse_id: string;
    shared_allocation_id: string | null;
  }) =>
    `/admin/attribution?expense=${s.expense_id}&horse=${s.horse_id}${s.shared_allocation_id ? `&allocation=${s.shared_allocation_id}` : ""}`;
  const horseName = (id: string) =>
    data?.horses.find((h) => h.id === id)?.barn_name ?? "Horse";
  const stayLabel = (id: string) => {
    const s = data?.stays.find((s) => s.id === id);
    return s
      ? `${dateLabel(s.arrival_date)} – ${s.departure_date ? dateLabel(s.departure_date) : "ongoing"}`
      : "Stay";
  };
  return (
    <>
      <PageHeading
        eyebrow="CLEAR RECORDS"
        title="Assign income & costs"
        description="Link recorded money to the horse and training stay it belongs to."
      />
      <Notice
        error={
          failed
            ? "Reporting assignments could not load. Check the latest migration and refresh."
            : params.error ||
              ((params.invoice && !invoice.data) ||
              (params.expense && !source.data && !costHistory.data?.length)
                ? "The selected invoice or current cost source was not found."
                : undefined)
        }
        success={params.success}
      />
      <p className="notice">
        These private reporting links leave customer invoices, ownership, and
        business totals unchanged. They apply to all payment dates, including
        prior periods, so corrections restate past reports. Shared costs must
        first be divided among horses in{" "}
        <Link href="/admin/allocations">Shared costs</Link>.
      </p>
      {!failed && data && invoice.data && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{invoiceLabel(invoice.data)} · income assignment</h2>
            <Link
              className="text-link"
              href={`/admin/invoices/${invoice.data.id}`}
            >
              View invoice
            </Link>
          </div>
          {invoice.data.stay_id ? (
            <p>
              This invoice already belongs to {stayLabel(invoice.data.stay_id)}.
              Its original training stay determines income attribution.
            </p>
          ) : invoice.data.status === "void" ? (
            <p>Voided invoices have no active receipts to assign.</p>
          ) : (
            <InvoiceReportingForm
              key={activeInvoice?.id ?? invoice.data.id}
              invoice={invoice.data.id}
              customer={invoice.data.customer_id}
              horses={data.horses}
              stays={data.stays}
              current={activeInvoice}
              request={crypto.randomUUID()}
            />
          )}
          {activeInvoice && (
            <form
              action={reportingAction.bind(null, "clear-invoice")}
              className="record-form separated"
            >
              <input type="hidden" name="invoice_id" value={invoice.data.id} />
              <label>
                Reason for clearing
                <input name="reason" required maxLength={2000} />
              </label>
              <DeleteButton
                label="Clear income assignment"
                confirmText="Clear this reporting link? Receipts will become unassigned again. The invoice and payments will remain unchanged."
              />
            </form>
          )}
          <div className="record-form separated">
            <h3>Income assignment history (latest 10)</h3>
            {invoiceHistory.data?.map((r) => (
              <p key={r.id}>
                <strong>
                  {r.retired_at ? "Retired" : "Active"}: {r.horse_name}
                </strong>
                {r.stay_id ? ` · ${stayLabel(r.stay_id)}` : " · horse only"}
                <br />
                {r.reason}
                {r.retired_reason ? ` · ${r.retired_reason}` : ""}
              </p>
            ))}
          </div>
        </section>
      )}
      {!failed && data && source.data && (
        <section className="panel">
          <div className="panel-heading">
            <h2>
              {horseName(source.data.horse_id)} ·{" "}
              {money(source.data.amount_cents)} {source.data.kind} cost
            </h2>
            <Link
              className="text-link"
              href={`/admin/expenses?edit=${source.data.expense_id}`}
            >
              Expense / receipts
            </Link>
          </div>
          <p>
            {source.data.vendor || "No vendor"} · expense dated{" "}
            {dateLabel(source.data.expense_date)} ·{" "}
            {source.data.paid_on
              ? `paid ${dateLabel(source.data.paid_on)}`
              : "unpaid"}
            . Reports use the payment date.
          </p>
          {data.stays.some((s) => s.horse_id === source.data.horse_id) ? (
            <CostStayForm
              key={
                activeCost?.id ??
                `${source.data.expense_id}:${source.data.shared_allocation_id}`
              }
              expense={source.data.expense_id}
              horse={source.data.horse_id}
              allocation={source.data.shared_allocation_id}
              amount={source.data.amount_cents}
              stays={data.stays.filter(
                (s) => s.horse_id === source.data.horse_id,
              )}
              current={activeCost?.cost_stay_split_lines}
              request={crypto.randomUUID()}
            />
          ) : (
            <p>
              This horse has no training stays. Its cost remains in horse-level
              reports without a stay assignment.
            </p>
          )}
          {activeCost && (
            <form
              action={reportingAction.bind(null, "clear-cost")}
              className="record-form separated"
            >
              <input
                type="hidden"
                name="expense_id"
                value={source.data.expense_id}
              />
              <input
                type="hidden"
                name="horse_id"
                value={source.data.horse_id}
              />
              <input
                type="hidden"
                name="allocation_id"
                value={source.data.shared_allocation_id ?? ""}
              />
              <label>
                Reason for clearing
                <input name="reason" required maxLength={2000} />
              </label>
              <DeleteButton
                label="Clear stay cost split"
                confirmText="Clear this stay split? The cost will remain with the horse, and its stay portion will become unassigned. History will remain."
              />
            </form>
          )}
          <div className="record-form separated">
            <h3>Stay cost history (latest 10)</h3>
            {costHistory.data?.map((r) => (
              <details key={r.id}>
                <summary>
                  {r.retired_at ? "Retired" : "Active"} · source{" "}
                  {money(r.source_amount_cents)}
                </summary>
                <p>
                  {r.reason}
                  {r.retired_reason ? ` · ${r.retired_reason}` : ""}
                </p>
                {r.cost_stay_split_lines.map(
                  (l: { stay_id: string; amount_cents: number }) => (
                    <p key={l.stay_id}>
                      {stayLabel(l.stay_id)}: {money(l.amount_cents)}
                    </p>
                  ),
                )}
              </details>
            ))}
          </div>
          {source.data.shared_allocation_id && (
            <p className="notice">
              This split belongs to this saved shared-cost revision. If you
              revise or clear the horse allocation, its stay split stops
              contributing to reports. Review stay assignments for the new
              shared-cost revision.
            </p>
          )}
        </section>
      )}
      {!failed && !source.data && costHistory.data?.length ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>Previous stay cost assignments</h2>
            <Link className="text-link" href="/admin/attribution">
              Current cost sources
            </Link>
          </div>
          <p className="notice">
            This source portion is no longer current. These saved assignments
            are retained for review and do not contribute to reports. Choose a
            current cost source to make a new assignment.
          </p>
          {costHistory.data.map((r) => (
            <details key={r.id}>
              <summary>
                {r.retired_at
                  ? "Retired revision"
                  : "Saved revision · source no longer current"}{" "}
                · {money(r.source_amount_cents)}
              </summary>
              <p>
                {r.reason}
                {r.retired_reason ? ` · ${r.retired_reason}` : ""}
              </p>
              {r.cost_stay_split_lines.map(
                (l: { stay_id: string; amount_cents: number }) => (
                  <p key={l.stay_id}>
                    {stayLabel(l.stay_id)}: {money(l.amount_cents)}
                  </p>
                ),
              )}
            </details>
          ))}
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-heading">
          <h2>Invoices without training stays</h2>
          <span className="count-badge">{invoices.count ?? 0} records</span>
        </div>
        <p>
          Stay-linked invoices already have income assignments. Manual invoices
          can be assigned to one horse and optionally one matching stay.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Status</th>
                <th>Reporting link</th>
              </tr>
            </thead>
            <tbody>
              {invoices.data?.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link
                      className="text-link"
                      href={`/admin/attribution?invoice=${i.id}`}
                    >
                      {invoiceLabel(i)}
                    </Link>
                  </td>
                  <td>{dateLabel(i.issue_date)}</td>
                  <td>{i.status}</td>
                  <td>
                    {i.invoice_reporting_links.some(
                      (r: { retired_at: string | null }) => !r.retired_at,
                    )
                      ? "Assigned / revise"
                      : "Unassigned"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!invoices.data?.length && !failed && (
          <p>No manual invoices to assign.</p>
        )}
        <nav className="log-pagination" aria-label="Manual invoice pages">
          {ipage > 1 ? (
            <Link href={`/admin/attribution?ipage=${ipage - 1}`}>Previous</Link>
          ) : (
            <span />
          )}
          <span>Page {ipage}</span>
          {ipage * 25 < (invoices.count ?? 0) ? (
            <Link href={`/admin/attribution?ipage=${ipage + 1}`}>Next</Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Horse costs available for stay assignment</h2>
          <span className="count-badge">{costs.count ?? 0} portions</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date / vendor</th>
                <th>Horse</th>
                <th>Source</th>
                <th>Cost</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {costs.data?.map((c) => (
                <tr
                  key={`${c.expense_id}:${c.shared_allocation_id}:${c.horse_id}`}
                >
                  <td>
                    {dateLabel(c.expense_date)}
                    <small className="cell-secondary">
                      {c.vendor || "No vendor"}
                    </small>
                  </td>
                  <td>{horseName(c.horse_id)}</td>
                  <td>
                    {c.kind} · {c.paid_on ? "paid" : "unpaid"}
                  </td>
                  <td>{money(c.amount_cents)}</td>
                  <td>
                    <Link className="text-link" href={sourceUrl(c)}>
                      Assign / review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!costs.data?.length && !failed && (
          <p>No direct horse expenses or saved shared-cost portions yet.</p>
        )}
        <nav className="log-pagination" aria-label="Horse cost pages">
          {cpage > 1 ? (
            <Link href={`/admin/attribution?cpage=${cpage - 1}`}>Previous</Link>
          ) : (
            <span />
          )}
          <span>Page {cpage}</span>
          {cpage * 25 < (costs.count ?? 0) ? (
            <Link href={`/admin/attribution?cpage=${cpage + 1}`}>Next</Link>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}
