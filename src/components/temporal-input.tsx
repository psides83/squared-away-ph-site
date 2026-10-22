"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  X,
} from "lucide-react";
import { today } from "@/lib/format";
import { monthDays, shiftMonth, temporalError } from "@/lib/calendar-input";
import { AppSelect } from "@/components/app-select";
export function TemporalInput({
  type = "date",
  value,
  defaultValue,
  onChange,
  min,
  max,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const [local, setLocal] = useState(String(value ?? defaultValue ?? ""));
  const [month, setMonth] = useState(
    (String(value ?? defaultValue ?? "") || today()).slice(0, 7),
  );
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const title = useId(),
    id = useId();
  const [label, setLabel] = useState(
    props["aria-label"] ??
      props.name?.replaceAll("_", " ") ??
      (type === "time" ? "Time" : "Date"),
  );
  useEffect(() => {
    if (props["aria-label"]) return;
    const parent = input.current?.closest("label");
    const text = parent
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
    if (text) setLabel(text);
  }, [props["aria-label"]]);
  useEffect(() => {
    if (value !== undefined) setLocal(String(value));
  }, [value]);
  useEffect(() => {
    input.current?.setCustomValidity(temporalError(local, type, min, max));
  }, [local, type, min, max]);
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => setLocal(String(defaultValue ?? ""));
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue]);
  function change(next: string) {
    setLocal(next);
    if (input.current) {
      input.current.value = next;
      input.current.setCustomValidity(temporalError(next, type, min, max));
      if (!temporalError(next, type, min, max))
        onChange?.({
          target: input.current,
          currentTarget: input.current,
        } as React.ChangeEvent<HTMLInputElement>);
      input.current.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  function choose(next: string) {
    change(next);
    dialog.current?.close();
  }
  function show() {
    setMonth(
      (local && !temporalError(local, type) && type !== "time"
        ? local
        : today()
      ).slice(0, 7),
    );
    setDraft(type === "time" && !temporalError(local, type) ? local : "07:00");
    setOpen(true);
    dialog.current?.showModal();
    if (type === "date")
      requestAnimationFrame(() => {
        (
          dialog.current?.querySelector<HTMLButtonElement>(
            '[aria-pressed="true"]:not(:disabled)',
          ) ??
          dialog.current?.querySelector<HTMLButtonElement>(
            ".calendar-day:not(:disabled)",
          )
        )?.focus();
      });
  }
  const monthName = new Date(month + "-01T12:00:00Z").toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
  return (
    <span className={`temporal-control temporal-${type}`}>
      <input
        {...props}
        id={props.id ?? id}
        ref={input}
        aria-label={label}
        type="text"
        value={local}
        autoComplete="off"
        inputMode="text"
        placeholder={
          type === "time"
            ? "HH:mm"
            : type === "month"
              ? "YYYY-MM"
              : "YYYY-MM-DD"
        }
        maxLength={type === "time" ? 5 : type === "month" ? 7 : 10}
        onChange={(e) => change(e.target.value)}
      />
      <button
        ref={trigger}
        className="temporal-trigger"
        type="button"
        disabled={props.disabled || props.readOnly}
        aria-haspopup="dialog"
        aria-label={`Choose ${label}`}
        onClick={show}
      >
        {type === "time" ? <Clock size={18} /> : <CalendarDays size={18} />}
      </button>
      <dialog
        ref={dialog}
        className="app-dialog calendar-dialog"
        aria-labelledby={title}
        onClose={(event) => {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className="app-dialog-heading">
          <h2 id={title}>Choose {label}</h2>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close picker"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <div className="calendar-body">
          {open &&
            (type === "time" ? (
              <>
                <div className="time-columns">
                  <label>
                    Hour
                    <AppSelect
                      aria-label="Hour"
                      value={draft.slice(0, 2)}
                      onChange={(e) =>
                        setDraft(e.target.value + ":" + draft.slice(3))
                      }
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={String(h).padStart(2, "0")}>
                          {String(h).padStart(2, "0")}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                  <label>
                    Minute
                    <AppSelect
                      aria-label="Minute"
                      value={draft.slice(3)}
                      onChange={(e) =>
                        setDraft(draft.slice(0, 2) + ":" + e.target.value)
                      }
                    >
                      {Array.from({ length: 60 }, (_, m) => (
                        <option key={m} value={String(m).padStart(2, "0")}>
                          {String(m).padStart(2, "0")}
                        </option>
                      ))}
                    </AppSelect>
                  </label>
                </div>
                <p className="muted">
                  24-hour time · 07:00 is 7 AM, 19:00 is 7 PM.
                </p>
                <button
                  type="button"
                  className="button"
                  disabled={Boolean(temporalError(draft, type, min, max))}
                  onClick={() => choose(draft)}
                >
                  Use this time
                </button>
              </>
            ) : (
              <>
                <div className="calendar-navigation">
                  <button
                    className="dialog-close"
                    type="button"
                    aria-label="Previous month"
                    onClick={() => setMonth(shiftMonth(month, -1))}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <strong aria-live="polite">{monthName}</strong>
                  <button
                    className="dialog-close"
                    type="button"
                    aria-label="Next month"
                    onClick={() => setMonth(shiftMonth(month, 1))}
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
                <div className="calendar-jump">
                  <AppSelect
                    aria-label="Month"
                    value={month.slice(5)}
                    onChange={(e) =>
                      setMonth(month.slice(0, 4) + "-" + e.target.value)
                    }
                  >
                    {Array.from({ length: 12 }, (_, m) => (
                      <option key={m} value={String(m + 1).padStart(2, "0")}>
                        {new Date(Date.UTC(2000, m, 1)).toLocaleDateString(
                          "en-US",
                          { month: "long", timeZone: "UTC" },
                        )}
                      </option>
                    ))}
                  </AppSelect>
                  <AppSelect
                    aria-label="Year"
                    value={month.slice(0, 4)}
                    onChange={(e) => setMonth(e.target.value + month.slice(4))}
                  >
                    {Array.from({ length: 301 }, (_, i) => (
                      <option key={i} value={1900 + i}>
                        {1900 + i}
                      </option>
                    ))}
                  </AppSelect>
                </div>
                {type === "month" ? (
                  <button
                    type="button"
                    className="button"
                    disabled={Boolean(temporalError(month, type, min, max))}
                    onClick={() => choose(month)}
                  >
                    Use {monthName}
                  </button>
                ) : (
                  <div className="calendar-grid" aria-label={monthName}>
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <span className="calendar-weekday" key={d}>
                        {d}
                      </span>
                    ))}
                    {monthDays(month).map((d, i) =>
                      d ? (
                        <button
                          key={d}
                          type="button"
                          className={`calendar-day ${d === local ? "is-selected" : ""}`}
                          aria-label={new Date(
                            d + "T12:00:00Z",
                          ).toLocaleDateString("en-US", {
                            dateStyle: "full",
                            timeZone: "UTC",
                          })}
                          tabIndex={
                            d ===
                            (local.startsWith(month) ? local : `${month}-01`)
                              ? 0
                              : -1
                          }
                          aria-pressed={d === local}
                          aria-current={d === today() ? "date" : undefined}
                          disabled={Boolean(temporalError(d, type, min, max))}
                          onClick={() => choose(d)}
                          onKeyDown={(e) => {
                            const offset =
                              e.key === "ArrowRight"
                                ? 1
                                : e.key === "ArrowLeft"
                                  ? -1
                                  : e.key === "ArrowDown"
                                    ? 7
                                    : e.key === "ArrowUp"
                                      ? -7
                                      : 0;
                            if (!offset) return;
                            e.preventDefault();
                            const next = new Date(d + "T12:00:00Z");
                            next.setUTCDate(next.getUTCDate() + offset);
                            const key = next.toISOString().slice(0, 10);
                            setMonth(key.slice(0, 7));
                            requestAnimationFrame(() =>
                              dialog.current
                                ?.querySelector<HTMLButtonElement>(
                                  `[data-date="${key}"]`,
                                )
                                ?.focus(),
                            );
                          }}
                          data-date={d}
                        >
                          {Number(d.slice(8))}
                        </button>
                      ) : (
                        <span key={i} />
                      ),
                    )}
                  </div>
                )}
                <div className="form-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={Boolean(
                      temporalError(
                        type === "month" ? today().slice(0, 7) : today(),
                        type,
                        min,
                        max,
                      ),
                    )}
                    onClick={() =>
                      choose(type === "month" ? today().slice(0, 7) : today())
                    }
                  >
                    Today
                  </button>
                  {!props.required && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => choose("")}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </>
            ))}
        </div>
      </dialog>
    </span>
  );
}
