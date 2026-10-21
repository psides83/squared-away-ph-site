"use client";

import { useId, useState } from "react";

export function CustomerPicker({
  customers,
  selectedIds,
}: {
  customers: { id: string; name: string }[];
  selectedIds: string[];
}) {
  const [selected, setSelected] = useState(selectedIds);
  const hintId = useId();
  return (
    <fieldset className="customer-picker" aria-describedby={hintId}>
      <legend>
        Customers <span className="required">*</span>
      </legend>
      <p id={hintId} className="muted form-hint">
        Choose at least one customer. Select multiple customers for shared
        ownership.
      </p>
      <div className="customer-options">
        {customers.map((customer, index) => (
          <label key={customer.id}>
            <input
              type="checkbox"
              name="customer_ids"
              value={customer.id}
              checked={selected.includes(customer.id)}
              required={index === 0 && selected.length === 0}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, customer.id]
                    : current.filter((id) => id !== customer.id),
                )
              }
            />
            <span>{customer.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
