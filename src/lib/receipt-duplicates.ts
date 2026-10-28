import { text } from "./validation.ts";
export type ReceiptDuplicateReview = {
  count: number;
  token: string;
  matches: {
    id: string;
    vendor: string | null;
    expense_date: string;
    amount_cents: number;
  }[];
};
export function receiptDuplicateApproval(form: FormData) {
  if (form.get("duplicate_ack") !== "on") return null;
  const token = text(form, "duplicate_review_token", true, 32)!;
  if (!/^[a-f0-9]{32}$/.test(token))
    throw Error("Check the duplicate receipt matches again.");
  return {
    duplicate_review_token: token,
    duplicate_reason: text(form, "duplicate_reason", true, 2000)!,
  };
}
