"use client";
import { useState } from "react";
import {
  ProductUnitFields,
  type ProductOption,
  type UnitOption,
} from "@/components/stock-forms";
import { Field } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { supplierReturnAction } from "@/app/admin/inventory/returns/actions";
export function SupplierReturnForm({
  products,
  units,
  date,
}: {
  products: ProductOption[];
  units: UnitOption[];
  date: string;
}) {
  const [unit, setUnit] = useState<UnitOption>();
  return (
    <form
      className="record-form"
      action={supplierReturnAction.bind(null, "return")}
    >
      <input type="hidden" name="request_id" value={crypto.randomUUID()} />
      <p>
        Record stock physically returned to a supplier. It leaves inventory at
        its current average cost. Record any cash refund separately after
        receiving it.
      </p>
      <div className="form-grid">
        <ProductUnitFields
          products={products}
          units={units}
          onUnitChange={setUnit}
        />
        <Field
          label="Quantity returned"
          name="quantity"
          type="number"
          suffix={unit?.label}
          min="0.000001"
          max="1000000000"
          step="0.000001"
          required
        />
        <Field
          label="Returned on"
          name="returned_on"
          type="date"
          defaultValue={date}
          max={date}
          required
        />
        <Field label="Supplier" name="vendor" maxLength={200} required />
        <Field label="Return reason" name="reason" maxLength={2000} required />
      </div>
      <div className="form-actions">
        <ConfirmButton message="Remove this quantity from stock as a supplier return? No cash refund will be assumed.">
          Record return
        </ConfirmButton>
      </div>
    </form>
  );
}
