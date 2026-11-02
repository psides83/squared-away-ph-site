import {
  manualFeedPeriodValues,
  type ManualFeedLine,
  type ManualFeedPeriod,
} from "./manual-feed-periods.ts";
import { cents, text } from "./validation.ts";
export function manualServicePeriodValues(f: FormData) {
  const token = text(f, "source_token", true, 32)!;
  if (!/^[a-f0-9]{32}$/.test(token))
    throw Error("Reopen the current service-period editor.");
  const base = manualFeedPeriodValues(f);
  const isPackage = f.get("package") === "yes";
  const feed = isPackage ? cents(f, "feed") : 0,
    board = isPackage ? cents(f, "board") : 0;
  if (isPackage && (base.p_amount < 0 || feed + board > base.p_amount))
    throw Error(
      "Feed and board portions must fit within the saved package charge.",
    );
  return {
    ...base,
    p_token: token,
    p_feed: feed,
    p_board: board,
    p_package: isPackage,
  };
}
export type ManualServicePeriod = ManualFeedPeriod & {
  source_token: string;
  service: "training" | "board";
  feed_cents?: number;
  board_cents?: number;
  package_reviewed?: boolean;
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
