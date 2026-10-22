export type ReminderBucket = "overdue" | "today" | "upcoming" | "completed";
export const reminderBuckets: ReminderBucket[] = [
  "overdue",
  "today",
  "upcoming",
  "completed",
];
export const reminderBucketLabels: Record<ReminderBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  completed: "Completed",
};
export function reminderStatus(
  reminder: { completed_at: string | null; due_date: string },
  today: string,
): ReminderBucket {
  if (reminder.completed_at) return "completed";
  return reminder.due_date < today
    ? "overdue"
    : reminder.due_date === today
      ? "today"
      : "upcoming";
}
export function reminderMoveDate(today: string, days: 1 | 7) {
  return new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
