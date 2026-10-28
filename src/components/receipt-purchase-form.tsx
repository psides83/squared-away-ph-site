"use client";
import { ReceiptDuplicateReview } from "@/components/receipt-duplicate-review";
import { ReceiptOcrReader } from "@/components/receipt-ocr-reader";
import { ocrPhotoLimit, receiptItemsFromOcr } from "@/lib/receipt-ocr";
import type { ReceiptOcrResult } from "@/app/admin/inventory/purchases/ocr-actions";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { saveReceiptPurchase } from "@/app/admin/inventory/purchases/actions";
import { AppSelect } from "@/components/app-select";
import { FormInput } from "@/components/form-input";
import { Field, Notice } from "@/components/ui";
import { HelpPanel } from "@/components/help-panel";
import { ReceiptPicker } from "@/components/receipt-picker";
import { ConfirmButton } from "@/components/confirm-button";
import { money } from "@/lib/format";
import {
  moneyCents,
  suggestReceiptAllocations,
  receiptPurchaseValues,
  type ReceiptItemDraft,
} from "@/lib/receipt-purchase";
const freshItem = (kind: ReceiptItemDraft["kind"]): ReceiptItemDraft => ({
  id: crypto.randomUUID(),
  kind,
  description: "",
  product_id: "",
  unit_id: "",
  quantity: "",
  subtotal: "",
  discount: "0.00",
  tax: "0.00",
  discountEligible: true,
  taxEligible: false,
});
export function ReceiptPurchaseForm({
  products,
  units,
  categories,
  date,
  ocrConfigured = false,
}: {
  products: { id: string; name: string }[];
  units: { id: string; product_id: string; label: string }[];
  categories: { id: string; name: string }[];
  date: string;
  ocrConfigured?: boolean;
}) {
  const [photo, setPhoto] = useState<File | null>(null),
    [ocrBusy, setOcrBusy] = useState(false),
    [ocrRead, setOcrRead] = useState<string | null>(null);
  const [vendor, setVendor] = useState(""),
    [purchaseDate, setPurchaseDate] = useState(date),
    [paidOn, setPaidOn] = useState("");
  const [request] = useState(() => crypto.randomUUID());
  const [items, setItems] = useState<ReceiptItemDraft[]>(() => [
    freshItem(products.length ? "inventory" : "expense"),
  ]);
  const [discount, setDiscount] = useState("0.00"),
    [tax, setTax] = useState("0.00"),
    [total, setTotal] = useState("");
  const [reviewed, setReviewed] = useState(false),
    [issue, setIssue] = useState<string>();
  const [state, action, pending] = useActionState(saveReceiptPurchase, {});
  const [duplicatePhoto, setDuplicatePhoto] = useState<File | null>(null),
    [duplicateAck, setDuplicateAck] = useState(false),
    [duplicateReason, setDuplicateReason] = useState("");
  useEffect(() => {
    if (state.duplicateReview) {
      setDuplicatePhoto(photo);
      setDuplicateAck(false);
      setReviewed(false);
    }
  }, [state.duplicateReview]);
  const showDuplicates = Boolean(
    state.duplicateReview && photo && duplicatePhoto === photo,
  );
  const displayError =
    state.duplicateReview && !showDuplicates ? undefined : state.error;
  const patch = (id: string, values: Partial<ReceiptItemDraft>) => {
    setItems((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...values } : r)),
    );
    setReviewed(false);
    setDuplicateAck(false);
    setIssue(undefined);
  };
  const applyRead = (result: ReceiptOcrResult) => {
    if (!result.suggestion || !result.id) return;
    const suggestion = result.suggestion;
    setVendor(suggestion.vendor ?? "");
    setPurchaseDate(suggestion.date ?? "");
    setPaidOn("");
    setTax(suggestion.tax ?? "");
    setDiscount(suggestion.discount ?? "");
    setTotal(suggestion.total ?? "");
    const suggestedItems = receiptItemsFromOcr(suggestion, products);
    setItems(
      suggestedItems.length
        ? suggestedItems
        : [freshItem(products.length ? "inventory" : "expense")],
    );
    setOcrRead(result.id);
    setReviewed(false);
    setDuplicateAck(false);
    setIssue(undefined);
  };
  let calculated: number | null = null;
  try {
    calculated = items.reduce(
      (sum, i) =>
        sum +
        moneyCents(i.subtotal) -
        moneyCents(i.discount) +
        moneyCents(i.tax),
      0,
    );
  } catch {}
  const dollar = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    name?: string,
  ) => (
    <label className="field">
      {label}
      <FormInput
        name={name}
        aria-label={label}
        type="number"
        prefix="$"
        min="0"
        max="1000000"
        step="0.01"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
  return (
    <form
      action={action}
      className="stack"
      onChange={(e) => {
        const name = e.target.getAttribute("name");
        if (name !== "reviewed") setReviewed(false);
        if (
          !["reviewed", "duplicate_ack", "duplicate_reason"].includes(
            name ?? "",
          )
        )
          setDuplicateAck(false);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        try {
          receiptPurchaseValues(data);
          setIssue(undefined);
          startTransition(() => action(data));
        } catch (error) {
          setIssue(
            error instanceof Error ? error.message : "Review receipt values.",
          );
        }
      }}
    >
      <Notice success={state.success} />
      {state.expense && (
        <div className="panel record-form stack">
          {state.attachmentError && (
            <p className="notice error">{state.attachmentError}</p>
          )}
          <div className="row-actions">
            <Link
              className="button"
              href={`/admin/expenses/${state.expense}#expense-receipt-items`}
            >
              Open saved receipt
            </Link>
            <a
              className="button secondary"
              href="/admin/inventory/purchases/new"
            >
              Record another receipt
            </a>
          </div>
        </div>
      )}
      <fieldset
        className="stack"
        disabled={pending || Boolean(state.expense) || ocrBusy}
      >
        <input name="request_id" type="hidden" value={request} />
        <input name="ocr_read_id" type="hidden" value={ocrRead ?? ""} />
        <input name="items" type="hidden" value={JSON.stringify(items)} />
        <section className="panel">
          <div className="panel-heading">
            <h2>Receipt details</h2>
          </div>
          <div className="record-form stack">
            <div className="form-grid">
              <label className="field">
                Vendor
                <FormInput
                  name="vendor"
                  aria-label="Vendor"
                  required
                  maxLength={200}
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </label>
              <label className="field">
                Purchase date
                <FormInput
                  name="expense_date"
                  aria-label="Purchase date"
                  type="date"
                  max={date}
                  required
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </label>
              <label className="field">
                Paid on (leave blank if unpaid)
                <FormInput
                  name="paid_on"
                  aria-label="Paid on (leave blank if unpaid)"
                  type="date"
                  max={date}
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                />
              </label>
              <label className="field">
                Expense category for this receipt
                <AppSelect
                  name="category_id"
                  aria-label="Expense category for this receipt"
                  required
                  defaultValue={
                    categories.find((c) => c.name === "Other")?.id ?? ""
                  }
                >
                  <option value="" disabled>
                    Choose category
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </AppSelect>
              </label>
            </div>
            <p className="muted form-hint">
              The whole receipt uses this expense category in cash reports.
              Items retain their own descriptions and stock costs; they are not
              separate expense-category totals.
            </p>
            <ReceiptPicker
              photoLimit={ocrPhotoLimit}
              onPrepared={(file) => {
                setPhoto(file);
                setDuplicateAck(false);
                setDuplicateReason("");
                setOcrRead(null);
                setReviewed(false);
                setDuplicateAck(false);
              }}
            />
            <ReceiptOcrReader
              photo={photo}
              configured={ocrConfigured}
              onBusy={setOcrBusy}
              onApply={applyRead}
            />
            {ocrRead && (
              <p className="notice">
                Draft filled from receipt reading. Review every field;
                quantities, units and tax eligibility were not inferred.
              </p>
            )}
            <HelpPanel title="How to enter receipt items">
              <p>
                Enter each item's full line subtotal before receipt-wide
                discount and tax, rather than its price per bag. Select the
                products, units and quantities actually purchased. Expense-only
                items add no stock. Tax eligibility is your choice; no tax rate
                or exemption is assumed.
              </p>
              <p>
                Choose which items receive each adjustment and tap Suggest
                allocations. Discounts are proportional to eligible subtotals;
                tax is proportional to eligible costs after discount. Review or
                edit every allocation before saving. Values reconcile to the
                cent. Changing entries clears your review confirmation.
              </p>
              <p>
                One saved expense holds this receipt and its total. Stock costs
                include each item's allocated tax and discount. Later item
                corrections are not yet supported; an untouched whole receipt
                can be cancelled. Read receipt can fill a reviewable draft;
                choosing a photo alone never sends it.
              </p>
            </HelpPanel>
          </div>
        </section>
        {items.map((item, index) => {
          const selectedUnits = units.filter(
            (u) => u.product_id === item.product_id,
          );
          return (
            <section className="panel" key={item.id}>
              <div className="panel-heading">
                <h2>
                  Item {index + 1} ·{" "}
                  {item.kind === "inventory"
                    ? "Inventory"
                    : item.kind === "expense"
                      ? "Expense only"
                      : "Choose type"}
                </h2>
                <button
                  type="button"
                  className="button secondary icon-button"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={items.length === 1}
                  onClick={() => {
                    setItems((rows) => rows.filter((r) => r.id !== item.id));
                    setReviewed(false);
                    setDuplicateAck(false);
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="record-form stack">
                <div className="form-grid">
                  <label className="field">
                    Item type
                    <AppSelect
                      aria-label={`Type for item ${index + 1}`}
                      required
                      value={item.kind}
                      onChange={(e) =>
                        patch(item.id, {
                          kind: e.target.value as "inventory" | "expense",
                          product_id: "",
                          unit_id: "",
                          quantity: "",
                        })
                      }
                    >
                      <option value="" disabled>
                        Choose item type
                      </option>
                      <option value="inventory">Inventory</option>
                      <option value="expense">Expense only</option>
                    </AppSelect>
                  </label>
                  {item.kind === "inventory" && (
                    <>
                      <label className="field">
                        Product
                        <AppSelect
                          aria-label={`Product for item ${index + 1}`}
                          required
                          value={item.product_id}
                          onChange={(e) =>
                            patch(item.id, {
                              product_id: e.target.value,
                              unit_id: "",
                              description:
                                item.description ||
                                products.find((p) => p.id === e.target.value)
                                  ?.name ||
                                "",
                            })
                          }
                        >
                          <option value="" disabled>
                            Choose product
                          </option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </AppSelect>
                      </label>
                      <label className="field">
                        Purchase unit
                        <AppSelect
                          aria-label={`Purchase unit for item ${index + 1}`}
                          required
                          value={item.unit_id}
                          onChange={(e) =>
                            patch(item.id, { unit_id: e.target.value })
                          }
                        >
                          <option value="" disabled>
                            Choose unit
                          </option>
                          {selectedUnits.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.label}
                            </option>
                          ))}
                        </AppSelect>
                      </label>
                      <label className="field">
                        Quantity
                        <FormInput
                          aria-label={`Quantity for item ${index + 1}`}
                          type="number"
                          min="0.000001"
                          max="1000000000"
                          step="0.000001"
                          suffix={
                            selectedUnits.find((u) => u.id === item.unit_id)
                              ?.label
                          }
                          required
                          value={item.quantity}
                          onChange={(e) =>
                            patch(item.id, { quantity: e.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                  <label className="field">
                    Item description
                    <FormInput
                      aria-label={`Description for item ${index + 1}`}
                      required
                      maxLength={200}
                      value={item.description}
                      onChange={(e) =>
                        patch(item.id, { description: e.target.value })
                      }
                    />
                  </label>
                  {dollar(`Item ${index + 1} subtotal`, item.subtotal, (v) =>
                    patch(item.id, { subtotal: v }),
                  )}
                </div>
                <details>
                  <summary>Tax and discount allocation</summary>
                  <div className="stack feed-comparison-detail">
                    <div className="row-actions">
                      <label className="inline-checkbox">
                        <input
                          type="checkbox"
                          checked={item.discountEligible}
                          onChange={(e) =>
                            patch(item.id, {
                              discountEligible: e.target.checked,
                            })
                          }
                        />
                        Include in discount suggestion
                      </label>
                      <label className="inline-checkbox">
                        <input
                          type="checkbox"
                          checked={item.taxEligible}
                          onChange={(e) =>
                            patch(item.id, { taxEligible: e.target.checked })
                          }
                        />
                        Include in tax suggestion
                      </label>
                    </div>
                    <div className="form-grid">
                      {dollar(
                        `Item ${index + 1} discount`,
                        item.discount,
                        (v) => patch(item.id, { discount: v }),
                      )}
                      {dollar(`Item ${index + 1} tax`, item.tax, (v) =>
                        patch(item.id, { tax: v }),
                      )}
                    </div>
                  </div>
                </details>
                <p className="muted form-hint">
                  Allocated discount {moneyCentsSafe(item.discount)} · tax{" "}
                  {moneyCentsSafe(item.tax)} · Item cost {itemCost(item)}
                </p>
              </div>
            </section>
          );
        })}
        <div className="row-actions">
          <button
            type="button"
            className="button secondary"
            disabled={items.length >= 20 || !products.length}
            onClick={() => {
              setItems((rows) => [...rows, freshItem("inventory")]);
              setReviewed(false);
              setDuplicateAck(false);
            }}
          >
            <Plus size={18} />
            Add inventory item
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={items.length >= 20}
            onClick={() => {
              setItems((rows) => [...rows, freshItem("expense")]);
              setReviewed(false);
              setDuplicateAck(false);
            }}
          >
            <Plus size={18} />
            Add expense-only item
          </button>
        </div>
        {showDuplicates && state.duplicateReview && (
          <ReceiptDuplicateReview
            review={state.duplicateReview}
            acknowledged={duplicateAck}
            onAcknowledge={setDuplicateAck}
            reason={duplicateReason}
            onReason={setDuplicateReason}
          />
        )}
        <section className="panel">
          <div className="panel-heading">
            <h2>Review receipt totals</h2>
          </div>
          <div className="record-form stack">
            <Notice error={displayError ?? issue} />
            <div className="form-grid">
              {dollar(
                "Receipt-wide discount",
                discount,
                setDiscount,
                "discount",
              )}
              {dollar("Receipt tax", tax, setTax, "tax")}
              {dollar("Printed receipt total", total, setTotal, "total")}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  try {
                    setItems(
                      suggestReceiptAllocations(
                        items,
                        moneyCents(discount),
                        moneyCents(tax),
                      ),
                    );
                    setReviewed(false);
                    setDuplicateAck(false);
                    setIssue(undefined);
                  } catch (error) {
                    setIssue(
                      error instanceof Error
                        ? error.message
                        : "Review allocations.",
                    );
                  }
                }}
              >
                Suggest allocations
              </button>
            </div>
            <p>
              Allocated item total:{" "}
              <strong>
                {calculated === null
                  ? "Complete the subtotals"
                  : money(calculated)}
              </strong>
            </p>
            <p className="muted form-hint">
              Suggestions replace the current per-item discount and tax amounts.
              The total above must match the printed receipt, and allocated
              discounts/tax must match their receipt totals exactly.
            </p>
            <details>
              <summary>Private purchase note</summary>
              <Field name="notes" label="Private note" maxLength={5000} />
            </details>
            <label className="inline-checkbox">
              <input
                name="reviewed"
                type="checkbox"
                required
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed every item, allocation and receipt total.
            </label>
            <div className="form-actions">
              <ConfirmButton
                message={`Record this ${items.length}-item receipt${calculated === null ? "" : ` for ${money(calculated)}`}? One expense will be saved, with stock added only for inventory items. A payment date must be entered explicitly to count it as paid.`}
              >
                {pending ? "Saving…" : "Save receipt purchase"}
              </ConfirmButton>
            </div>
          </div>
        </section>
      </fieldset>
    </form>
  );
}
function moneyCentsSafe(value: string) {
  try {
    return money(moneyCents(value));
  } catch {
    return "—";
  }
}
function itemCost(item: ReceiptItemDraft) {
  try {
    return money(
      moneyCents(item.subtotal) -
        moneyCents(item.discount) +
        moneyCents(item.tax),
    );
  } catch {
    return "—";
  }
}
