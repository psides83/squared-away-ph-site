import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today, dateLabel, money } from "@/lib/format";
import { Notice } from "@/components/ui";
import { ActionPanel } from "@/components/action-panel";
import { SupplierCreditForm } from "@/components/supplier-credit-forms";
import {
  CreditApplicationList,
  type CreditApplication,
} from "@/components/expense-supplier-credits";
export async function InventoryCredits({
  params,
}: {
  params: {
    credit?: string;
    credit_page?: string;
    credit_history_page?: string;
    credit_return?: string;
    credit_new?: string;
  };
}) {
  const { db } = await requireAdmin();
  const page = Math.max(
      1,
      Math.min(10000, Math.floor(Number(params.credit_page) || 1)),
    ),
    history = Math.max(
      1,
      Math.min(10000, Math.floor(Number(params.credit_history_page) || 1)),
    );
  const valid = (s?: string) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null);
  const [result, source] = await Promise.all([
    db.rpc("supplier_credit_overview", {
      p_page: params.credit ? 1 : page,
      p_credit: valid(params.credit),
      p_history_page: history,
    }),
    valid(params.credit_return)
      ? db
          .from("supplier_returns")
          .select("id,vendor,cancelled_at")
          .eq("id", params.credit_return!)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (result.error || source.error || !result.data)
    return (
      <Notice error="Supplier credits could not load. Check the latest migration." />
    );
  if (params.credit_return && (!source.data || source.data.cancelled_at))
    return (
      <>
        <Notice error="Choose an active supplier return before recording a linked credit." />
        <Link
          className="button secondary"
          href="/admin/inventory?section=credits#inventory-credits"
        >
          All supplier credits
        </Link>
      </>
    );
  const data = result.data as {
    available_cents: number;
    total: number;
    rows: {
      id: string;
      vendor: string;
      return_id: string | null;
      issued_on: string;
      amount_cents: number;
      used_cents: number;
      reference: string | null;
      reason: string;
      cancelled_at: string | null;
      cancel_reason: string | null;
      application_count: number;
      applications: CreditApplication[];
    }[];
  };
  return (
    <>
      <div className="section-action-heading">
        <div>
          <h2>Supplier credits</h2>
          <p className="muted">
            Available across suppliers:{" "}
            <strong>{money(data.available_cents)}</strong>
          </p>
        </div>
        <ActionPanel
          id="new-supplier-credit"
          label="Record supplier credit"
          defaultOpen={params.credit_new === "1"}
        >
          <SupplierCreditForm
            operation="issue"
            date={today()}
            request={crypto.randomUUID()}
            returnId={source.data?.id}
            vendor={source.data?.vendor}
          />
        </ActionPanel>
      </div>
      <p className="muted">
        Record credits actually issued. Apply them from the purchase expense’s
        Supplier credits tab. Balances belong to their named supplier and are
        separate from cash refunds.
      </p>
      {params.credit && (
        <Link
          className="button secondary"
          href="/admin/inventory?section=credits#inventory-credits"
        >
          All supplier credits
        </Link>
      )}
      <div className="feeding-history-days">
        {data.rows.map((c) => (
          <article className="panel" key={c.id}>
            <header className="panel-heading">
              <div>
                <h3>{c.vendor}</h3>
                <p className="muted">
                  {dateLabel(c.issued_on)}
                  {c.reference ? ` · ${c.reference}` : ""}
                </p>
              </div>
              {c.cancelled_at && <span className="tag">Cancelled</span>}
            </header>
            <div className="record-form stack">
              <div className="supplier-return-values">
                <div>
                  <span>Issued</span>
                  <strong>{money(c.amount_cents)}</strong>
                </div>
                <div>
                  <span>Used</span>
                  <strong>{money(c.used_cents)}</strong>
                </div>
                <div>
                  <span>Available</span>
                  <strong>
                    {money(c.cancelled_at ? 0 : c.amount_cents - c.used_cents)}
                  </strong>
                </div>
              </div>
              <p>{c.reason}</p>
              {c.cancelled_at ? (
                <p className="muted">Cancelled: {c.cancel_reason}</p>
              ) : (
                <ActionPanel
                  id={`cancel-credit-${c.id}`}
                  label="Correct credit entry"
                >
                  <SupplierCreditForm
                    operation="cancel"
                    date={today()}
                    id={c.id}
                  />
                </ActionPanel>
              )}
              {c.return_id && (
                <Link
                  className="text-link"
                  href={`/admin/inventory?section=returns&return=${c.return_id}#return-${c.return_id}`}
                >
                  Source return & documents
                </Link>
              )}
              <details
                id={`credit-applications-${c.id}`}
                open={Boolean(params.credit)}
              >
                <summary>Purchase applications ({c.application_count})</summary>
                {params.credit ? (
                  <>
                    <CreditApplicationList
                      rows={c.applications}
                      date={today()}
                    />
                    <div className="row-actions">
                      {history > 1 && (
                        <Link
                          className="button secondary"
                          href={`?section=credits&credit=${c.id}&credit_history_page=${history - 1}#inventory-credits`}
                        >
                          Newer applications
                        </Link>
                      )}
                      {history * 20 < c.application_count && (
                        <Link
                          className="button secondary"
                          href={`?section=credits&credit=${c.id}&credit_history_page=${history + 1}#inventory-credits`}
                        >
                          Older applications
                        </Link>
                      )}
                    </div>
                    {!c.applications.length && (
                      <p className="muted">No applications on this page.</p>
                    )}
                  </>
                ) : (
                  <Link
                    className="button secondary"
                    href={`/admin/inventory?section=credits&credit=${c.id}#credit-applications-${c.id}`}
                  >
                    View purchase applications
                  </Link>
                )}
              </details>
            </div>
          </article>
        ))}
      </div>
      {!data.rows.length && (
        <section className="panel record-form">
          <p>No supplier credits recorded.</p>
        </section>
      )}
      <nav className="row-actions" aria-label="Supplier credit pages">
        {page > 1 && (
          <Link
            className="button secondary"
            href={`?section=credits&credit_page=${page - 1}#inventory-credits`}
          >
            Newer credits
          </Link>
        )}
        {!params.credit && page * 25 < data.total && (
          <Link
            className="button secondary"
            href={`?section=credits&credit_page=${page + 1}#inventory-credits`}
          >
            Older credits
          </Link>
        )}
      </nav>
    </>
  );
}
