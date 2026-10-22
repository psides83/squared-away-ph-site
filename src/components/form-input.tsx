"use client";
import { useRef, useState, type InputHTMLAttributes } from "react";
import { Minus, Plus } from "lucide-react";
import { phoneDisplay, phoneInput } from "@/lib/input-format";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  prefix?: string;
  suffix?: string;
  controls?: boolean;
};
export function FormInput({
  prefix,
  suffix,
  controls = false,
  defaultValue,
  value,
  onChange,
  type = "text",
  ...props
}: Props) {
  const initial =
    type === "tel"
      ? phoneDisplay(String(defaultValue ?? ""))
      : (defaultValue ?? "");
  const [local, setLocal] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  function adjust(direction: number) {
    const field = input.current;
    if (!field) return;
    if (!field.value) field.value = "1";
    else if (direction > 0)
      field.stepUp(Math.round(1 / Number(field.step || 1)));
    else field.stepDown(Math.round(1 / Number(field.step || 1)));
    setLocal(field.value);
  }
  const displayed =
    value === undefined
      ? local
      : type === "tel"
        ? phoneDisplay(String(value))
        : value;
  return (
    <span
      className={`input-control ${prefix ? "has-prefix" : ""} ${suffix ? "has-suffix" : ""} ${controls ? "with-controls" : ""}`}
    >
      {prefix && (
        <span className="input-affix input-prefix" aria-hidden="true">
          {prefix}
        </span>
      )}
      {controls && (
        <button
          type="button"
          className="quantity-button"
          aria-label={`Decrease ${props["aria-label"] ?? props.name ?? "quantity"}`}
          disabled={props.disabled || Number(displayed || 0) <= 1}
          onClick={() => adjust(-1)}
        >
          <Minus size={16} />
        </button>
      )}
      <input
        {...props}
        ref={input}
        type={type}
        value={displayed}
        inputMode={
          type === "number"
            ? props.step === "1"
              ? "numeric"
              : "decimal"
            : type === "tel"
              ? "tel"
              : props.inputMode
        }
        onChange={(e) => {
          const next =
            type === "tel" ? phoneInput(e.target.value) : e.target.value;
          if (type === "tel") e.target.value = next;
          setLocal(next);
          onChange?.(e);
        }}
      />
      {suffix && (
        <span className="input-affix input-suffix" aria-hidden="true">
          {suffix}
        </span>
      )}
      {controls && (
        <button
          type="button"
          className="quantity-button"
          aria-label={`Increase ${props["aria-label"] ?? props.name ?? "quantity"}`}
          disabled={props.disabled}
          onClick={() => adjust(1)}
        >
          <Plus size={16} />
        </button>
      )}
    </span>
  );
}
