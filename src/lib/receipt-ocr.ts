import type { ReceiptItemDraft } from "./receipt-purchase.ts";
export const ocrPhotoLimit = 900000;
export function receiptOcrConfigured(env: Record<string, string | undefined>) {
  return (
    env.VERCEL_ENV === "production" &&
    env.OCR_SPACE_FREE_ENABLED === "1" &&
    Boolean(
      env.NEXT_PUBLIC_SUPABASE_URL &&
      (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY),
    ) &&
    Boolean(
      env.OCR_SPACE_API_KEY &&
      env.OCR_SPACE_API_KEY.toLowerCase() !== "helloworld" &&
      /^[a-z0-9_-]{6,200}$/i.test(env.OCR_SPACE_API_KEY),
    )
  );
}
export type ReceiptOcrSuggestion = {
  vendor?: string;
  date?: string;
  total?: string;
  tax?: string;
  discount?: string;
  items: { description: string; subtotal: string; sourceLine: number }[];
  warnings: string[];
};
export function parseReceiptText(text: string): ReceiptOcrSuggestion {
  if (!text.trim() || text.length > 40000)
    throw Error(
      "Receipt text is empty or too long. Enter the receipt manually.",
    );
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const result: ReceiptOcrSuggestion = {
    items: [],
    warnings: [
      "All suggestions are unverified. Choose item types, products, units, quantities and tax eligibility yourself. No payment status is inferred.",
    ],
  };
  const values = {
    total: [] as string[],
    tax: [] as string[],
    discount: [] as string[],
  };
  const dates = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const date = line.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/) ?? null;
    const us = line.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    const candidate = date
      ? `${date[1]}-${date[2]}-${date[3]}`
      : us
        ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
        : null;
    if (
      candidate &&
      Number.isFinite(Date.parse(candidate)) &&
      new Date(candidate).toISOString().slice(0, 10) === candidate
    )
      dates.add(candidate);
    const total = line.match(
      /^(?:grand\s+total|total|amount\s+due)\s*:?\s*\$?\s*(\d{1,6}\.\d{2})\s*$/i,
    );
    const tax = line.match(
      /^(?:sales\s+)?tax\s*:?\s*\$?\s*(\d{1,6}\.\d{2})\s*$/i,
    );
    const discount = line.match(
      /^(?:total\s+)?discount\s*:?\s*-?\s*\$?\s*(\d{1,6}\.\d{2})\s*$/i,
    );
    if (total) {
      values.total.push(total[1]);
      continue;
    }
    if (tax) {
      values.tax.push(tax[1]);
      continue;
    }
    if (discount) {
      values.discount.push(discount[1]);
      continue;
    }
    if (
      /\b(sub\s*total|total|tax|discount|coupon|saving|change|cash|credit|debit|visa|mastercard|payment|balance|amount\s+due|tender|refund|return)\b/i.test(
        line,
      )
    )
      continue;
    if (/-\s*\$?\d+\.\d{2}/.test(line)) {
      result.warnings.push(
        "A negative line was not imported. Review discounts or returns manually.",
      );
      continue;
    }
    const item = line.match(/^(.{2,200}?)\s+\$?\s*(\d{1,6}\.\d{2})\s*$/);
    if (item && /[a-z]/i.test(item[1]))
      result.items.push({
        description: item[1].trim(),
        subtotal: item[2],
        sourceLine: index + 1,
      });
  }
  const first = lines[0];
  if (first && first.length <= 200 && !/\d{1,6}\.\d{2}|^\d/.test(first))
    result.vendor = first;
  if (dates.size === 1) result.date = [...dates][0];
  else
    result.warnings.push(
      "Purchase date was missing or ambiguous; enter it manually.",
    );
  for (const field of ["total", "tax", "discount"] as const) {
    const unique = [...new Set(values[field])];
    if (unique.length === 1) result[field] = unique[0];
    else
      result.warnings.push(
        `${field[0].toUpperCase() + field.slice(1)} was missing or ambiguous; enter it manually, including zero when appropriate.`,
      );
  }
  if (result.items.length > 20) {
    result.items = [];
    result.warnings.push(
      "More than 20 possible items were found. No item list was imported; enter or split this receipt manually.",
    );
  }
  if (!result.items.length)
    result.warnings.push(
      "No supported item rows were identified. Use the extracted text to enter items manually.",
    );
  result.warnings = [...new Set(result.warnings)];
  return result;
}

export function receiptItemsFromOcr(
  suggestion: ReceiptOcrSuggestion,
  products: { id: string; name: string }[],
): ReceiptItemDraft[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return suggestion.items.map((item) => {
    const matches = products.filter(
      (p) => normalize(p.name) === normalize(item.description),
    );
    return {
      id: crypto.randomUUID(),
      kind: matches.length === 1 ? "inventory" : "",
      description: item.description,
      subtotal: item.subtotal,
      product_id: matches.length === 1 ? matches[0].id : "",
      unit_id: "",
      quantity: "",
      discount: "0.00",
      tax: "0.00",
      discountEligible: true,
      taxEligible: false,
    };
  });
}
