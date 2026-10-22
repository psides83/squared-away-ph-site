"use client";
import { useFormStatus } from "react-dom";
export function InvoiceConfirmButton({
  children,
  prompt,
}: {
  children: React.ReactNode;
  prompt: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="button"
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(prompt)) e.preventDefault();
      }}
    >
      {pending ? "Saving…" : children}
    </button>
  );
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
