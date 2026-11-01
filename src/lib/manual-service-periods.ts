import {
  manualFeedPeriodValues,
  type ManualFeedLine,
  type ManualFeedPeriod,
} from "./manual-feed-periods.ts";
import { text } from "./validation.ts";
export function manualServicePeriodValues(f: FormData) {
  const token = text(f, "source_token", true, 32)!;
  if (!/^[a-f0-9]{32}$/.test(token))
    throw Error("Reopen the current service-period editor.");
  return { ...manualFeedPeriodValues(f), p_token: token };
}
export type ManualServicePeriod = ManualFeedPeriod & {
  source_token: string;
  service: "training" | "board";
  days: { day: string; status: string }[] | null;
};
export type ManualServiceLine = Omit<ManualFeedLine, "current" | "history"> & {
  source_token: string | null;
  service: "training" | "board";
  current: ManualServicePeriod | null;
  history: ManualServicePeriod[];
};
export type ManualServiceOptions = {
  count: number;
  lines: ManualServiceLine[];
};
