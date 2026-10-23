import {
  BillingAutomation,
  type AutomationConfig,
  type AutomationRun,
} from "@/components/billing-automation";
import { SectionTabs } from "@/components/section-tabs";
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
  const [result, automation, runs] = await Promise.all([
    db.rpc("recurring_billing_overview"),
    db
      .from("billing_automation")
      .select("enabled,updated_at,last_checked_at")
      .single(),
    db
      .from("billing_automation_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20),
  ]);
  const ready = Boolean(
    process.env.VERCEL_ENV === "production" &&
    (process.env.CRON_SECRET?.length ?? 0) >= 32 &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
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
      <SectionTabs
        id="recurring"
        label="Recurring billing sections"
        sections={[
          {
            id: "agreements",
            label: "Agreements",
            content: (
              <>
                <p className="notice">
                  Enable recurring preparation on each training agreement and
                  choose its first period date. Prepare one due cycle at a time.
                  Complete calendar-based invoices finalize automatically;
                  missing records or actual-cost reviews leave a draft.
                  Manual/no-proration agreements stay for manual review. Use the
                  Automatic billing tab to review daily scheduling.
                </p>
                {rows.length ? (
                  <RecurringBillingCards rows={rows} />
                ) : (
                  !result.error && (
                    <section className="panel record-form">
                      <h2>No recurring agreements enabled</h2>
                      <p>
                        Review the billing schedule and first period date on a
                        training stay before enabling it.
                      </p>
                      <Link className="button secondary" href="/admin/training">
                        Training agreements
                      </Link>
                    </section>
                  )
                )}
              </>
            ),
          },
          {
            id: "automation",
            label: "Automatic billing",
            content: (
              <>
                {runs.error && (
                  <p className="notice error">
                    Run history could not load. Refresh after checking the
                    latest migration.
                  </p>
                )}
                <BillingAutomation
                  config={
                    automation.error
                      ? null
                      : (automation.data as AutomationConfig)
                  }
                  runs={(runs.data ?? []) as AutomationRun[]}
                  ready={ready}
                />
              </>
            ),
          },
        ]}
      />
    </>
  );
}
