"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, Pencil, Scale, X } from "lucide-react";
import { saveUnit } from "@/app/admin/inventory/actions";
import { AppSelect } from "@/components/app-select";
import { Field, Notice } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { conversionWeightText, weightUnits } from "@/lib/weight-units";
export type ConversionUnit = {
  id: string;
  label: string;
  ounces_per_unit: number | string;
  ounces_per_unit_text?: string;
};
export function ConversionManager({
  productId,
  units,
}: {
  productId: string;
  units: ConversionUnit[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>()),
    addTrigger = useRef<HTMLButtonElement>(null);
  function closeEditor() {
    const target =
      editing === "new"
        ? addTrigger.current
        : triggers.current.get(editing ?? "");
    setEditing(null);
    requestAnimationFrame(() => target?.focus());
  }
  const [state, action, pending] = useActionState(saveUnit, {});
  useEffect(() => {
    if (state.revision) closeEditor();
  }, [state.revision]);
  const selected = units.find((u) => u.id === editing);
  const editor = (
    <form key={editing} action={action} className="conversion-editor">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="id" value={selected?.id ?? ""} />
      <div className="form-grid">
        <Field
          name="label"
          label="Conversion name"
          required
          maxLength={40}
          defaultValue={selected?.label}
          placeholder="e.g. Large scoop"
        />
        <Field
          name="weight"
          label="Weight of one unit"
          type="number"
          min="0.000000000001"
          step="0.000000000001"
          required
          defaultValue={
            selected
              ? conversionWeightText(
                  selected.ounces_per_unit_text ?? selected.ounces_per_unit,
                )
              : ""
          }
        />
        <label>
          Measured in
          <AppSelect name="weight_unit" defaultValue="oz">
            {weightUnits.map((w) => (
              <option key={w.label} value={w.label}>
                {w.name} ({w.label})
              </option>
            ))}
          </AppSelect>
        </label>
      </div>
      <div className="form-actions">
        <SubmitButton>
          {selected ? "Save conversion" : "Add conversion"}
        </SubmitButton>
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={closeEditor}
        >
          Cancel
        </button>
      </div>
    </form>
  );
  return (
    <section className="conversion-manager">
      <div className="section-action-heading">
        <div>
          <h3>Weight conversions</h3>
          <p className="muted">Each conversion is specific to this product.</p>
        </div>
        <button
          type="button"
          className="button"
          disabled={pending}
          ref={addTrigger}
          onClick={() => setEditing("new")}
        >
          <Plus size={17} />
          Add conversion
        </button>
      </div>
      <p className="muted form-hint">
        Edit any name or weight. Changes apply to future purchases and feedings,
        including saved rations using that conversion. Past entries and stock on
        hand retain their recorded weights and costs.
      </p>
      <Notice error={state.error} success={state.success} />
      {editing === "new" && (
        <div className="conversion-card">
          <h4>New conversion</h4>
          {editor}
        </div>
      )}
      <div className="conversion-list">
        {units.map((u) => (
          <article className="conversion-card" key={u.id}>
            <div className="conversion-summary">
              <span className="app-icon-tile">
                <Scale size={19} />
              </span>
              <div>
                <h4>{u.label}</h4>
                <p>
                  1 {u.label} ={" "}
                  {Number(u.ounces_per_unit).toLocaleString("en-US", {
                    maximumFractionDigits: 12,
                  })}{" "}
                  oz
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                ref={(node) => {
                  if (node) triggers.current.set(u.id, node);
                  else triggers.current.delete(u.id);
                }}
                aria-label={`${editing === u.id ? "Close" : "Edit"} ${u.label} conversion`}
                disabled={pending}
                onClick={() => setEditing(editing === u.id ? null : u.id)}
              >
                {editing === u.id ? <X size={16} /> : <Pencil size={16} />}{" "}
                {editing === u.id ? "Close" : "Edit"}
              </button>
            </div>
            {editing === u.id && editor}
          </article>
        ))}
      </div>
      <details className="conversion-help">
        <summary>Choosing the measured weight</summary>
        <p className="muted">
          Use the weight of one scoop, flake, bag, bale, tub, or other measure
          for this product. Cups, teaspoons, tablespoons, and milliliters also
          need a product-specific measured weight. The “Measured in” choices are
          physical weight references; your conversion’s name and assigned weight
          are editable.
        </p>
      </details>
    </section>
  );
}
