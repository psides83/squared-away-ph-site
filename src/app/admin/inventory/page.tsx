import { InventoryProductCard } from "@/components/inventory-product-card";
import { ConversionManager } from "@/components/conversion-manager";
import { AppSelect } from "@/components/app-select";
import { SectionTabs } from "@/components/section-tabs";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { Package } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { money, dateLabel, today } from "@/lib/format";
import { PageHeading, Notice, Field, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StockEntryForm } from "@/components/stock-forms";
import { PurchaseCostForm } from "@/components/purchase-cost-form";
import { PurchaseCorrectionForm } from "@/components/purchase-correction-form";
import { saveProduct, reverseConsumption } from "./actions";

export default async function Inventory({
  searchParams,
}: {
  searchParams: Promise<{
    product?: string;
    section?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const { db } = await requireAdmin();
  const page = Math.max(
    1,
    Math.min(10000, Math.floor(Number(params.page) || 1)),
  );
  let query = db
    .from("inventory_movements")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 25, page * 25 - 1);
  if (params.product && /^[0-9a-f-]{36}$/i.test(params.product))
    query = query.eq("product_id", params.product);
  const [
    products,
    units,
    balances,
    movements,
    categories,
    horses,
    feedingTimes,
  ] = await Promise.all([
    db.from("inventory_products").select("*").order("name"),
    db.from("inventory_units").select("*").order("label"),
    db.from("inventory_balances").select("*"),
    query,
    db.from("expense_categories").select("*").order("name"),
    db.from("horses").select("id,barn_name").order("barn_name"),
    db.from("feeding_times").select("*").order("sort_order").order("name"),
  ]);
  const failed = [
    products,
    units,
    balances,
    movements,
    categories,
    horses,
    feedingTimes,
  ].some((r) => r.error);
  const selected = products.data?.find((p) => p.id === params.product);
  const request = crypto.randomUUID();
  const queryFor = (p: number) =>
    `/admin/inventory?${new URLSearchParams({ page: String(p), ...(selected ? { product: selected.id } : {}) })}#inventory-history`;
  return (
    <>
      <PageHeading
        eyebrow="KEEP THE FEED ROOM SQUARED AWAY"
        title="Feed inventory"
        description="Feed, hay, and supplements—with the quantities and costs behind every feeding."
        action={{ href: "#stock-entry", label: "Record stock" }}
      />
      <Notice
        error={
          failed
            ? "Inventory couldn’t load. Confirm the latest migrations have completed."
            : params.error ||
              (params.product && !selected ? "Product not found." : undefined)
        }
        success={params.success}
      />
      {!failed && (
        <>
          <SectionTabs
            id="inventory"
            label="Inventory sections"
            defaultTab={params.page ? "history" : "products"}
            sections={[
              {
                id: "products",
                label: "Products",
                content: (
                  <>
                    {" "}
                    <div className="horse-grid inventory-grid">
                      {products.data?.map((p) => {
                        const b = balances.data?.find(
                          (b) => b.product_id === p.id,
                        );
                        const qty = Number(b?.quantity_oz ?? 0);
                        const value = Number(b?.value_cents ?? 0);
                        return (
                          <InventoryProductCard
                            key={p.id}
                            product={p}
                            quantity={qty}
                            value={value}
                          />
                        );
                      })}
                    </div>
                    {!products.data?.length && (
                      <section className="panel">
                        <EmptyState
                          icon={Package}
                          title="Start with what’s in the feed room."
                          description="Add a product, configure its bags, scoops, bales or flakes, then record opening stock or a purchase."
                          href="#product-setup"
                          label="Add your first product"
                        />
                      </section>
                    )}
                    <ActionPanel
                      id="product-setup"
                      label={
                        selected ? `Manage ${selected.name}` : "Add a product"
                      }
                      defaultOpen={
                        Boolean(selected) && !params.success && !params.error
                      }
                      closeHref="/admin/inventory"
                    >
                      <Notice error={params.error} success={params.success} />
                      <SectionTabs
                        id="product-editor"
                        label="Product settings"
                        defaultTab={
                          params.section === "conversions"
                            ? "conversions"
                            : "details"
                        }
                        sections={[
                          {
                            id: "details",
                            label: "Product details",
                            content: (
                              <>
                                {" "}
                                <form
                                  action={saveProduct}
                                  className="record-form"
                                >
                                  <input
                                    name="id"
                                    type="hidden"
                                    value={selected?.id ?? ""}
                                  />
                                  <div className="form-grid">
                                    <Field
                                      name="name"
                                      label="Product name"
                                      required
                                      defaultValue={selected?.name}
                                    />
                                    <label>
                                      Type
                                      <AppSelect
                                        name="category"
                                        defaultValue={
                                          selected?.category ?? "feed"
                                        }
                                      >
                                        <option value="feed">Feed</option>
                                        <option value="hay">Hay</option>
                                        <option value="supplement">
                                          Supplement
                                        </option>
                                      </AppSelect>
                                    </label>
                                    <label>
                                      Purchase expense category
                                      <AppSelect
                                        name="expense_category_id"
                                        required
                                        defaultValue={
                                          selected?.expense_category_id ?? ""
                                        }
                                      >
                                        <option value="" disabled>
                                          Select a category
                                        </option>
                                        {categories.data?.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name}
                                          </option>
                                        ))}
                                      </AppSelect>
                                    </label>
                                  </div>
                                  {selected && (
                                    <label className="inline-checkbox">
                                      <input
                                        type="checkbox"
                                        name="archived"
                                        defaultChecked={selected.archived}
                                      />
                                      Archive product (keep history)
                                    </label>
                                  )}
                                  <SubmitButton>
                                    {selected ? "Save product" : "Add product"}
                                  </SubmitButton>
                                  {selected && (
                                    <Link
                                      href="/admin/inventory#product-setup"
                                      className="text-link"
                                    >
                                      Add a different product
                                    </Link>
                                  )}
                                </form>
                              </>
                            ),
                          },
                          ...(selected
                            ? [
                                {
                                  id: "conversions",
                                  label: "Conversions",
                                  content: (
                                    <ConversionManager
                                      productId={selected.id}
                                      units={(units.data ?? []).filter(
                                        (u) => u.product_id === selected.id,
                                      )}
                                    />
                                  ),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </ActionPanel>
                  </>
                ),
              },
              {
                id: "record",
                label: "Record purchase / stock",
                content: (
                  <>
                    {" "}
                    {!!products.data?.some((p) => !p.archived) && (
                      <section className="panel" id="stock-entry">
                        <div className="panel-heading">
                          <h2>Record a stock transaction</h2>
                        </div>
                        <StockEntryForm
                          times={feedingTimes.data ?? []}
                          key={request}
                          products={products.data ?? []}
                          units={units.data ?? []}
                          horses={horses.data ?? []}
                          product={
                            selected && !selected.archived
                              ? selected.id
                              : undefined
                          }
                          date={today()}
                          request={request}
                        />
                      </section>
                    )}
                  </>
                ),
              },
              {
                id: "history",
                label: "History",
                content: (
                  <>
                    {" "}
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>
                          {selected
                            ? `${selected.name}: stock history`
                            : "Stock history"}
                        </h2>
                        {selected && (
                          <Link className="text-link" href="/admin/inventory">
                            All products
                          </Link>
                        )}
                      </div>
                      <p className="record-form muted form-hint">
                        Weighted average costs are applied in recording order.
                        The most recent purchase, opening stock or stock
                        addition can be corrected only before any later stock
                        activity. Cost-only purchase corrections can recalculate
                        later costs using the separate action. Earlier quantity
                        corrections and vendor returns need a separate workflow.
                        To correct feeding or waste, reverse it below, then
                        record the correct amount manually. A daily confirmation
                        remains confirmed after a correction.
                      </p>
                      <p className="record-form">
                        <Link
                          className="text-link"
                          href="/admin/inventory/cost-reviews"
                        >
                          Cost corrections & invoice reviews
                        </Link>
                      </p>
                      {movements.data?.map((m) => (
                        <article className="log-entry" key={m.id}>
                          <div className="log-entry-heading">
                            <div>
                              <p className="eyebrow">
                                {dateLabel(m.movement_date)} ·{" "}
                                {
                                  products.data?.find(
                                    (p) => p.id === m.product_id,
                                  )?.name
                                }
                              </p>
                              <h3>
                                {m.kind.replaceAll("_", " ")} ·{" "}
                                {Number(m.entered_quantity)} {m.unit_label}
                              </h3>
                            </div>
                            <span className="tag">
                              {Number(m.quantity_delta_oz) > 0 ? "+" : ""}
                              {Number(m.quantity_delta_oz)} oz ·{" "}
                              {money(Number(m.value_delta_cents))}
                            </span>
                          </div>
                          {m.horse_id && (
                            <p className="muted">
                              {
                                horses.data?.find((h) => h.id === m.horse_id)
                                  ?.barn_name
                              }
                            </p>
                          )}
                          <p className="muted form-hint">
                            {m.feeding_time_label && (
                              <span>
                                Feeding time: {m.feeding_time_label} ·{" "}
                              </span>
                            )}
                            Conversion used: 1 {m.unit_label} ={" "}
                            {m.ounces_per_unit} oz
                          </p>
                          {m.notes && <p className="log-notes">{m.notes}</p>}
                          {m.expense_id && (
                            <Link
                              className="text-link"
                              href={`/admin/expenses/${m.expense_id}`}
                            >
                              Expense & receipts
                            </Link>
                          )}
                          {["purchase", "opening", "adjustment_in"].includes(
                            m.kind,
                          ) && (
                            <ActionPanel
                              id={`revalue-${m.id}`}
                              label={
                                m.kind === "purchase"
                                  ? "Correct purchase cost"
                                  : "Correct stock value"
                              }
                            >
                              <div className="panel-heading">
                                <h2>
                                  {m.kind === "purchase"
                                    ? "Correct purchase cost"
                                    : "Correct stock value"}
                                </h2>
                              </div>
                              <PurchaseCostForm
                                movement={m}
                                inbound={m.kind !== "purchase"}
                              />
                            </ActionPanel>
                          )}
                          {["purchase", "opening", "adjustment_in"].includes(
                            m.kind,
                          ) && (
                            <ActionPanel
                              id={`correct-purchase-${m.id}`}
                              label="Correct stock entry"
                            >
                              <div className="panel-heading">
                                <h2>Correct stock entry</h2>
                              </div>
                              <PurchaseCorrectionForm
                                inbound={m.kind !== "purchase"}
                                m={m}
                                units={
                                  units.data?.filter(
                                    (u) => u.product_id === m.product_id,
                                  ) ?? []
                                }
                              />
                            </ActionPanel>
                          )}
                          {["feeding", "waste", "adjustment_out"].includes(
                            m.kind,
                          ) && (
                            <details>
                              <summary>Correct this entry</summary>
                              <form
                                action={reverseConsumption}
                                className="conversion-row"
                              >
                                <input name="id" type="hidden" value={m.id} />
                                <Field
                                  label="Correction reason"
                                  name="reason"
                                  required
                                  maxLength={5000}
                                />
                                <SubmitButton className="text-button">
                                  Return stock at original cost
                                </SubmitButton>
                              </form>
                            </details>
                          )}
                        </article>
                      ))}
                      {!movements.data?.length && (
                        <p className="record-form muted">
                          No stock movements on this page yet.
                        </p>
                      )}
                      <nav
                        className="log-pagination"
                        aria-label="Inventory history pages"
                      >
                        {page > 1 ? (
                          <Link className="text-link" href={queryFor(page - 1)}>
                            Previous
                          </Link>
                        ) : (
                          <span />
                        )}
                        <span>Page {page}</span>
                        {page * 25 < (movements.count ?? 0) ? (
                          <Link className="text-link" href={queryFor(page + 1)}>
                            Next
                          </Link>
                        ) : (
                          <span />
                        )}
                      </nav>
                    </section>
                  </>
                ),
              },
            ]}
          />{" "}
        </>
      )}
    </>
  );
}
