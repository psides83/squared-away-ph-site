"use client";
import { AppSelect } from "@/components/app-select";

import { weightUnits } from "@/lib/weight-units";
import { servingStepper } from "@/lib/input-format";
import { ReceiptPicker } from "@/components/receipt-picker";
import { feedingTimeLabel, type FeedingTime } from "@/lib/feeding-times";
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
  onUnitChange,
}: {
  products: ProductOption[];
  units: UnitOption[];
  initialProduct?: string;
  initialUnit?: string;
  onUnitChange?: (unit: UnitOption | undefined) => void;
}) {
  const [product, setProduct] = useState(initialProduct);
  const [unit, setUnit] = useState(initialUnit);
  return (
    <>
      <label>
        Product <span className="required">*</span>
        <AppSelect
          name="product_id"
          required
          value={product}
          onChange={(e) => {
            setProduct(e.target.value);
            setUnit("");
            onUnitChange?.(undefined);
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
        </AppSelect>
      </label>
      <label>
        Unit <span className="required">*</span>
        <AppSelect
          name="unit_id"
          required
          value={unit}
          onChange={(e) => {
            setUnit(e.target.value);
            onUnitChange?.(units.find((u) => u.id === e.target.value));
          }}
        >
          <option value="" disabled>
            Select a unit
          </option>
          {units
            .filter((u) => u.product_id === product)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {weightUnits.some((w) => w.label === u.label)
                  ? `${weightUnits.find((w) => w.label === u.label)!.name} (${u.label})`
                  : u.label}
              </option>
            ))}
        </AppSelect>
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
  times = [],
}: {
  products: ProductOption[];
  units: UnitOption[];
  horses: { id: string; barn_name: string }[];
  product?: string;
  date: string;
  request: string;
  times?: FeedingTime[];
}) {
  const [selectedUnit, setSelectedUnit] = useState<UnitOption>();
  const [kind, setKind] = useState("purchase");
  const incoming = ["purchase", "opening", "adjustment_in"].includes(kind);
  return (
    <form action={recordStock} className="record-form">
      <input name="request_id" value={request} type="hidden" />
      <div className="form-grid">
        <label>
          What happened?
          <AppSelect
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
          </AppSelect>
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
          onUnitChange={setSelectedUnit}
        />
        <Field
          key={selectedUnit?.id ?? "no-unit"}
          name="quantity"
          label="Quantity"
          suffix={selectedUnit?.label}
          controls={servingStepper(selectedUnit?.label ?? "")}
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
            Feeding time
            <AppSelect name="feeding_time_id" defaultValue="">
              <option value="">Unscheduled extra / partial feeding</option>
              {times
                .filter((t) => !t.archived)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {feedingTimeLabel(t)}
                  </option>
                ))}
            </AppSelect>
          </label>
        )}
        {kind === "feeding" && (
          <label>
            Horse <span className="required">*</span>
            <AppSelect name="horse_id" required defaultValue="">
              <option value="" disabled>
                Select a horse
              </option>
              {horses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.barn_name}
                </option>
              ))}
            </AppSelect>
          </label>
        )}
      </div>
      {kind === "purchase" && <ReceiptPicker />}
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

export function ProductQuantityFields({
  products,
  units,
  initialProduct,
  initialUnit,
  initialQuantity,
}: {
  products: ProductOption[];
  units: UnitOption[];
  initialProduct?: string;
  initialUnit?: string;
  initialQuantity?: number | string;
}) {
  const [unit, setUnit] = useState(units.find((u) => u.id === initialUnit));
  return (
    <>
      <ProductUnitFields
        products={products}
        units={units}
        initialProduct={initialProduct}
        initialUnit={initialUnit}
        onUnitChange={setUnit}
      />
      <Field
        key={unit?.id ?? "no-unit"}
        name="quantity"
        label="Quantity for this feeding"
        type="number"
        min={0.000001}
        max={1000000000}
        step="0.000001"
        suffix={unit?.label}
        controls={servingStepper(unit?.label ?? "")}
        required
        defaultValue={unit?.id === initialUnit ? initialQuantity : ""}
      />
    </>
  );
}
