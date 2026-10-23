import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  parseRidingDays,
  ridingDayIndex,
  ridingPlanLabel,
} from "../src/lib/riding-schedule.ts";
test("weekly riding plans validate seven explicit days and use calendar weekdays", () => {
  assert.equal(ridingDayIndex("2026-10-19"), 0);
  assert.equal(ridingDayIndex("2026-10-25"), 6);
  const days = parseRidingDays(
    '["training","training","off","training","training","off","off"]',
  );
  assert.equal(days.length, 7);
  assert.throws(() => parseRidingDays('["training"]'));
  assert.throws(() => parseRidingDays("[null,null,null,null,null,null,null]"));
  assert.throws(() => parseRidingDays("null"));
  assert.equal(ridingPlanLabel(null, "2026-10-19"), "No riding plan");
  assert.equal(
    ridingPlanLabel(
      { horse_id: "test", days, notes: null, version: "v", updated_at: "" },
      "2026-10-25",
    ),
    "Planned off day",
  );
});
test("riding plans save atomically, protect stale forms, remain private and never create actual work or billing", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec("reset role");
    const horse = crypto.randomUUID();
    await db.query(
      "insert into horses(id,barn_name) values($1,'Weekly horse')",
      [horse],
    );
    await login(db, adminId);
    const days = [
      "training",
      "training",
      "training",
      "training",
      "training",
      "off",
      "off",
    ];
    const save = async (expected: string | null, value: unknown = days) =>
      (
        await db.query<{ v: string }>(
          "select save_horse_riding_schedule($1,$2,$3::jsonb,'Work on collection') v",
          [horse, expected, JSON.stringify(value)],
        )
      ).rows[0].v;
    const first = await save(null);
    await assert.rejects(save(null), /changed/);
    await assert.rejects(save(first, ["off"]), /seven/);
    await assert.rejects(save(first, {}), /seven/);
    await assert.rejects(
      save(first, ["off", "off", "off", "off", "off", "off", null]),
      /seven/,
    );
    const row = (
      await db.query<{ version: string }>(
        "select version from horse_riding_schedules where horse_id=$1",
        [horse],
      )
    ).rows[0];
    assert.equal(row.version, first);
    const second = await save(first, Array(7).fill("off"));
    assert.notEqual(second, first);
    await assert.rejects(save(first), /changed/);
    const cleared = (
      await db.query<{ v: string }>(
        "select save_horse_riding_schedule($1,$2,null,null) v",
        [horse, second],
      )
    ).rows[0].v;
    assert.equal(
      (
        await db.query<{ days: null }>(
          "select days from horse_riding_schedules where horse_id=$1",
          [horse],
        )
      ).rows[0].days,
      null,
    );
    await assert.rejects(save(null), /changed/);
    await save(cleared);
    assert.equal(
      (await db.query("select * from training_entries")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from inventory_movements")).rows.length,
      0,
    );
    const count = (
      await db.query<{ n: number }>(
        "select count(*)::integer n from training_days",
      )
    ).rows[0].n;
    assert.equal(count, 0);
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from horse_riding_schedules")).rows.length,
      0,
    );
    await assert.rejects(save(null), /Administrator/);
    await login(db, adminId);
    await assert.rejects(
      db.query("update horse_riding_schedules set notes='Bypass'"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
