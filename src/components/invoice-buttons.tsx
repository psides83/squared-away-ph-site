"use client";
import { ConfirmButton } from "@/components/confirm-button";
export function InvoiceConfirmButton({
  children,
  prompt,
}: {
  children: React.ReactNode;
  prompt: string;
}) {
  return <ConfirmButton message={prompt}>{children}</ConfirmButton>;
}
export function PrintInvoice() {
  return (
    <button
      className="button secondary"
      type="button"
      onClick={() => window.print()}
    >
      Print / save PDF
    </button>
  );
}
