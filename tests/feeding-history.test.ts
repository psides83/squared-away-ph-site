import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  groupFeedingHistory,
  type FeedingHistoryEntry,
  type FeedingHistoryData,
} from "../src/lib/feeding-history.ts";
test("feeding history groups time slots chronologically and separates corrected confirmations", () => {
  const row = (
    id: string,
    time: string | null,
    name: string,
    cancelled = false,
  ): FeedingHistoryEntry => ({
    id,
    horse_id: id,
    horse_name: name,
    feeding_time_id: time,
    feeding_time_label: time,
    created_at: "2026-10-23T12:00:00Z",
    cancelled_at: cancelled ? "2026-10-23T13:00:00Z" : null,
    cancellation_reason: cancelled ? "Mistake" : null,
  });
  const groups = groupFeedingHistory(
    [
      row("a", "evening", "Rio"),
      row("b", "morning", "Zebra"),
      row("c", "morning", "June"),
      row("d", "morning", "Rio", true),
      row("e", null, "Legacy"),
    ],
    [
      { id: "evening", time_of_day: "18:00" },
      { id: "morning", time_of_day: "07:00" },
    ],
  );
  assert.deepEqual(
    groups.map((g) => g.id),
    ["morning", "evening", "legacy"],
  );
  assert.deepEqual(
    groups[0].active.map((c) => c.horse_name),
    ["June", "Zebra"],
  );
  assert.equal(groups[0].corrections.length, 1);
  assert.equal(groups[2].label, "Full-day feeding (legacy)");
});
test("feeding history returns complete days beyond fifty rows, pages without splitting days and protects privacy", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec("reset role");
    const timeIds = (
      await db.query<{ id: string }>(
        "select id from feeding_times order by name",
      )
    ).rows.map((r) => r.id);
    await db.query("insert into feeding_times(name) values('Midday')");
    timeIds.push(
      (
        await db.query<{ id: string }>(
          "select id from feeding_times where name='Midday'",
        )
      ).rows[0].id,
    );
    const horses = Array.from({ length: 20 }, () => crypto.randomUUID());
    for (const [i, id] of horses.entries()) {
      await db.query("insert into horses(id,barn_name) values($1,$2)", [
        id,
        `Horse ${i}`,
      ]);
      for (const time of timeIds)
        await db.query(
          "insert into feeding_confirmations(horse_id,feeding_date,feeding_time_id,feeding_time_label) values($1,'2026-10-23',$2,'Saved time name')",
          [id, time],
        );
    }
    await db.query(
      "update feeding_confirmations set cancelled_at=now(),cancellation_reason='Mistake' where horse_id=$1",
      [horses[0]],
    );
    for (let day = 15; day < 23; day++)
      await db.query(
        "insert into feeding_confirmations(horse_id,feeding_date) values($1,$2)",
        [horses[0], `2026-10-${day}`],
      );
    await login(db, adminId);
    const history = async (before: string | null = null) =>
      (
        await db.query<{ data: FeedingHistoryData }>(
          "select feeding_confirmation_history($1) data",
          [before],
        )
      ).rows[0].data;
    const first = await history();
    assert.equal(first.days.length, 7);
    assert.equal(first.days[0].date, "2026-10-23");
    assert.equal(first.days[0].confirmations.length, 60);
    assert.equal(
      first.days[0].confirmations.filter((c) => c.cancelled_at).length,
      3,
    );
    assert.equal(first.next_before, "2026-10-17");
    const second = await history(first.next_before);
    assert.deepEqual(
      second.days.map((d) => d.date),
      ["2026-10-16", "2026-10-15"],
    );
    assert.equal(second.next_before, null);
    assert.deepEqual((await history("2020-01-01")).days, []);
    await login(db, outsiderId);
    await assert.rejects(history(), /Administrator/);
  } finally {
    await db.close();
  }
});
