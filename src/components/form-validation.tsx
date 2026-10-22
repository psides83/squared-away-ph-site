"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
type InvalidField = {
  field: HTMLInputElement;
  host: HTMLElement;
  message: string;
  id: string;
};
/** Keep HTML constraint validation and replace browser bubbles with inline app feedback. */
export function FormValidation() {
  const [errors, setErrors] = useState<InvalidField[]>([]);
  const group = useId(),
    focusQueued = useRef(false),
    serial = useRef(0);
  const errorsFor = useRef(new Map<HTMLInputElement, string>());
  useEffect(() => {
    const invalid = (event: Event) => {
      event.preventDefault();
      const field = event.target as HTMLInputElement;
      if (!field.validity) return;
      for (const saved of errorsFor.current.keys())
        if (!saved.isConnected) errorsFor.current.delete(saved);
      const host = field.closest<HTMLElement>("label") ?? field.parentElement;
      if (!host) return;
      const id = `${group}-error-${serial.current++}`;
      const message = field.validity.valueMissing
        ? field.type === "checkbox"
          ? "Please confirm this choice."
          : "This field is required."
        : field.validationMessage || "Check this value.";
      setErrors((current) => [
        ...current.filter((e) => e.field !== field && e.field.isConnected),
        { field, host, message, id },
      ]);
      field.setAttribute("aria-invalid", "true");
      const visible = field.dataset.appTrigger
        ? document.getElementById(field.dataset.appTrigger)
        : field;
      visible?.setAttribute("aria-invalid", "true");
      // Only append our own reference; retain pre-existing help text IDs.
      const previous = errorsFor.current.get(field);
      if (previous) {
        for (const node of [field, visible]) {
          if (node)
            node.setAttribute(
              "aria-describedby",
              (node.getAttribute("aria-describedby") ?? "")
                .split(" ")
                .filter((part) => part && part !== previous)
                .join(" "),
            );
        }
      }
      for (const node of [field, visible]) {
        if (node)
          node.setAttribute(
            "aria-describedby",
            [
              ...new Set([
                ...(node.getAttribute("aria-describedby") ?? "")
                  .split(" ")
                  .filter(Boolean),
                id,
              ]),
            ].join(" "),
          );
      }
      errorsFor.current.set(field, id);
      if (!focusQueued.current) {
        focusQueued.current = true;
        requestAnimationFrame(() => {
          flushSync(() =>
            field.dispatchEvent(new Event("reveal-tab", { bubbles: true })),
          );
          const trigger = field.dataset.appTrigger
            ? document.getElementById(field.dataset.appTrigger)
            : field;
          trigger?.focus();
          trigger?.scrollIntoView({ block: "nearest" });
          focusQueued.current = false;
        });
      }
    };
    const clear = (event: Event) => {
      const field = event.target as HTMLInputElement;
      if (!field.validity?.valid) return;
      const visible = field.dataset.appTrigger
        ? document.getElementById(field.dataset.appTrigger)
        : field;
      const id = errorsFor.current.get(field);
      for (const node of [field, visible]) {
        if (node) {
          node.removeAttribute("aria-invalid");
          node.setAttribute(
            "aria-describedby",
            (node.getAttribute("aria-describedby") ?? "")
              .split(" ")
              .filter((part) => part && part !== id)
              .join(" "),
          );
        }
      }
      errorsFor.current.delete(field);
      setErrors((current) =>
        current.filter((e) => e.field !== field && e.field.isConnected),
      );
    };
    const reset = () => {
      for (const [field, id] of errorsFor.current) {
        const visible = field.dataset.appTrigger
          ? document.getElementById(field.dataset.appTrigger)
          : field;
        for (const node of [field, visible]) {
          node?.removeAttribute("aria-invalid");
          node?.setAttribute(
            "aria-describedby",
            (node.getAttribute("aria-describedby") ?? "")
              .split(" ")
              .filter((part) => part && part !== id)
              .join(" "),
          );
        }
      }
      errorsFor.current.clear();
      setErrors([]);
    };
    document.addEventListener("invalid", invalid, true);
    document.addEventListener("input", clear, true);
    document.addEventListener("change", clear, true);
    document.addEventListener("reset", reset, true);
    return () => {
      document.removeEventListener("invalid", invalid, true);
      document.removeEventListener("input", clear, true);
      document.removeEventListener("change", clear, true);
      document.removeEventListener("reset", reset, true);
    };
  }, [group]);
  return (
    <>
      {errors
        .filter((e) => e.field.isConnected)
        .map((e) =>
          createPortal(
            <span className="field-error" id={e.id} role="alert" key={e.id}>
              {e.message}
            </span>,
            e.host,
            e.id,
          ),
        )}
    </>
  );
}
