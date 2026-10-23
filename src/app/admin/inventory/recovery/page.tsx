import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PageHeading, Notice } from "@/components/ui";
import { HelpPanel } from "@/components/help-panel";
import {
  SupplierRecoveryQueue,
  type RecoveryFilter,
  type RecoveryQueue,
} from "@/components/supplier-recovery-queue";
export default async function SupplierRecovery({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const params = await searchParams;
  const filter: RecoveryFilter = [
    "outstanding",
    "overdue",
    "unset",
    "all",
  ].includes(params.filter ?? "")
    ? (params.filter as RecoveryFilter)
    : "outstanding";
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.page) || 1)),
  );
  const { db } = await requireAdmin();
  const { data, error } = await db.rpc("supplier_recovery_queue", {
    p_filter: filter,
    p_page: page,
  });
  return (
    <>
      <Link
        className="button secondary"
        href="/admin/inventory?section=returns#inventory-returns"
      >
        Back to returns
      </Link>
      <PageHeading
        title="Supplier follow-up"
        description="Track expected refunds and store credits across all active returns."
      />
      <HelpPanel title="What counts as outstanding or overdue?">
        <p>
          Only explicitly saved targets contribute to outstanding amounts. Blank
          targets stay unknown; set zero if nothing is expected. A return may
          have a known outstanding amount and an unset target at the same time.
        </p>
        <p>
          An outstanding amount becomes overdue the day after its due date,
          using the business date in Central Time. Due today is not overdue.
          Returns with no due date remain outstanding without being labelled
          overdue. Cancelled returns stay in their original history and are
          excluded here.
        </p>
        <p>
          Active cash refunds and issued linked credits reduce the matching
          target. Spending an issued credit does not reopen that target.
          Reversing a refund or cancelling a credit does. Above-target receipts
          do not offset another return or its other recovery type. These are
          follow-up balances, not cash income or available-credit balances.
        </p>
      </HelpPanel>
      {error || !data ? (
        <Notice error="Supplier follow-up could not load. Check the latest migration and refresh." />
      ) : (
        <SupplierRecoveryQueue
          data={data as RecoveryQueue}
          filter={filter}
          page={page}
        />
      )}
    </>
  );
}
