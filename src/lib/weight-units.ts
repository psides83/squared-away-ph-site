// Weight ounces are the inventory base; volume and serving measures need a measured weight.
export const weightUnits = [
  { label: "oz", name: "Ounces (weight)", ounces: "1", reference: "1 oz" },
  { label: "lb", name: "Pounds", ounces: "16", reference: "16 oz" },
  {
    label: "mg",
    name: "Milligrams",
    ounces: "0.000035273962",
    reference: "0.001 g",
  },
  { label: "g", name: "Grams", ounces: "0.035273961950", reference: "1 g" },
  {
    label: "kg",
    name: "Kilograms",
    ounces: "35.273961949580",
    reference: "1,000 g",
  },
  {
    label: "ton",
    name: "US tons (2,000 lb)",
    ounces: "32000",
    reference: "2,000 lb",
  },
  {
    label: "tonne",
    name: "Metric tonnes (1,000 kg)",
    ounces: "35273.961949580413",
    reference: "1,000 kg",
  },
] as const;

export function weightInOunces(value: string, label: string) {
  const unit = weightUnits.find((u) => u.label === label);
  if (!unit || !/^\d+(\.\d{1,12})?$/.test(value))
    throw new Error(
      "Enter a positive weight with up to twelve decimal places.",
    );
  const scale = 10n ** 12n;
  const fixed = (s: string) => {
    const [whole, fraction = ""] = s.split(".");
    return BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0"));
  };
  const metric = {
    mg: [1n, 1000n],
    g: [1n, 1n],
    kg: [1000n, 1n],
    tonne: [1000000n, 1n],
  }[label];
  const numerator = metric
    ? fixed(value) * metric[0] * 1000000000n
    : fixed(value) * fixed(unit.ounces);
  const denominator = metric ? 28349523125n * metric[1] : scale;
  const ounces = (numerator + denominator / 2n) / denominator;
  if (ounces <= 0n || ounces > 1000000000n * scale)
    throw new Error(
      "Weight must be above inventory precision and at most one billion ounces.",
    );
  return `${ounces / scale}.${(ounces % scale).toString().padStart(12, "0")}`;
}

/** Keep exact database decimals while removing display-only trailing zeroes. */
export function conversionWeightText(value: string | number) {
  const text = typeof value === "number" ? value.toFixed(12) : value;
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
