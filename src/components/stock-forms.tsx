"use client";
import { useState } from "react";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { recordStock } from "@/app/admin/inventory/actions";

export type ProductOption = { id: string; name: string; archived: boolean };
export type UnitOption = {
  id: string;
  product_id: string;
  label: string;
  ounces_per_unit: number;
};
export function ProductUnitFields({
  products,
  units,
  initialProduct = "",
  initialUnit = "",
}: {
  products: ProductOption[];
  units: UnitOption[];
  initialProduct?: string;
  initialUnit?: string;
}) {
  const [product, setProduct] = useState(initialProduct);
  const [unit, setUnit] = useState(initialUnit);
  return (
    <>
      <label>
        Product <span className="required">*</span>
        <select
          name="product_id"
          required
          value={product}
          onChange={(e) => {
            setProduct(e.target.value);
            setUnit("");
          }}
        >
          <option value="" disabled>
            Select a product
          </option>
          {products.map((p) => (
            <option
              disabled={p.archived && p.id !== initialProduct}
              key={p.id}
              value={p.id}
            >
              {p.name}
              {p.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Unit <span className="required">*</span>
        <select
          name="unit_id"
          required
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        >
          <option value="" disabled>
            Select a unit
          </option>
          {units
            .filter((u) => u.product_id === product)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.label} · {Number(u.ounces_per_unit)} oz each
              </option>
            ))}
        </select>
      </label>
    </>
  );
}
export function StockEntryForm({
  products,
  units,
  horses,
  product,
  date,
  request,
}: {
  products: ProductOption[];
  units: UnitOption[];
  horses: { id: string; barn_name: string }[];
  product?: string;
  date: string;
  request: string;
}) {
  const [kind, setKind] = useState("purchase");
  const incoming = ["purchase", "opening", "adjustment_in"].includes(kind);
  return (
    <form action={recordStock} className="record-form">
      <input name="request_id" value={request} type="hidden" />
      <div className="form-grid">
        <label>
          What happened?
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="purchase">Purchase stock</option>
            <option value="opening">Opening stock (first entry only)</option>
            <option value="feeding">Extra / manual feeding</option>
            <option value="waste">Waste / spoilage</option>
            <option value="adjustment_in">Stock correction: add</option>
            <option value="adjustment_out">Stock correction: remove</option>
          </select>
        </label>
        <Field
          name="movement_date"
          label="Date"
          type="date"
          defaultValue={date}
          required
        />
        <ProductUnitFields
          products={products}
          units={units}
          initialProduct={product}
        />
        <Field
          name="quantity"
          label="Quantity in selected unit"
          type="number"
          min={0.000001}
          max={1000000000}
          step="0.000001"
          required
        />
        {incoming && (
          <Field
            name="cost"
            label={
              kind === "purchase"
                ? "Total purchase cost ($)"
                : "Total inventory value being added ($)"
            }
            type="number"
            min={0}
            max={1000000}
            step="0.01"
            required
          />
        )}
        {kind === "purchase" && (
          <>
            <Field name="vendor" label="Vendor" />
            <Field
              name="paid_on"
              label="Paid on (blank if unpaid)"
              type="date"
              defaultValue={date}
            />
          </>
        )}
        {kind === "feeding" && (
          <label>
            Horse <span className="required">*</span>
            <select name="horse_id" required defaultValue="">
              <option value="" disabled>
                Select a horse
              </option>
              {horses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.barn_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label>
        Notes / correction reason
        <textarea
          name="notes"
          rows={3}
          maxLength={5000}
          required={kind.startsWith("adjustment")}
        />
      </label>
      <p className="muted form-hint">
        Purchases create one expense and add stock together. Opening stock and
        corrections affect inventory value only. Outgoing stock uses the
        weighted average cost when recorded; dates do not recalculate past
        valuations.
      </p>
      <SubmitButton>Record transaction</SubmitButton>
    </form>
  );
}
