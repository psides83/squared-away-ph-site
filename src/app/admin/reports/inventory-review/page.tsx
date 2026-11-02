import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PageHeading } from "@/components/ui";
import { ProfitInventoryReviews } from "@/components/profit-inventory-reviews";
import type { ProfitInventoryOptions } from "@/lib/business-profit";
import { today } from "@/lib/format";
import { validCashExportPeriod } from "@/lib/cash-export";
export default async function InventoryReview({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    page?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { db } = await requireAdmin();
  const q = await searchParams;
  const kind = ["return", "correction", "credit"].includes(q.kind ?? "")
    ? q.kind!
    : "return";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q.page) || 1)));
  const date = today();
  const valid = validCashExportPeriod(q.from ?? "", q.to ?? "");
  const from = valid ? q.from! : `${date.slice(0, 4)}-01-01`,
    to = valid ? q.to! : date;
  const r = await db.rpc("profit_inventory_options", {
    p_kind: kind,
    p_page: page,
  });
  return (
    <>
      <PageHeading
        eyebrow="FINANCIAL REVIEW"
        title="Inventory profit reviews"
        description="Review inventory outcomes without changing stock or recording payments."
      />
      <div className="row-actions">
        <Link
          className="button secondary"
          href={`/admin/reports?${new URLSearchParams({ from, to })}#reports-profit`}
        >
          Back to business profit
        </Link>
      </div>
      <ProfitInventoryReviews
        data={r.error ? null : (r.data as ProfitInventoryOptions | null)}
        from={from}
        to={to}
        page={page}
      />
    </>
  );
}
