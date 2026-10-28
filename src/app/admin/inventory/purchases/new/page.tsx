import { receiptOcrConfigured } from "@/lib/receipt-ocr";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PageHeading, Notice } from "@/components/ui";
import { ReceiptPurchaseForm } from "@/components/receipt-purchase-form";
import { today } from "@/lib/format";
export const maxDuration = 60;
export default async function NewReceiptPurchase() {
  const { db } = await requireAdmin();
  const [products, units, categories] = await Promise.all([
    db
      .from("inventory_products")
      .select("id,name")
      .eq("archived", false)
      .order("name"),
    db.from("inventory_units").select("id,product_id,label").order("label"),
    db.from("expense_categories").select("id,name").order("name"),
  ]);
  return (
    <>
      <Link
        className="button secondary"
        href="/admin/inventory#inventory-record"
      >
        Back to inventory
      </Link>
      <PageHeading
        title="Record a receipt"
        description="Feed, hay, supplements and barn supplies in one reviewed purchase."
      />
      {products.error || units.error || categories.error ? (
        <Notice error="Purchase choices could not load. Please refresh." />
      ) : (
        <ReceiptPurchaseForm
          products={products.data ?? []}
          units={units.data ?? []}
          categories={categories.data ?? []}
          ocrConfigured={receiptOcrConfigured(process.env)}
          date={today()}
        />
      )}
    </>
  );
}
