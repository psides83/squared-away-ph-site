"use client";
import { ConfirmButton } from "@/components/confirm-button";
import { useFormStatus } from "react-dom";
export function SubmitButton({
  children,
  className = "button",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
export function DeleteButton({
  label = "Delete",
  confirmText = "Delete this record? This cannot be undone.",
}: {
  label?: string;
  confirmText?: string;
}) {
  return (
    <ConfirmButton
      destructive
      className="text-button danger"
      message={confirmText}
    >
      {label}
    </ConfirmButton>
  );
}
