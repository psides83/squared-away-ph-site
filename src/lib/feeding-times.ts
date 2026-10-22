export type FeedingTime = {
  id: string;
  name: string;
  time_of_day: string | null;
  sort_order: number;
  archived: boolean;
};
export function feedingTimeLabel(
  time: Pick<FeedingTime, "name" | "time_of_day">,
) {
  if (!time.time_of_day) return time.name;
  const [hour, minute] = time.time_of_day.split(":");
  return `${time.name} · ${Number(hour) % 12 || 12}:${minute} ${Number(hour) < 12 ? "AM" : "PM"}`;
}
