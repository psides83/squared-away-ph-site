import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { PageHeading, Notice } from "@/components/ui";
import { ActionPanel } from "@/components/action-panel";
import { HelpPanel } from "@/components/help-panel";
import {
  SupplierExchangeForm,
  type ExchangePurchaseChoice,
} from "@/components/supplier-exchange-form";
import {
  SupplierExchangeList,
  type SupplierExchange,
} from "@/components/supplier-exchange-list";
export default async function ReturnExchanges({
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
  const { data, error } = await db.rpc("supplier_return_exchanges", {
    p_return: id,
    p_page: page,
  });
  if (error || !data)
    return (
      <Notice error="Exchange links could not load. Check the latest migration and refresh." />
    );
  const result = data as {
    vendor: string;
    cancelled: boolean;
    total: number;
    rows: SupplierExchange[];
    eligible: ExchangePurchaseChoice[];
  };
  return (
    <>
      <Link
        className="button secondary"
        href={`/admin/inventory?section=returns&return=${id}#return-${id}`}
      >
        Back to return
      </Link>
      <PageHeading title="Replacement purchases" description={result.vendor} />
      {result.cancelled && (
        <p className="notice">
          This return was cancelled. Saved exchange history remains available.
        </p>
      )}
      <div className="row-actions">
        {!result.cancelled && result.eligible.length > 0 && (
          <ActionPanel id="link-replacement" label="Link replacement purchase">
            <SupplierExchangeForm returnId={id} choices={result.eligible} />
          </ActionPanel>
        )}
        {!result.cancelled && (
          <Link
            className="button secondary"
            href="/admin/inventory?section=record#stock-entry"
          >
            Record purchase / stock
          </Link>
        )}
      </div>
      {!result.cancelled && (
        <p className="muted">
          Choose among the latest 100 unlinked inventory purchases from the same
          supplier. If your purchase is missing, check its supplier name or open
          it in Expenses to review its records.
        </p>
      )}
      <HelpPanel title="How exchange links affect costs and payments">
        <p>
          Record the replacement purchase separately at its full cost, then link
          it here. A purchase may relate to more than one return; these links
          describe the exchange and do not split or allocate its amount.
        </p>
        <p>
          Record actual supplier credit in Supplier credits. Open the
          replacement purchase’s Supplier credits tab to apply credit actually
          used, then record its paid/settled date separately. Cash refunds and
          expected recovery targets stay on the original return.
        </p>
        <p>
          Remove mistaken links with a reason before cancelling a return,
          changing a purchase supplier or voiding a replacement purchase.
          Removing a link does not reverse credit applications or payments.
        </p>
      </HelpPanel>
      <SupplierExchangeList rows={result.rows} />
      {!result.rows.length && (
        <section className="panel record-form">
          <p>No replacement purchases linked yet.</p>
        </section>
      )}
      <nav className="row-actions" aria-label="Exchange history">
        {page > 1 && (
          <Link className="button secondary" href={`?page=${page - 1}`}>
            Newer links
          </Link>
        )}
        {page * 25 < result.total && (
          <Link className="button secondary" href={`?page=${page + 1}`}>
            Older links
          </Link>
        )}
      </nav>
    </>
  );
}
