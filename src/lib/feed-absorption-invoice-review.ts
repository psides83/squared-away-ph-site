export type AbsorptionInvoiceEvent = {
  decision_id: string;
  movement_id: string;
  previous_cents: number;
  new_cents: number;
  resolution: string | null;
  captured_source: {
    feeding?: { horse?: string; product?: string; date?: string };
    reason?: string;
    invoice_amount_cents?: number;
  };
};
export type AbsorptionInvoiceReview = {
  invoice_id: string;
  status: string;
  source_token: string;
  pending_count: number;
  rows: AbsorptionInvoiceEvent[];
  history: AbsorptionInvoiceEvent[];
};
