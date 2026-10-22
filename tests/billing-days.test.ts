import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthDates,
  summarizeDays,
  stayServiceValues,
  trainingDayValues,
} from "../src/lib/billing-days.ts";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";

test("calendar includes only elapsed physical-stay days and never treats unmarked days as billable", () => {
  const dates = monthDates("2028-02", "2028-02-27", null, "2028-02-29");
  assert.deepEqual(dates, ["2028-02-27", "2028-02-28", "2028-02-29"]);
  assert.deepEqual(
    monthDates("2028-03", "2028-02-27", "2028-02-29", "2028-03-15"),
    [],
  );
  assert.deepEqual(
    summarizeDays(dates, [
      { day: "2028-02-27", status: "worked" },
      { day: "2028-02-28", status: "rest" },
      { day: "2028-03-01", status: "worked" },
    ]),
    { worked: 1, rest: 1, nonbillable: 0, unmarked: 1, billable: 2 },
  );
  assert.throws(() => monthDates("2028-13", "2028-01-01", null, "2028-12-31"));
});
test("per-stay service agreements preserve zero rates and require a price only for separate monthly billing", () => {
  const form = new FormData();
  form.set("feed_billing", "included");
  form.set("boarding_billing", "separate_monthly");
  form.set("boarding_monthly_rate", "0");
  assert.deepEqual(stayServiceValues(form), {
    feed_billing: "included",
    feed_monthly_cents: null,
    boarding_billing: "separate_monthly",
    boarding_monthly_cents: 0,
  });
  form.set("boarding_monthly_rate", "");
  assert.throws(() => stayServiceValues(form));
  form.set("boarding_billing", "at_cost");
  assert.equal(stayServiceValues(form).boarding_monthly_cents, null);
  const days = new FormData();
  days.set("stay_id", "10000000-0000-4000-8000-000000000001");
  days.set("from", "2026-01-03");
  days.set("to", "2026-01-01");
  days.set("status", "worked");
  assert.throws(() => trainingDayValues(days));
});
test("billing-day changes are explicit, bounded, audited, retry-safe, and private", async (t) => {
  const db = await inventoryDatabase();
  try {
    const horse = (
      await db.query<{ id: string }>(
        "insert into public.horses(barn_name) values('Calendar horse') returning id",
      )
    ).rows[0].id;
    const customer = (
      await db.query<{ id: string }>(
        "insert into public.customers(name) values('Owner') returning id",
      )
    ).rows[0].id;
    const stay = (
      await db.query<{ id: string }>(
        "insert into public.training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,'2026-01-01','2026-01-10',150000) returning id",
        [horse, customer],
      )
    ).rows[0].id;
    const mark = async (
      from: string,
      to: string,
      status: string,
      notes: string | null = null,
    ) =>
      db.query<{ changes: number }>(
        "select public.set_training_days($1,$2,$3,$4,$5) as changes",
        [stay, from, to, status, notes],
      );
    await t.test(
      "marking work/rest is one row per day and does not depend on session count",
      async () => {
        assert.deepEqual(
          (await mark("2026-01-01", "2026-01-02", "worked")).rows,
          [{ changes: 2 }],
        );
        assert.deepEqual(
          (await mark("2026-01-01", "2026-01-02", "worked")).rows,
          [{ changes: 0 }],
        );
        await mark(
          "2026-01-03",
          "2026-01-04",
          "rest",
          "Rest between worked days",
        );
        await mark("2026-01-05", "2026-01-05", "nonbillable", "Not worked");
        await db.query(
          "insert into public.training_entries(horse_id,kind,entry_date,title,notes) values($1,'session','2026-01-01','First ride','Work'),($1,'session','2026-01-01','Second ride','Work')",
          [horse],
        );
        const days = await db.query<{ day: string; status: string }>(
          "select day::text,status from public.training_days where stay_id=$1",
          [stay],
        );
        const summary = summarizeDays(
          monthDates("2026-01", "2026-01-01", "2026-01-10", "2026-10-21"),
          days.rows,
        );
        assert.equal(summary.billable, 4);
        assert.equal(summary.unmarked, 5);
      },
    );
    await t.test(
      "corrections and clearing retain history while redundant retries add no events",
      async () => {
        await mark("2026-01-01", "2026-01-01", "nonbillable", "Correction");
        await mark("2026-01-02", "2026-01-02", "clear", "Needs review");
        const count = (
          await db.query("select count(*) from public.training_day_events")
        ).rows;
        await mark("2026-01-02", "2026-01-02", "clear", "Retry");
        assert.deepEqual(
          (await db.query("select count(*) from public.training_day_events"))
            .rows,
          count,
        );
        const history = await db.query(
          "select previous_status,new_status,notes from public.training_day_events where stay_id=$1 and day='2026-01-02' and new_status is null",
          [stay],
        );
        assert.deepEqual(history.rows, [
          {
            previous_status: "worked",
            new_status: null,
            notes: "Needs review",
          },
        ]);
      },
    );
    await t.test(
      "out-of-stay ranges, future dates, and invalid classifications cannot partially change records",
      async () => {
        const before = (
          await db.query("select * from public.training_days order by day")
        ).rows;
        await assert.rejects(
          mark("2025-12-31", "2026-01-03", "worked"),
          /within/,
        );
        await assert.rejects(
          mark("2026-01-01", "2026-01-11", "worked"),
          /within/,
        );
        await assert.rejects(
          mark("2999-01-01", "2999-01-02", "worked"),
          /future/,
        );
        await assert.rejects(
          mark("2026-01-01", "2026-01-01", "automatic"),
          /valid day status/,
        );
        assert.deepEqual(
          (await db.query("select * from public.training_days order by day"))
            .rows,
          before,
        );
        await assert.rejects(
          db.query(
            "update public.training_stays set departure_date='2026-01-02' where id=$1",
            [stay],
          ),
          /outside/,
        );
        const horse2 = (
          await db.query<{ id: string }>(
            "insert into public.horses(barn_name) values('Another horse') returning id",
          )
        ).rows[0].id;
        await assert.rejects(
          db.query("update public.training_stays set horse_id=$1 where id=$2", [
            horse2,
            stay,
          ]),
          /reassigning/,
        );
        await assert.rejects(
          db.query("delete from public.training_stays where id=$1", [stay]),
          /foreign key/,
        );
      },
    );
    await t.test(
      "feed/board rates are stored per stay and checked against their charge mode",
      async () => {
        await db.query(
          "update public.training_stays set feed_billing='included',boarding_billing='separate_monthly',boarding_monthly_cents=45000 where id=$1",
          [stay],
        );
        assert.deepEqual(
          (
            await db.query(
              "select feed_billing,boarding_monthly_cents from public.training_stays where id=$1",
              [stay],
            )
          ).rows,
          [{ feed_billing: "included", boarding_monthly_cents: 45000 }],
        );
        await assert.rejects(
          db.query(
            "update public.training_stays set feed_billing='separate_monthly' where id=$1",
            [stay],
          ),
          /check constraint/,
        );
        await assert.rejects(
          db.query(
            "update public.training_stays set boarding_billing='included' where id=$1",
            [stay],
          ),
          /check constraint/,
        );
      },
    );
    await t.test(
      "clients cannot bypass the day function or edit audit history; non-admin access is denied",
      async () => {
        await assert.rejects(
          db.query("delete from public.training_day_events"),
          /permission denied/,
        );
        await assert.rejects(
          db.query(
            "insert into public.training_days(stay_id,day,status) values($1,'2026-01-09','worked')",
            [stay],
          ),
          /permission denied/,
        );
        await login(db, outsiderId);
        assert.deepEqual(
          (await db.query("select * from public.training_days")).rows,
          [],
        );
        assert.deepEqual(
          (await db.query("select * from public.training_day_events")).rows,
          [],
        );
        await assert.rejects(
          mark("2026-01-01", "2026-01-01", "worked"),
          /Administrator access required/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
