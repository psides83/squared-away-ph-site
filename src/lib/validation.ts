export function text(
  form: FormData,
  name: string,
  required = false,
  max = 2000,
) {
  const value = form.get(name);
  if (value !== null && typeof value !== "string")
    throw new Error(`Invalid ${name.replaceAll("_", " ")}.`);
  const cleaned = (value ?? "").trim();
  if (required && !cleaned)
    throw new Error(`Please enter ${name.replaceAll("_", " ")}.`);
  if (cleaned.length > max)
    throw new Error(
      `${name.replaceAll("_", " ")} is too long (maximum ${max} characters).`,
    );
  return cleaned || null;
}
export function identifier(form: FormData, name: string, required = false) {
  const value = text(form, name, required, 36);
  if (
    value &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error("Please select a valid record.");
  return value;
}
export function dateValue(form: FormData, name: string, required = false) {
  const value = text(form, name, required, 10);
  if (
    value &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value)
  )
    throw new Error("Please enter a valid date.");
  return value;
}
export function cents(form: FormData, name: string) {
  const value = text(form, name, true, 12)!;
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Enter an amount with no more than two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 100000000)
    throw new Error("Amount is too large.");
  return result;
}
export function choice(
  form: FormData,
  name: string,
  options: readonly string[],
) {
  const value = text(form, name, true)!;
  if (!options.includes(value))
    throw new Error(`Please select a valid ${name.replaceAll("_", " ")}.`);
  return value;
}
