import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today } from "@/lib/format";
import { Notice } from "@/components/ui";
import { HelpPanel } from "@/components/help-panel";
import { ActionPanel } from "@/components/action-panel";
import { SupplierReturnForm } from "@/components/supplier-return-form";
import {
  SupplierReturnList,
  type SupplierReturnOverview,
} from "@/components/supplier-return-list";
export async function InventoryReturns({
  params,
}: {
  params: {
    returns_page?: string;
    return?: string;
    refund_page?: string;
    success?: string;
    error?: string;
  };
}) {
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.returns_page) || 1)),
  );
  const selectedReturn =
    params.return &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.return,
    )
      ? params.return
      : null;
  const refundPage = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.refund_page) || 1)),
  );
  const { db } = await requireAdmin();
  const [returns, products, units] = await Promise.all([
    db.rpc("supplier_return_overview", {
      p_page: selectedReturn ? 1 : page,
      p_return: selectedReturn,
      p_refund_page: refundPage,
    }),
    db.from("inventory_products").select("id,name,archived").order("name"),
    db
      .from("inventory_units")
      .select("id,product_id,label,ounces_per_unit")
      .order("label"),
  ]);
  const failed = returns.error || products.error || units.error;
  return (
    <>
      <Notice
        success={params.success}
        error={
          failed
            ? "Return records could not load. Refresh before making changes."
            : params.error
        }
      />
      <div className="row-actions">
        {selectedReturn && (
          <Link
            className="text-link"
            href="/admin/inventory?section=returns#inventory-returns"
          >
            All returns
          </Link>
        )}
        <Link className="button secondary" href="/admin/inventory/recovery">
          Supplier follow-up
        </Link>
        <Link className="text-link" href="/admin/reports#reports-cash">
          Cash reports
        </Link>
        {!failed && (
          <ActionPanel id="new-supplier-return" label="Record return">
            <div className="panel-heading">
              <h2>Return stock to supplier</h2>
            </div>
            <SupplierReturnForm
              products={products.data ?? []}
              units={units.data ?? []}
              date={today()}
            />
          </ActionPanel>
        )}
      </div>
      <HelpPanel title="Stock value, refunds and corrections">
        <p>
          Stock leaves at its current weighted average cost. Refunds are
          recorded separately on the day money is received, including partial
          refunds. They increase net business cash without being counted as
          customer income or reducing the original expense record. Horse and
          training-visit reports show supplier refunds as unassigned business
          credits.
        </p>
        <p>
          The difference between refunds and stock value is an inventory
          comparison, not an additional cash profit entry. This records physical
          returns and received money. Supplier credits are recorded in the
          Supplier credits tab. Set optional expected cash and store-credit
          amounts on each return to track what remains outstanding. Issued
          credit counts as received even after it is spent; reversed refunds and
          cancelled credits reopen the target. Replacement purchases are
          recorded separately at full value and linked explicitly from each
          return.
        </p>
        <p>
          Use correction actions only for mistaken records. Refund reversals
          restate the original cash period; cancelling a mistaken return
          restores stock at the return’s recorded cost and retains its history.
          Active refunds, linked supplier credits and replacement purchase links
          must be corrected first.
        </p>
      </HelpPanel>
      {!failed && (
        <SupplierReturnList
          data={returns.data as SupplierReturnOverview}
          date={today()}
          page={selectedReturn ? 1 : page}
          refundPage={refundPage}
        />
      )}
    </>
  );
}
