import Link from "next/link";
import { ArrowUpRight, Plus, type LucideIcon } from "lucide-react";

export function PageHeading({
  eyebrow = "BARN OFFICE",
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action && (
        <Link href={action.href} className="button">
          <Plus size={17} />
          {action.label}
        </Link>
      )}
    </div>
  );
}
export function EmptyState({
  icon: Icon,
  title,
  description,
  href,
  label,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {href && (
        <Link className="text-link" href={href}>
          {label}
          <ArrowUpRight size={16} />
        </Link>
      )}
    </div>
  );
}
export function Notice({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="notice success" role="status">
          {success}
        </p>
      )}
    </>
  );
}
export function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder,
  maxLength = 200,
  min,
  max,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number | null;
  placeholder?: string;
  maxLength?: number;
  min?: string | number;
  max?: string | number;
  step?: string;
}) {
  return (
    <label>
      {label}
      {required && <span className="required"> *</span>}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}
