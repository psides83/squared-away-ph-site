export function phoneDisplay(value: string | null | undefined) {
  if (!value) return "";
  if (
    /[a-z]/i.test(value) ||
    (value.startsWith("+") && !value.startsWith("+1"))
  )
    return value;
  const digits = value.replace(/\D/g, "");
  const local =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10
    ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : value;
}
export function phoneInput(value: string) {
  if (
    /[a-z]/i.test(value) ||
    (value.startsWith("+") && !value.startsWith("+1"))
  )
    return value;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  if (digits.length > 10) return value;
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
export function servingStepper(label: string) {
  return /^(scoops?|flakes?|bags?|bales?|tubs?|cups?|tbsp|tsp)$/i.test(
    label.trim(),
  );
}
