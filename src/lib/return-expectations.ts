export type ReturnExpectation = {
  version: string;
  cash_cents: number | null;
  cash_due: string | null;
  credit_cents: number | null;
  credit_due: string | null;
  notes: string | null;
};
export function expectedRecovery(
  expected: number | null,
  actual: number,
  due: string | null,
  today: string,
  cancelled = false,
) {
  const remaining = expected === null ? null : Math.max(expected - actual, 0);
  return {
    remaining,
    excess: expected === null ? 0 : Math.max(actual - expected, 0),
    overdue:
      !cancelled &&
      remaining !== null &&
      remaining > 0 &&
      due !== null &&
      due < today,
  };
}
