import { identifier, text } from "./validation.ts";
export type RecoverySource = {
  linked?: boolean;
  movement_id?: string;
  split_id?: string;
  expense_id?: string;
  label: string | null;
  date: string;
  cost_cents: number;
};
export type RecoveryLine = {
  id: string;
  invoice_id: string;
  description: string;
  service: "feed" | "boarding";
  amount_cents: number;
  source_cost_cents: number | null;
  source_token: string | null;
  ready: boolean;
  reason: string | null;
  from: string | null;
  to: string | null;
  linked_count?: number;
  missing_count?: number;
  sources: RecoverySource[];
};
export type RecoveryOptions = {
  count: number;
  lines: RecoveryLine[];
  history: {
    id: string;
    line_id: string;
    reason: string;
    created_at: string;
    captured_source?: { linked_count?: number; missing_count?: number };
  }[];
};
export function actualRecoveryValues(f: FormData) {
  const token = text(f, "source_token", true, 32)!;
  if (!/^[a-f0-9]{32}$/.test(token))
    throw Error("Reopen the current original-source review.");
  return {
    p_request: identifier(f, "request_id", true),
    p_line: identifier(f, "line_id", true),
    p_token: token,
    p_reason: text(f, "reason", true, 2000),
  };
}
