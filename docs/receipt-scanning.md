# Receipt-assisted inventory purchases

## Available now

- Take photo or choose a file when recording a stock purchase, or when attaching a receipt to an existing expense. The camera button requests the outward-facing camera through the mobile browser’s file chooser. Actual availability depends on the device/browser; the file chooser remains available.
- Larger image files are reduced on the device before upload, retaining a maximum 2,400-pixel longest edge. Supported receipt uploads remain JPEG, PNG, WebP, and PDF, at most 3 MB. PDF files are not recompressed. Photos that cannot be decoded or reduced must be supplied as a smaller supported file.
- A purchase saves its stock movement and expense together, then attaches the private receipt. If attachment fails, the saved expense is opened for retry; do not enter the purchase again. The same receipt content attached to the same expense is deduplicated by content hash.
- Recognition/OCR is not connected, and no receipt is sent to a recognition provider.

## Recommended next increment (not implemented)

1. **Recognition service.** Choose a hosted receipt/OCR service or a local OCR approach. A hosted option needs a server-only account/key, a spending limit, and agreement on sending receipt images to that provider. A local option avoids those requests but needs its own extraction and document-layout handling. Test with actual feed-store receipts before choosing.
2. **Extract a purchase draft.** Read vendor, date, item descriptions, quantities, prices, discounts, tax, and total. Treat the image and extracted text as data, never instructions. Check arithmetic in cents and show missing/uncertain fields instead of guessing.
3. **Match products and units.** Suggest existing inventory products and their saved bag/bale/supplement unit conversions. Remember approved vendor descriptions as aliases. A printed package weight does not establish the weight of a scoop or flake.
4. **Review before saving.** Show the receipt beside editable suggestions and require confirmation of product, quantity, unit, cost, and paid/unpaid status. A receipt image alone should not determine payment status or authorize recording costs automatically.
5. **Record exactly once.** Start with one reviewed inventory product per purchase. Supporting a whole multi-item receipt needs a purchase header/line model and an atomic multi-product operation: one expense/receipt, several stock additions, reviewed tax/discount allocation, and exactly reconciled totals. The current purchase operation creates one expense per stock purchase; sending every recognized item through that operation with the full receipt total would duplicate costs.
6. **Recover and audit.** Preserve approved values, extraction provenance, confidence flags, retry IDs, and the original private receipt. Detect likely repeat purchases without blocking legitimate purchases that happen to have equal totals. Keep provider failures separate from saved purchase state.

This is a separate feature beyond camera capture. The remaining work is recognition integration, product mapping, review, and financial reconciliation; the file capture, private attachment, unit conversions, and stock valuation foundations already exist.

## Verification limits

Camera invocation and image preparation require testing on the owner’s actual phone/browser. Local checks cover the controls and receipt persistence/recovery logic; they do not confirm live Supabase uploads or physical camera capture.

## Browser reference

[MDN: HTML capture attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) describes the camera hint and device-dependent behavior. No permanently running camera stream is needed for this workflow.
