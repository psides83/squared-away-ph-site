import {
  manualFeedPeriodValues,
  type ManualFeedLine,
  type ManualFeedPeriod,
} from "./manual-feed-periods.ts";
import { text } from "./validation.ts";
export function monthlyServicePeriodValues(f: FormData) {
  const base = manualFeedPeriodValues(f);
  const token = text(f, "source_token", true, 32)!;
  if (!base.p_stay || base.p_amount < 0 || !/^[a-f0-9]{32}$/.test(token))
    throw Error(
      "Reopen the current monthly charge with its assigned training stay.",
    );
  return { ...base, p_token: token };
}
export type MonthlyServicePeriod = ManualFeedPeriod & {
  source_token: string;
  service: "feed" | "boarding";
};
export type MonthlyServiceLine = Omit<
  ManualFeedLine,
  "current" | "history" | "has_saved_period"
> & {
  source_token: string;
  service: "feed" | "boarding";
  missing_sources: boolean;
  current: MonthlyServicePeriod | null;
  history: MonthlyServicePeriod[];
};
export type MonthlyServiceOptions = {
  count: number;
  lines: MonthlyServiceLine[];
};
