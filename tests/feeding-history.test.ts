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

test("history filter input validates inclusive dates, literal phrases and horse identities without accepting repeated parameters", async () => {
  const { feedingHistoryFilters } =
    await import("../src/lib/feeding-history.ts");
  const horse = crypto.randomUUID();
  let f = feedingHistoryFilters({
    history_from: "2024-02-29",
    history_to: "2024-03-01",
    history_horse: horse.toUpperCase(),
    history_q: "  100% _ Rio  ",
  });
  assert.equal(f.error, undefined);
  assert.equal(f.from, "2024-02-29");
  assert.equal(f.horse, horse);
  assert.equal(f.query, "100% _ Rio");
  assert.match(
    feedingHistoryFilters({ history_from: "2026-02-29" }).error!,
    /valid start/,
  );
  assert.match(
    feedingHistoryFilters({
      history_from: "2026-02-01",
      history_to: "2026-01-01",
    }).error!,
    /on or before/,
  );
  assert.match(
    feedingHistoryFilters({ history_horse: "not-a-horse" }).error!,
    /valid horse/,
  );
  assert.match(
    feedingHistoryFilters({ history_q: ["a", "b"] }).error!,
    /one search/,
  );
  assert.match(
    feedingHistoryFilters({ history_q: "x".repeat(101) }).error!,
    /100 characters/,
  );
  assert.match(
    feedingHistoryFilters({ history_before: "bad" }).error!,
    /page date/,
  );
});
test("history navigation retains every active filter and plan context while latest/reset links clear the appropriate cursor", async () => {
  const { feedingHistoryUrl, feedingHistoryFilters } =
    await import("../src/lib/feeding-history.ts");
  const horse = crypto.randomUUID(),
    plan = crypto.randomUUID();
  const filters = feedingHistoryFilters({
    history_from: "2026-01-01",
    history_to: "2026-01-31",
    history_horse: horse,
    history_q: "Rio & 100%_ #1",
  });
  const url = new URL(
    feedingHistoryUrl(filters, "2026-01-15", plan),
    "https://example.test",
  );
  assert.equal(url.searchParams.get("history_q"), filters.query);
  assert.equal(url.searchParams.get("history_horse"), horse);
  assert.equal(url.searchParams.get("history_before"), "2026-01-15");
  assert.equal(url.searchParams.get("horse"), plan);
  assert.equal(url.hash, "#feeding-history");
  const latest = new URL(
    feedingHistoryUrl(filters, undefined, plan),
    "https://example.test",
  );
  assert.equal(latest.searchParams.has("history_before"), false);
  assert.equal(latest.searchParams.get("history_from"), "2026-01-01");
  assert.equal(latest.searchParams.get("history_to"), "2026-01-31");
  assert.equal(latest.searchParams.get("history_horse"), horse);
});
test("feeding history filters the full record set before matching-day pagination, includes corrections and treats search symbols literally", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec("reset role");
    const a = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values('Rio 100%') returning id",
        )
      ).rows[0].id,
      b = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values('Under_score') returning id",
        )
      ).rows[0].id,
      empty = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values('No feeding records') returning id",
        )
      ).rows[0].id;
    const times = (
      await db.query<{ id: string }>(
        "select id from feeding_times order by name",
      )
    ).rows;
    for (let n = 10; n <= 20; n++) {
      const day = `2026-01-${n}`;
      await db.query(
        "insert into feeding_confirmations(horse_id,feeding_date,feeding_time_id,feeding_time_label,created_at) values($1,$2,$3,'Morning','2026-10-30T12:00:00Z')",
        [a, day, times[0].id],
      );
      if (n % 2 === 0)
        await db.query(
          "insert into feeding_confirmations(horse_id,feeding_date,feeding_time_id,feeding_time_label) values($1,$2,$3,'Evening')",
          [b, day, times[1].id],
        );
    }
    for (let n = 1; n <= 8; n++)
      await db.query(
        "insert into feeding_confirmations(horse_id,feeding_date,feeding_time_id,feeding_time_label) values($1,$2,$3,'Evening')",
        [b, `2026-02-0${n}`, times[1].id],
      );
    await db.query(
      "update feeding_confirmations set cancelled_at='2026-10-30T13:00:00Z',cancellation_reason='Double entry %_ correction' where horse_id=$1 and feeding_date='2026-01-12'",
      [a],
    );
    await login(db, adminId);
    const search = async (
      from: string | null = null,
      to: string | null = null,
      horse: string | null = null,
      q: string | null = null,
      before: string | null = null,
    ) =>
      (
        await db.query<{ data: FeedingHistoryData }>(
          "select search_feeding_history($1,$2,$3,$4,$5) data",
          [from, to, horse, q, before],
        )
      ).rows[0].data;
    let r = await search("2026-01-12", "2026-01-18", a);
    assert.equal(r.days.length, 7);
    assert.equal(r.days[0].date, "2026-01-18");
    assert.equal(r.days[6].date, "2026-01-12");
    assert.equal(r.total_records, 7);
    assert.equal(r.total_days, 7);
    assert.equal(r.next_before, null);
    assert.equal(
      r.days[6].confirmations[0].cancellation_reason,
      "Double entry %_ correction",
    );
    assert.ok(
      r.days.every((d) => d.confirmations.every((c) => c.horse_id === a)),
    );
    r = await search(null, null, null, "mOrNiNg");
    assert.equal(r.days[0].date, "2026-01-20");
    assert.equal(r.days.length, 7);
    assert.equal(r.total_records, 11);
    assert.equal(r.next_before, "2026-01-14");
    const older = await search(null, null, null, "morning", r.next_before);
    assert.deepEqual(
      older.days.map((d) => d.date),
      ["2026-01-13", "2026-01-12", "2026-01-11", "2026-01-10"],
    );
    assert.equal(older.next_before, null);
    assert.equal(older.total_records, 11);
    assert.equal((await search(null, null, null, "%")).total_records, 11);
    assert.equal((await search(null, null, null, "_")).total_records, 15);
    assert.equal(
      (await search(null, null, null, "' OR true --")).total_records,
      0,
    );
    r = await search(null, null, null, "double entry");
    assert.equal(r.total_records, 1);
    assert.ok(r.days[0].confirmations[0].cancelled_at);
    assert.equal((await search(null, "2026-01-12", a)).total_records, 3);
    assert.equal((await search(null, null, empty)).total_records, 0);
    assert.equal((await search("2026-02-02")).next_before, null);
    await assert.rejects(search("2026-02-01", "2026-01-01"), /on or before/);
    await assert.rejects(
      search(null, null, null, "x".repeat(101)),
      /100 characters/,
    );
    await assert.rejects(
      search(null, null, crypto.randomUUID()),
      /existing horse/,
    );
    await login(db, outsiderId);
    await assert.rejects(search(), /Administrator/);
    await db.exec("reset role;set role anon");
    await assert.rejects(search(), /permission denied/);
  } finally {
    await db.close();
  }
});
