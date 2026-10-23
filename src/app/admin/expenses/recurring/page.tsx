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
  const [result, categories, horses] = await Promise.all([
    db.rpc("recurring_expense_overview"),
    db.from("expense_categories").select("id,name").order("name"),
    db.from("horses").select("id,barn_name").order("barn_name"),
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
      {!failed && (
        <RecurringExpenses
          rows={(result.data ?? []) as RecurringExpense[]}
          options={{
            categories: categories.data ?? [],
            horses: horses.data ?? [],
          }}
        />
      )}
    </>
  );
}
