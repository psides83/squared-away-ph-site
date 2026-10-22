"use client";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Check, ChevronDown, X } from "lucide-react";
type Option = { value: string; label: string; disabled: boolean };
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((n) =>
      isValidElement<{ children?: ReactNode }>(n)
        ? text(n.props.children)
        : String(n ?? ""),
    )
    .join("");
}
function optionsFrom(children: ReactNode, disabled = false): Option[] {
  const result: Option[] = [];
  Children.forEach(children, (child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return;
    if (child.type === "option")
      result.push({
        value: String(child.props.value ?? text(child.props.children)),
        label: text(child.props.children),
        disabled: disabled || Boolean(child.props.disabled),
      });
    else
      result.push(
        ...optionsFrom(
          child.props.children,
          disabled || Boolean(child.props.disabled),
        ),
      );
  });
  return result;
}
export function AppSelect({
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = optionsFrom(children);
  const [local, setLocal] = useState(
    String(defaultValue ?? options[0]?.value ?? ""),
  );
  const selected = String(value ?? local);
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [label, setLabel] = useState(
      props["aria-label"] ??
        props.name?.replaceAll("_", " ") ??
        "Choose an option",
    );
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    field = useRef<HTMLSelectElement>(null),
    list = useRef<HTMLDivElement>(null);
  const title = useId(),
    listId = useId(),
    triggerId = useId();
  useEffect(() => {
    if (props["aria-label"]) return;
    const parent = trigger.current?.closest("label");
    const name = parent
      ? Array.from(parent.childNodes)
          .filter(
            (n) =>
              n.nodeType === Node.TEXT_NODE ||
              (n instanceof HTMLElement && n.classList.contains("field-label")),
          )
          .map((n) => n.textContent)
          .join(" ")
          .replace(/\s+/g, " ")
          .replace(/\*/g, "")
          .trim()
      : "";
    if (name) setLabel(name);
  }, [props["aria-label"]]);
  useEffect(() => {
    const form = field.current?.form;
    const reset = () => {
      setLocal(String(defaultValue ?? options[0]?.value ?? ""));
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue, children]);
  function show() {
    setSearch("");
    setOpen(true);
    dialog.current?.showModal();
    requestAnimationFrame(() => {
      if (options.length <= 7) {
        const option =
          list.current?.querySelector<HTMLButtonElement>(
            '[aria-selected="true"]:not(:disabled)',
          ) ??
          list.current?.querySelector<HTMLButtonElement>(
            "button:not(:disabled)",
          );
        option?.focus();
        option?.scrollIntoView({ block: "nearest" });
      }
    });
  }
  function choose(next: string) {
    if (!field.current) return;
    setLocal(next);
    field.current.value = next;
    field.current.dispatchEvent(new Event("change", { bubbles: true }));
    dialog.current?.close();
  }
  const visible = options.filter((o) =>
    o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <span className={`app-select ${className ?? ""}`}>
      <select
        {...props}
        value={selected}
        disabled={disabled}
        ref={field}
        className="app-validation-control"
        tabIndex={-1}
        aria-hidden="true"
        data-app-trigger={triggerId}
        onChange={(event) => onChange?.(event)}
      >
        {children}
      </select>
      <button
        id={triggerId}
        ref={trigger}
        type="button"
        className="app-select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={props.required}
        disabled={disabled}
        onClick={show}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
      >
        <span>
          {options.find((o) => o.value === selected)?.label ??
            "Choose an option"}
        </span>
        <ChevronDown size={17} />
      </button>
      <dialog
        ref={dialog}
        className="app-dialog choice-dialog"
        aria-labelledby={title}
        onClose={(event) => {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className="app-dialog-heading">
          <h2 id={title}>{label}</h2>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close choices"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        {open && options.length > 7 && (
          <div className="choice-search">
            <input
              autoFocus
              type="text"
              role="searchbox"
              placeholder="Find an option…"
              aria-label={`Search ${label}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const first = visible.find((o) => !o.disabled);
                  if (first) choose(first.value);
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  list.current
                    ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                    ?.focus();
                }
              }}
            />
          </div>
        )}
        <div
          ref={list}
          className="choice-list"
          role="listbox"
          id={listId}
          aria-label={label}
          onKeyDown={(e) => {
            const buttons = Array.from(
              list.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) ?? [],
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            let next = -1;
            if (e.key === "ArrowDown") next = (index + 1) % buttons.length;
            if (e.key === "ArrowUp")
              next = (index - 1 + buttons.length) % buttons.length;
            if (e.key === "Home") next = 0;
            if (e.key === "End") next = buttons.length - 1;
            if (
              next < 0 &&
              e.key.length === 1 &&
              !e.ctrlKey &&
              !e.metaKey &&
              e.key !== " "
            ) {
              const candidates = [
                ...buttons.slice(index + 1),
                ...buttons.slice(0, index + 1),
              ];
              const match = candidates.find((b) =>
                b.textContent
                  ?.trim()
                  .toLocaleLowerCase()
                  .startsWith(e.key.toLocaleLowerCase()),
              );
              if (match) {
                e.preventDefault();
                match.focus();
              }
            }
            if (next >= 0) {
              e.preventDefault();
              buttons[next]?.focus();
            }
          }}
        >
          {open &&
            visible.map((o) => (
              <button
                type="button"
                role="option"
                className="choice-option"
                key={o.value}
                aria-selected={selected === o.value}
                disabled={o.disabled}
                onClick={() => choose(o.value)}
              >
                {o.label}
                {selected === o.value && <Check size={18} />}
              </button>
            ))}
          {open && !visible.length && (
            <p className="muted choice-empty">No matching options.</p>
          )}
        </div>
      </dialog>
    </span>
  );
}
