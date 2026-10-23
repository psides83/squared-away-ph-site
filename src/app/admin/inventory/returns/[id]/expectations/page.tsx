import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dateLabel, money } from "@/lib/format";
import { Notice } from "@/components/ui";
import type { ReturnExpectation } from "@/lib/return-expectations";
export default async function ExpectationHistory({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(query.page) || 1)),
  );
  const { db } = await requireAdmin();
  const [record, history] = await Promise.all([
    db.from("supplier_returns").select("id,vendor").eq("id", id).maybeSingle(),
    db
      .from("supplier_return_expectation_history")
      .select("version,snapshot,created_at", { count: "exact" })
      .eq("return_id", id)
      .order("created_at", { ascending: false })
      .order("version")
      .range((page - 1) * 25, page * 25 - 1),
  ]);
  if (record.error || history.error)
    return (
      <Notice error="Expectation history could not load. Refresh and try again." />
    );
  if (!record.data) notFound();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{record.data.vendor}</p>
          <h1>Expectation history</h1>
        </div>
        <Link
          className="button secondary"
          href={`/admin/inventory?section=returns&return=${id}#return-${id}`}
        >
          Back to return
        </Link>
      </div>
      <p className="muted">
        Saved targets, newest first. These are expectations, not actual refund
        or credit transactions.
      </p>
      {!history.data?.length && (
        <p className="notice">No expectations saved.</p>
      )}
      {history.data?.map((row) => {
        const snapshot = row.snapshot as ReturnExpectation;
        return (
          <article className="panel" key={row.version}>
            <div className="panel-heading">
              <h2>
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "America/Chicago",
                }).format(new Date(row.created_at))}
              </h2>
            </div>
            <div className="record-form">
              <p>
                Cash refund:{" "}
                {snapshot.cash_cents === null
                  ? "Not set"
                  : money(snapshot.cash_cents)}
                {snapshot.cash_due
                  ? ` · Due ${dateLabel(snapshot.cash_due)}`
                  : ""}
              </p>
              <p>
                Store credit:{" "}
                {snapshot.credit_cents === null
                  ? "Not set"
                  : money(snapshot.credit_cents)}
                {snapshot.credit_due
                  ? ` · Due ${dateLabel(snapshot.credit_due)}`
                  : ""}
              </p>
              {snapshot.notes && <p>{snapshot.notes}</p>}
            </div>
          </article>
        );
      })}
      <div className="row-actions">
        {page > 1 && (
          <Link className="button secondary" href={`?page=${page - 1}`}>
            Newer changes
          </Link>
        )}
        {page * 25 < (history.count ?? 0) && (
          <Link className="button secondary" href={`?page=${page + 1}`}>
            Older changes
          </Link>
        )}
      </div>
    </>
  );
}
