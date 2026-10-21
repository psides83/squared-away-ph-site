"use client";
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
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="text-button danger"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmText)) event.preventDefault();
      }}
    >
      {pending ? "Working…" : label}
    </button>
  );
}
