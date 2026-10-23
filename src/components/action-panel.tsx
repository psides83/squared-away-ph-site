"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { X } from "lucide-react";

/** Keeps editing separate from the page's read-only overview. */
export function ActionPanel({
  id,
  label,
  children,
  defaultOpen = false,
  closeHref,
  hideTrigger = false,
  dismissLabel = "Close without saving",
}: {
  id: string;
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  closeHref?: string;
  dismissLabel?: string;
  hideTrigger?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const opener = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const location = usePathname() + "?" + useSearchParams().toString();
  const previousLocation = useRef(location);
  const navigationClose = useRef(false);
  useEffect(() => {
    if (
      previousLocation.current !== location &&
      !defaultOpen &&
      dialog.current?.open
    ) {
      navigationClose.current = true;
      dialog.current.close();
    }
    previousLocation.current = location;
    let frame = 0;
    const openDialog = () => {
      window.cancelAnimationFrame(frame);
      dialog.current?.dispatchEvent(new Event("reveal-tab", { bubbles: true }));
      frame = window.requestAnimationFrame(() => {
        if (dialog.current && !dialog.current.open) {
          opener.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          dialog.current.showModal();
        }
      });
    };
    const openForHash = () => {
      if (window.location.hash === `#${id}` && !dialog.current?.open)
        openDialog();
    };
    if (
      defaultOpen &&
      !dialog.current?.open &&
      (!window.location.hash || window.location.hash === `#${id}`)
    )
      openDialog();
    openForHash();
    window.addEventListener("hashchange", openForHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", openForHash);
    };
  }, [defaultOpen, id, location]);
  function close() {
    setRevision((value) => value + 1);
    if (window.location.hash === `#${id}`)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    if (hideTrigger) opener.current?.focus();
    else trigger.current?.focus();
    if (navigationClose.current) {
      navigationClose.current = false;
      return;
    }
    if (closeHref) router.replace(closeHref, { scroll: false });
  }
  return (
    <div className="action-launcher" id={id}>
      <button
        hidden={hideTrigger}
        ref={trigger}
        type="button"
        className="button secondary"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="action-dialog"
        aria-labelledby={titleId}
        onClose={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="action-dialog-bar">
          <h2 id={titleId}>{label}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label={dismissLabel}
            onClick={() => dialog.current?.close()}
          >
            <X size={22} />
          </button>
        </div>
        <div className="action-dialog-body" key={revision}>
          {children}
        </div>
        <div className="action-dialog-footer">
          <button
            type="button"
            className="text-button"
            onClick={() => dialog.current?.close()}
          >
            {dismissLabel}
          </button>
        </div>
      </dialog>
    </div>
  );
}
