import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PageHeading, Notice } from "@/components/ui";
import {
  RecurringBillingCards,
  type RecurringStay,
} from "@/components/recurring-billing";
export default async function Recurring({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const result = await db.rpc("recurring_billing_overview");
  const rows = (result.data ?? []) as RecurringStay[];
  return (
    <>
      <Link className="text-link" href="/admin/invoices">
        Back to invoices
      </Link>
      <PageHeading
        title="Recurring billing"
        description="Completed cycles, clear review steps, and no duplicate charges."
      />
      <Notice
        error={
          result.error
            ? "Recurring billing could not load. Check the latest migration."
            : params.error
        }
        success={params.success}
      />
      <p className="notice">
        Enable recurring preparation on each training agreement and choose its
        first period date. Prepare one due cycle at a time. Complete
        calendar-based invoices finalize automatically; missing records or
        actual-cost reviews leave a draft. Manual/no-proration agreements stay
        for manual review. Background scheduling is not enabled.
      </p>
      {rows.length ? (
        <RecurringBillingCards rows={rows} />
      ) : (
        !result.error && (
          <section className="panel record-form">
            <h2>No recurring agreements enabled</h2>
            <p>
              Review the billing schedule and first period date on a training
              stay before enabling it.
            </p>
            <Link className="button secondary" href="/admin/training">
              Training agreements
            </Link>
          </section>
        )
      )}
    </>
  );
}
