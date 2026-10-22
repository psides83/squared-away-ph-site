"use client";
import { useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle } from "lucide-react";
export function ConfirmButton({
  children,
  message,
  destructive = false,
  className = "button",
}: {
  children: React.ReactNode;
  message: string;
  destructive?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const title = useId(),
    description = useId();
  return (
    <>
      <button
        ref={trigger}
        type="submit"
        className={className}
        disabled={pending}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.preventDefault();
          if (trigger.current?.form?.reportValidity())
            dialog.current?.showModal();
        }}
      >
        {pending ? "Working…" : children}
      </button>
      <dialog
        ref={dialog}
        className="app-dialog confirmation-dialog"
        aria-labelledby={title}
        aria-describedby={description}
        onClose={(event) => {
          event.stopPropagation();
          trigger.current?.focus();
        }}
      >
        <div className="confirmation-content">
          <span className="confirmation-icon">
            <AlertTriangle size={24} />
          </span>
          <h2 id={title}>
            {destructive ? "Confirm this change" : "Review before continuing"}
          </h2>
          <p id={description}>{message}</p>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              autoFocus
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`button ${destructive ? "button-danger" : ""}`}
              disabled={pending}
              onClick={() => {
                dialog.current?.close();
                trigger.current?.form?.requestSubmit(trigger.current);
              }}
            >
              {children}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
