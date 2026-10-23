import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { today } from "@/lib/format";
import { PageHeading, Notice } from "@/components/ui";
import { BulkExpenseForm } from "@/components/bulk-expense-form";
export default async function BulkExpenses() {
  const { db } = await requireAdmin();
  const [categories, horses] = await Promise.all([
    db.from("expense_categories").select("id,name").order("name"),
    db.from("horses").select("id,barn_name").order("barn_name"),
  ]);
  return (
    <>
      <Link className="button secondary" href="/admin/expenses">
        Back to expenses
      </Link>
      <PageHeading
        title="Bulk expense entry"
        description="Record several bills in one pass, with individual amounts and horse assignments."
      />
      <p className="notice">
        Buying feed, hay or supplements for stock?{" "}
        <Link
          className="inline-link"
          href="/admin/inventory?section=record#stock-entry"
        >
          Record purchases in Inventory
        </Link>{" "}
        so stock and expenses are saved together. Do not enter those purchases
        again here.
      </p>
      {categories.error || horses.error ? (
        <Notice error="Expense choices could not load. Refresh before entering bills." />
      ) : (
        <BulkExpenseForm
          request={crypto.randomUUID()}
          date={today()}
          categories={categories.data ?? []}
          horses={horses.data ?? []}
        />
      )}
    </>
  );
}
