import { SectionTabs } from "@/components/section-tabs";
import { ActionPanel } from "@/components/action-panel";
import Link from "next/link";
import { weightUnits } from "@/lib/weight-units";
import { Package } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { money, dateLabel, today } from "@/lib/format";
import { PageHeading, Notice, Field, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { StockEntryForm } from "@/components/stock-forms";
import { saveProduct, saveUnit, reverseConsumption } from "./actions";

export default async function Inventory({
  searchParams,
}: {
  searchParams: Promise<{
    product?: string;
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
                          <article className="horse-card" key={p.id}>
                            <span className="tag">
                              {p.category}
                              {p.archived ? " · Archived" : ""}
                            </span>
                            <h3>
                              <Link href={`/admin/inventory?product=${p.id}`}>
                                {p.name}
                              </Link>
                            </h3>
                            <div className="horse-details">
                              <strong>
                                {(qty / 16).toLocaleString("en-US", {
                                  maximumFractionDigits: 4,
                                })}{" "}
                                lb ·{" "}
                                {qty.toLocaleString("en-US", {
                                  maximumFractionDigits: 6,
                                })}{" "}
                                oz
                              </strong>
                              <span>Inventory value: {money(value)}</span>
                              <span>
                                Average cost per lb:{" "}
                                {qty
                                  ? `$${(((value / qty) * 16) / 100).toFixed(4)}`
                                  : "No stock"}
                              </span>
                            </div>
                            <Link
                              className="text-link"
                              href={`/admin/inventory?product=${p.id}#stock-entry`}
                            >
                              Record stock
                            </Link>
                          </article>
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
                      <form action={saveProduct} className="record-form">
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
                            <select
                              name="category"
                              defaultValue={selected?.category ?? "feed"}
                            >
                              <option value="feed">Feed</option>
                              <option value="hay">Hay</option>
                              <option value="supplement">Supplement</option>
                            </select>
                          </label>
                          <label>
                            Purchase expense category
                            <select
                              name="expense_category_id"
                              required
                              defaultValue={selected?.expense_category_id ?? ""}
                            >
                              <option value="" disabled>
                                Select a category
                              </option>
                              {categories.data?.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
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
                      {selected && (
                        <div className="record-form separated">
                          <h3>Weight conversions</h3>
                          <p className="muted form-hint">
                            Metric and US weight units have fixed conversions.
                            Configure the measured weight of a bag, bale, scoop,
                            flake, tub, or custom serving. Changes apply to
                            future transactions, never past feedings. Use a
                            separate batch-named unit when weights differ. Cups,
                            teaspoons, tablespoons, milliliters, and liters need
                            a measured weight for each product; volume does not
                            have a universal weight.
                          </p>
                          {units.data
                            ?.filter((u) => u.product_id === selected.id)
                            .map((u) => (
                              <form
                                action={saveUnit}
                                className="conversion-row"
                                key={u.id}
                              >
                                <input name="id" type="hidden" value={u.id} />
                                <input
                                  name="product_id"
                                  type="hidden"
                                  value={selected.id}
                                />
                                <input
                                  name="label"
                                  type="hidden"
                                  value={u.label}
                                />
                                <span className="tag">1 {u.label}</span>
                                {weightUnits.some(
                                  (unit) => unit.label === u.label,
                                ) ? (
                                  <span>
                                    {
                                      weightUnits.find(
                                        (unit) => unit.label === u.label,
                                      )?.reference
                                    }{" "}
                                    (fixed)
                                  </span>
                                ) : (
                                  <>
                                    <Field
                                      name="weight"
                                      label="Weight"
                                      type="number"
                                      min={0.000000000001}
                                      step="0.000000000001"
                                      required
                                      defaultValue={u.ounces_per_unit}
                                    />
                                    <select
                                      name="weight_unit"
                                      aria-label="Weight unit"
                                      defaultValue="oz"
                                    >
                                      {weightUnits.map((unit) => (
                                        <option
                                          key={unit.label}
                                          value={unit.label}
                                        >
                                          {unit.name}
                                        </option>
                                      ))}
                                    </select>
                                    <SubmitButton className="text-button">
                                      Update
                                    </SubmitButton>
                                  </>
                                )}
                              </form>
                            ))}
                          <form action={saveUnit} className="stack">
                            <input
                              name="product_id"
                              type="hidden"
                              value={selected.id}
                            />
                            <div className="form-grid">
                              <Field
                                name="label"
                                label="New unit (e.g. scoop, flake, bag, bale-batch-2)"
                                required
                                maxLength={40}
                              />
                              <Field
                                name="weight"
                                label="Weight of one unit"
                                type="number"
                                min={0.000001}
                                step="0.000001"
                                required
                              />
                              <label>
                                Weight measured in
                                <select name="weight_unit">
                                  {weightUnits.map((unit) => (
                                    <option key={unit.label} value={unit.label}>
                                      {unit.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <SubmitButton>Add conversion</SubmitButton>
                          </form>
                        </div>
                      )}
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
                        Purchase corrections and inbound reversals are not
                        available yet. To correct feeding or waste, reverse it
                        below, then record the correct amount manually. A daily
                        confirmation remains confirmed after a correction.
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
                              href={`/admin/expenses?edit=${m.expense_id}#receipts`}
                            >
                              Expense & receipts
                            </Link>
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
