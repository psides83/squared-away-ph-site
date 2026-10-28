# Receipt-assisted inventory purchases

## Available now

- Take photo or choose a file when recording a stock purchase, or when attaching a receipt to an existing expense. The camera button requests the outward-facing camera through the mobile browser’s file chooser. Actual availability depends on the device/browser; the file chooser remains available.
- Larger image files are reduced on the device before upload, retaining a maximum 2,400-pixel longest edge. Supported receipt uploads remain JPEG, PNG, WebP, and PDF, at most 3 MB. PDF files are not recompressed. Photos that cannot be decoded or reduced must be supplied as a smaller supported file.
- A purchase saves its stock movement and expense together, then attaches the private receipt. If attachment fails, the saved expense is opened for retry; do not enter the purchase again. The same receipt content attached to the same expense is deduplicated by content hash.
- Inventory → Record purchase / stock → Record a receipt now supports a manually reviewed receipt with 1–20 inventory and expense-only items, one expense, and one optional private receipt attachment. Select products/units/quantities and enter full item subtotals. One chosen expense category applies to the entire receipt; per-item category reporting is not yet implemented.
- Choose which items receive discount/tax suggestions. Discounts are proportional to eligible subtotals, then tax is proportional to eligible after-discount values. Largest-remainder cent allocation breaks ties in item order; tax eligibility and rates are never inferred. Suggestions are editable and replace the previous allocations only when requested. Review every line and printed total; changes clear the review checkbox. Allocations must exactly reconcile before saving.
- Product stock values include the reviewed allocated costs; expense-only lines add no inventory. One transaction saves all stock movements, item/conversion/product-name snapshots and the single expense. The payment date is explicit; unpaid receipts are not cash spent. Supplier-credit application remains a separate deliberate operation on the saved purchase expense.
- Expense → Receipt items shows saved lines and deliberate cancellation of an untouched whole receipt. Cancellation restores original stock and voids the expense together, retaining items/documentation/reason. Any later activity on a receipt product blocks cancellation; active supplier credit, billing/cost protections can also block it. Correct those links explicitly before retrying. Single-item source correction tools cannot overwrite multi-item receipts. Later item corrections and per-item category allocation remain future work.
- Exact request retries reuse the saved receipt without changing later payment status or restoring cancelled stock. Fresh forms are not a likely-duplicate detector. Receipt-file validation occurs before the purchase save; upload failure after saving opens a saved-record link for attachment retry instead of re-entering stock. Requires application migration `20261028007000_multi_item_purchases.sql`.
- Recognition/OCR is not connected, and no receipt is sent to a recognition provider.

## Recommended next increment (not implemented)

1. **Recognition service.** Choose a hosted receipt/OCR service or a local OCR approach. A hosted option needs a server-only account/key, a spending limit, and agreement on sending receipt images to that provider. A local option avoids those requests but needs its own extraction and document-layout handling. Test with actual feed-store receipts before choosing.
2. **Extract a purchase draft.** Read vendor, date, item descriptions, quantities, prices, discounts, tax, and total. Treat the image and extracted text as data, never instructions. Check arithmetic in cents and show missing/uncertain fields instead of guessing.
3. **Match products and units.** Suggest existing inventory products and their saved bag/bale/supplement unit conversions. Remember approved vendor descriptions as aliases. A printed package weight does not establish the weight of a scoop or flake.
4. **Review before saving.** Show the receipt beside editable suggestions and require confirmation of product, quantity, unit, cost, and paid/unpaid status. A receipt image alone should not determine payment status or authorize recording costs automatically.
5. **Record exactly once.** Feed reviewed extracted lines into the implemented multi-item receipt workflow and require all reviewed adjustments/total to reconcile. Do not invoke the single-product purchase operation separately with the full receipt total on every item; that would duplicate costs. Add extraction provenance and likely-duplicate review before using OCR drafts.
6. **Recover and audit.** Preserve approved values, extraction provenance, confidence flags, retry IDs, and the original private receipt. Detect likely repeat purchases without blocking legitimate purchases that happen to have equal totals. Keep provider failures separate from saved purchase state.

This is a separate feature beyond camera capture. Manual multi-item review and financial reconciliation are now implemented. Remaining work is recognition integration, suggested product mapping, extraction provenance/confidence, likely-duplicate review, item corrections and category allocation; the file capture, private attachment, unit conversions, and stock valuation foundations already exist.

## Verification limits

Multi-item purchase checks include exact cent suggestions, atomic rollback, weighted cost/unit snapshots, one cash expense, retained retries/cancellation, source protection and permissions. All 250 tests, TypeScript checks and the production build pass. A 390-pixel sample preview verifies item entry, eligibility, suggestions, confirmation/cancel and review reset without saving. Production migration and authenticated purchase/cancellation/storage flows remain unverified.

Camera invocation and image preparation require testing on the owner’s actual phone/browser. Local checks cover the controls and receipt persistence/recovery logic; they do not confirm live Supabase uploads or physical camera capture.

## Browser reference

[MDN: HTML capture attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) describes the camera hint and device-dependent behavior. No permanently running camera stream is needed for this workflow.
