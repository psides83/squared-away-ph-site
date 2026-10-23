import {
  ExpenseAutomation,
  type ExpenseAutomationConfig,
  type ExpenseAutomationRun,
} from "@/components/expense-automation";
import { SectionTabs } from "@/components/section-tabs";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Notice, PageHeading } from "@/components/ui";
import {
  RecurringExpenses,
  type RecurringExpense,
} from "@/components/recurring-expenses";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const [result, categories, horses, automation, runs] = await Promise.all([
    db.rpc("recurring_expense_overview"),
    db.from("expense_categories").select("id,name").order("name"),
    db.from("horses").select("id,barn_name").order("barn_name"),
    db.from("expense_automation").select("enabled,last_checked_at").single(),
    db
      .from("expense_automation_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20),
  ]);
  const failed = result.error || categories.error || horses.error;
  return (
    <>
      <Link className="text-link" href="/admin/expenses">
        Back to expenses
      </Link>
      <PageHeading
        title="Recurring expenses"
        description="Regular bills, prepared unpaid for your review."
      />
      <Notice
        error={
          failed
            ? "Recurring expenses could not load. Check the latest migration and refresh."
            : params.error
        }
        success={params.success}
      />
      <SectionTabs
        id="expenses"
        label="Recurring expense sections"
        sections={[
          {
            id: "schedules",
            label: "Schedules",
            content: !failed ? (
              <RecurringExpenses
                rows={(result.data ?? []) as RecurringExpense[]}
                options={{
                  categories: categories.data ?? [],
                  horses: horses.data ?? [],
                }}
              />
            ) : null,
          },
          {
            id: "automation",
            label: "Automatic creation",
            content: (
              <>
                {runs.error && (
                  <p className="notice error">
                    Automatic expense history could not load. Check the latest
                    migration.
                  </p>
                )}
                <ExpenseAutomation
                  config={
                    automation.error
                      ? null
                      : (automation.data as ExpenseAutomationConfig)
                  }
                  runs={(runs.data ?? []) as ExpenseAutomationRun[]}
                  ready={Boolean(
                    process.env.VERCEL_ENV === "production" &&
                    (process.env.CRON_SECRET?.length ?? 0) >= 32 &&
                    process.env.NEXT_PUBLIC_SUPABASE_URL &&
                    (process.env.SUPABASE_SECRET_KEY ||
                      process.env.SUPABASE_SERVICE_ROLE_KEY),
                  )}
                />
              </>
            ),
          },
        ]}
      />
    </>
  );
}
