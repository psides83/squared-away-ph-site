import { cents, identifier, text } from "./validation.ts";
export type PackageSplit = {
  feed_cents: number;
  board_cents: number;
  training_cents: number;
  feed_included: boolean | null;
  board_included?: boolean;
};
export type PackageReview = PackageSplit & {
  id: string;
  stay_id: string;
  horse_id: string;
  amount_cents: number;
  reason: string;
  cleared: boolean;
  retired_at: string | null;
};
export type PackageReviewLine = {
  id: string;
  description: string;
  amount_cents: number;
  status: string;
  stay_id: string | null;
  horse_id: string | null;
  horse_name: string | null;
  day_count: number;
  first_day: string | null;
  last_day: string | null;
  original: PackageSplit | null;
  effective: PackageSplit | null;
  current: PackageReview | null;
  history: PackageReview[];
};
export type PackageReviewOptions = {
  count: number;
  lines: PackageReviewLine[];
};
export function packageReviewValues(f: FormData) {
  const amount = text(f, "amount_cents", true, 9)!;
  if (!/^\d+$/.test(amount) || Number(amount) > 100000000)
    throw Error("Choose a valid saved charge amount.");
  const feed = cents(f, "feed"),
    board = cents(f, "board");
  return {
    p_request: identifier(f, "request_id", true),
    p_line: identifier(f, "line_id", true),
    p_current: identifier(f, "current"),
    p_horse: identifier(f, "horse_id", true),
    p_stay: identifier(f, "stay_id", true),
    p_amount: Number(amount),
    p_feed: feed,
    p_board: board,
    p_feed_included: feed > 0 || f.get("feed_included") === "on",
    p_board_included: board > 0 || f.get("board_included") === "on",
    p_reason: text(f, "reason", true, 2000),
    p_clear: f.get("clear") === "yes",
  };
}
