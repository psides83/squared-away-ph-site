import { ActionPanel } from "@/components/action-panel";
import { Receipt } from "lucide-react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { money, dateLabel } from "@/lib/format";
import { PageHeading, Notice, EmptyState } from "@/components/ui";
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
        title="Match income & expenses"
        description="Choose which horse and training visit an invoice or expense belongs to."
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
      <section className="panel">
        <div className="panel-heading">
          <h2>When do I use this page?</h2>
        </div>
        <div className="record-form">
          <p>
            A <strong>training visit</strong> is one arrival-to-departure period
            recorded in Training stays. A horse may have several visits if it
            leaves and comes back.
          </p>
          <p>
            <strong>For income:</strong> invoices created for a training stay
            already belong to that horse and visit. If you created an invoice
            without a stay, choose the horse here so its payments appear in the
            right report.
          </p>
          <p>
            <strong>For expenses:</strong> first record the bill in{" "}
            <Link className="text-link" href="/admin/expenses">
              Expenses
            </Link>{" "}
            and choose the horse. That already includes the cost in the horse’s
            report. Use this page to put some or all of that cost against a
            particular training visit.
          </p>
          <p>
            <strong>Example:</strong> a $150 farrier bill for a horse’s June
            visit can go entirely against that visit. If a cost covers two
            visits, divide the amount between them.
          </p>
          <p>
            For a bill shared by several horses, divide it between horses in{" "}
            <Link className="text-link" href="/admin/allocations">
              Shared costs
            </Link>{" "}
            first. Each horse’s share will then appear below.
          </p>
          <p className="muted">
            These choices organize reports and identify costs available for
            actual-cost boarding invoices. To charge a customer, add the cost to
            an invoice in Invoices. Changing a match also updates earlier
            reports.
          </p>
        </div>
      </section>
      {!failed && data && invoice.data && (
        <ActionPanel
          id="match-income"
          label="Match invoice income"
          defaultOpen
          closeHref="/admin/attribution"
        >
          <div className="panel-heading">
            <h2>
              {invoiceLabel(invoice.data)} · choose the horse for these payments
            </h2>
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
              Its payments already appear under that horse and training visit.
            </p>
          ) : invoice.data.status === "void" ? (
            <p>This invoice is voided, so it has no payments to match.</p>
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
                Why are you removing this match?
                <input name="reason" required maxLength={2000} />
              </label>
              <DeleteButton
                label="Remove income match"
                confirmText="Remove the horse and visit match for this invoice? Its payments will still count in business totals."
              />
            </form>
          )}
          <div className="record-form separated">
            <h3>Previous income matches (latest 10)</h3>
            {invoiceHistory.data?.map((r) => (
              <p key={r.id}>
                <strong>
                  {r.retired_at ? "Previous" : "Current"}: {r.horse_name}
                </strong>
                {r.stay_id ? ` · ${stayLabel(r.stay_id)}` : " · horse only"}
                <br />
                {r.reason}
                {r.retired_reason ? ` · ${r.retired_reason}` : ""}
              </p>
            ))}
          </div>
        </ActionPanel>
      )}
      {!failed && data && source.data && (
        <ActionPanel
          id="match-cost"
          label="Match a horse expense"
          defaultOpen
          closeHref="/admin/attribution"
        >
          <div className="panel-heading">
            <h2>
              {horseName(source.data.horse_id)} ·{" "}
              {money(source.data.amount_cents)}{" "}
              {source.data.kind === "direct"
                ? "expense for this horse"
                : "share of a barn bill"}
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
              This horse has no training visits recorded yet. The expense
              already counts in its horse report. Add a Training stay if you
              want to track costs for a particular visit.
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
                Why are you removing this match?
                <input name="reason" required maxLength={2000} />
              </label>
              <DeleteButton
                label="Remove visit amounts"
                confirmText="Remove these visit amounts? The expense will still count in the horse and business reports. The previous amounts will remain in history."
              />
            </form>
          )}
          <div className="record-form separated">
            <h3>Previous visit amounts (latest 10)</h3>
            {costHistory.data?.map((r) => (
              <details key={r.id}>
                <summary>
                  {r.retired_at ? "Previous" : "Current"} · original horse cost{" "}
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
              These visit amounts use the horse’s saved share of a barn bill. If
              you change that share in Shared costs, return here to choose visit
              amounts for the new share. The old amounts remain in history.
            </p>
          )}
        </ActionPanel>
      )}
      {!failed && !source.data && costHistory.data?.length ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>Previous visit amounts</h2>
            <Link className="text-link" href="/admin/attribution">
              Current horse expenses
            </Link>
          </div>
          <p className="notice">
            This horse’s expense or share of a barn bill has changed. These
            previous visit amounts are kept as history and no longer count in
            reports. Choose the current horse expense to enter new amounts.
          </p>
          {costHistory.data.map((r) => (
            <details key={r.id}>
              <summary>
                {r.retired_at
                  ? "Previous amounts"
                  : "Previous amounts — expense changed"}{" "}
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
          <h2>Invoices that need a horse match</h2>
          <span className="count-badge">{invoices.count ?? 0} records</span>
        </div>
        <p>
          Only invoices created without a training stay appear here. Choose the
          horse for their payments, and a training visit if one applies.
          Previously matched invoices stay listed so you can review them.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Status</th>
                <th>Horse match</th>
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
                      ? "Matched — review"
                      : "Choose a horse"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!invoices.data?.length && !failed && (
          <p>
            No invoices need a horse match. Invoices created for a training stay
            are matched automatically.
          </p>
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
          <h2>Choose the training visit for a horse expense</h2>
          <span className="count-badge">{costs.count ?? 0} horse expenses</span>
        </div>
        {costs.data?.length ? (
          <>
            <p className="record-form">
              These expenses already belong to a horse. Open one to choose the
              training visit it belongs to, or review amounts you saved earlier.
              The list includes both paid and unpaid expenses.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date / vendor</th>
                    <th>Horse</th>
                    <th>Expense type / payment</th>
                    <th>Horse’s cost</th>
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
                        {c.kind === "direct"
                          ? "Bill for this horse"
                          : "Share of a barn bill"}{" "}
                        · {c.paid_on ? "paid" : "unpaid"}
                      </td>
                      <td>{money(c.amount_cents)}</td>
                      <td>
                        <Link className="text-link" href={sourceUrl(c)}>
                          Choose visit / review amounts
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : !failed ? (
          <>
            <EmptyState
              icon={Receipt}
              title="No horse expenses to organize yet."
              description="Add a bill in Expenses and choose the horse it belongs to. For a shared barn bill, divide it between horses in Shared costs first."
              href="/admin/expenses?new=1"
              label="Add a horse expense"
            />
            <p className="record-form">
              <Link className="text-link" href="/admin/allocations">
                Divide a shared barn bill between horses
              </Link>
            </p>
          </>
        ) : null}
        {(costs.count ?? 0) > 0 && (
          <nav className="log-pagination" aria-label="Horse expense pages">
            {cpage > 1 ? (
              <Link href={`/admin/attribution?cpage=${cpage - 1}`}>
                Previous
              </Link>
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
        )}
      </section>
    </>
  );
}
