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
  total_days?: number;
  total_records?: number;
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

export type FeedingHistoryFilters = {
  from: string;
  to: string;
  horse: string;
  query: string;
  before?: string;
  error?: string;
};
export function feedingHistoryFilters(params: {
  history_from?: unknown;
  history_to?: unknown;
  history_horse?: unknown;
  history_q?: unknown;
  history_before?: unknown;
}): FeedingHistoryFilters {
  const errors: string[] = [];
  function date(value: unknown, label: string) {
    if (value === undefined || value === "") return "";
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    ) {
      errors.push(`Choose a valid ${label}.`);
      return "";
    }
    return value;
  }
  const from = date(params.history_from, "start date"),
    to = date(params.history_to, "end date"),
    before = date(params.history_before, "history page date");
  let horse = "";
  if (params.history_horse !== undefined && params.history_horse !== "") {
    if (
      typeof params.history_horse !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        params.history_horse,
      )
    )
      errors.push("Choose a valid horse.");
    else horse = params.history_horse.toLowerCase();
  }
  let query = "";
  if (params.history_q !== undefined) {
    if (typeof params.history_q !== "string")
      errors.push("Enter one search phrase.");
    else {
      query = params.history_q.trim();
      if (query.length > 100) {
        errors.push("Search must be 100 characters or fewer.");
        query = query.slice(0, 100);
      }
    }
  }
  if (from && to && from > to)
    errors.push("The start date must be on or before the end date.");
  return {
    from,
    to,
    horse,
    query,
    before: before || undefined,
    error: errors.length ? errors.join(" ") : undefined,
  };
}
export function feedingHistoryUrl(
  filters: FeedingHistoryFilters,
  before?: string,
  planHorse?: string,
) {
  const p = new URLSearchParams();
  if (filters.from) p.set("history_from", filters.from);
  if (filters.to) p.set("history_to", filters.to);
  if (filters.horse) p.set("history_horse", filters.horse);
  if (filters.query) p.set("history_q", filters.query);
  if (before) p.set("history_before", before);
  if (planHorse) p.set("horse", planHorse);
  return `/admin/feeding${p.size ? `?${p}` : ""}#feeding-history`;
}
