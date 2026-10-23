import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Notice } from "@/components/ui";
export async function ExpenseExchanges({
  expense,
  page = 1,
}: {
  expense: string;
  page?: number;
}) {
  const { db } = await requireAdmin();
  const { data, error, count } = await db
    .from("supplier_exchange_links")
    .select(
      "id,return_id,notes,removed_at,remove_reason,supplier_returns(vendor,cancelled_at)",
      { count: "exact" },
    )
    .eq("expense_id", expense)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 25, page * 25 - 1);
  if (error)
    return (
      <Notice error="Exchange links could not load. Check the latest migration." />
    );
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>Related supplier returns</h2>
        </div>
        <div className="record-form stack">
          <p className="muted">
            Exchange links describe which returns this purchase replaces. They
            do not allocate purchase costs, apply store credit or record
            payments.
          </p>
          {!data?.length && (
            <p>
              No supplier returns linked to this purchase. Open a return’s
              Replacement purchases to link it.
            </p>
          )}
          {data?.map((row) => {
            const source = Array.isArray(row.supplier_returns)
              ? row.supplier_returns[0]
              : row.supplier_returns;
            return (
              <article className="log-entry" key={row.id}>
                <strong>{source?.vendor ?? "Supplier return"}</strong>
                <p>
                  <span className="tag">
                    {row.removed_at
                      ? "Link removed"
                      : source?.cancelled_at
                        ? "Return cancelled"
                        : "Linked"}
                  </span>
                </p>
                {row.notes && <p>{row.notes}</p>}
                {row.remove_reason && <p>Removed: {row.remove_reason}</p>}
                <Link
                  className="button secondary"
                  href={`/admin/inventory/returns/${row.return_id}/exchanges`}
                >
                  Return & exchange links
                </Link>
              </article>
            );
          })}
          <Link
            className="button secondary"
            href="/admin/inventory?section=returns#inventory-returns"
          >
            Browse supplier returns
          </Link>
        </div>
      </section>
      <nav className="row-actions" aria-label="Purchase exchange history">
        {page > 1 && (
          <Link
            className="button secondary"
            href={`?exchange_page=${page - 1}#expense-exchanges`}
          >
            Newer links
          </Link>
        )}
        {page * 25 < (count ?? 0) && (
          <Link
            className="button secondary"
            href={`?exchange_page=${page + 1}#expense-exchanges`}
          >
            Older links
          </Link>
        )}
      </nav>
    </>
  );
}
