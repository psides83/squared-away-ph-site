export type FeedingHistoryEntry = {
  id: string;
  horse_id: string;
  horse_name: string;
  feeding_time_id: string | null;
  feeding_time_label: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};
export type FeedingHistoryData = {
  days: { date: string; confirmations: FeedingHistoryEntry[] }[];
  next_before: string | null;
};
export function groupFeedingHistory(
  entries: FeedingHistoryEntry[],
  times: { id: string; time_of_day: string | null }[],
) {
  const groups = new Map<
    string,
    {
      id: string;
      label: string;
      clock: string | null;
      active: FeedingHistoryEntry[];
      corrections: FeedingHistoryEntry[];
    }
  >();
  for (const entry of entries) {
    const key = entry.feeding_time_id ?? "legacy";
    let group = groups.get(key);
    if (!group) {
      group = {
        id: key,
        label: entry.feeding_time_label ?? "Full-day feeding (legacy)",
        clock:
          times.find((t) => t.id === entry.feeding_time_id)?.time_of_day ??
          null,
        active: [],
        corrections: [],
      };
      groups.set(key, group);
    }
    (entry.cancelled_at ? group.corrections : group.active).push(entry);
  }
  for (const group of groups.values()) {
    group.active.sort(
      (a, b) =>
        a.horse_name.localeCompare(b.horse_name) || a.id.localeCompare(b.id),
    );
  }
  return [...groups.values()].sort((a, b) =>
    a.clock === b.clock
      ? a.label.localeCompare(b.label) || a.id.localeCompare(b.id)
      : a.clock === null
        ? 1
        : b.clock === null
          ? -1
          : a.clock.localeCompare(b.clock),
  );
}
