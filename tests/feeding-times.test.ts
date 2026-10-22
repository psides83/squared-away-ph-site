import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { feedingTimeLabel } from "../src/lib/feeding-times.ts";

test("feeding time labels support optional clock times", () => {
  assert.equal(
    feedingTimeLabel({ name: "Morning", time_of_day: null }),
    "Morning",
  );
  assert.equal(
    feedingTimeLabel({ name: "Night check", time_of_day: "00:30:00" }),
    "Night check · 12:30 AM",
  );
  assert.equal(
    feedingTimeLabel({ name: "Lunch", time_of_day: "12:00:00" }),
    "Lunch · 12:00 PM",
  );
});

test("scheduled rations isolate morning, evening, custom times, costs, and bulk retries", async (t) => {
  const db = await inventoryDatabase();
  try {
    const times = (
      await db.query<{ id: string; name: string }>(
        "select id,name from feeding_times",
      )
    ).rows;
    const am = times.find((t) => t.name === "Morning")!.id,
      pm = times.find((t) => t.name === "Evening")!.id;
    const noon = (
      await db.query<{ id: string }>(
        "insert into feeding_times(name,time_of_day,sort_order) values('Lunch','12:00',15) returning id",
      )
    ).rows[0].id;
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const horses = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('First'),('Second') returning id",
      )
    ).rows
      .map((r) => r.id)
      .sort();
    async function ration(
      horse: string,
      time: string | null,
      qty: number,
      active = true,
    ) {
      return db.query(
        "insert into feed_rations(horse_id,product_id,unit_id,feeding_time_id,quantity,active) values($1,$2,$3,$4,$5,$6)",
        [horse, product, unit, time, qty, active],
      );
    }
    await ration(horses[0], am, 2);
    await ration(horses[0], pm, 1);
    await ration(horses[0], noon, 0.5);
    await ration(horses[1], am, 4);
    await db.query(
      "select record_stock_movement($1,$2,$3,5,'opening','2026-01-01',500)",
      [crypto.randomUUID(), product, unit],
    );
    async function balance() {
      return (
        await db.query<{ quantity_oz: string; value_cents: string }>(
          "select quantity_oz,value_cents from inventory_balances where product_id=$1",
          [product],
        )
      ).rows[0];
    }
    async function confirm(horse: string, time: string, date = "2026-01-01") {
      return db.query("select confirm_scheduled_feeding($1,$2,$3)", [
        horse,
        date,
        time,
      ]);
    }
    await t.test(
      "same product may occur at different times but not twice in one ration",
      async () => {
        await assert.rejects(ration(horses[0], am, 1), /unique/);
        assert.equal(
          (
            await db.query("select id from feed_rations where horse_id=$1", [
              horses[0],
            ])
          ).rows.length,
          3,
        );
        await assert.rejects(
          db.query("update feeding_times set archived=true where id=$1", [am]),
          /Move or pause/,
        );
      },
    );
    await t.test(
      "bulk shortage rolls back every horse and only the selected feeding time is consumed",
      async () => {
        const before = await balance();
        await assert.rejects(
          db.query(
            "select confirm_bulk_scheduled_feeding($1,'2026-01-01',$2)",
            [horses, am],
          ),
          /Not enough stock/,
        );
        assert.deepEqual(await balance(), before);
        assert.equal(
          (await db.query("select id from feeding_confirmations")).rows.length,
          0,
        );
        await db.query(
          "select record_stock_movement($1,$2,$3,5,'adjustment_in','2026-01-01',500,null,'More feed')",
          [crypto.randomUUID(), product, unit],
        );
        await db.query(
          "select confirm_bulk_scheduled_feeding($1,'2026-01-01',$2)",
          [horses, am],
        );
        assert.equal(Number((await balance()).quantity_oz), 4);
        assert.equal(Number((await balance()).value_cents), 400);
        await confirm(horses[0], am);
        assert.equal(Number((await balance()).quantity_oz), 4);
        await confirm(horses[0], pm);
        await confirm(horses[0], noon);
        assert.equal(Number((await balance()).quantity_oz), 2.5);
        assert.equal(Number((await balance()).value_cents), 250);
        assert.equal(
          (
            await db.query(
              "select id from feeding_confirmations where horse_id=$1",
              [horses[0]],
            )
          ).rows.length,
          3,
        );
        await assert.rejects(
          db.query("select confirm_daily_feeding($1,'2026-01-01')", [
            horses[0],
          ]),
          /Choose a feeding time/,
        );
      },
    );
    await t.test(
      "renames retain historical labels and extras retain time in their batch identity",
      async () => {
        await db.query(
          "update feeding_times set name='Breakfast' where id=$1",
          [am],
        );
        assert.equal(
          (
            await db.query<{ feeding_time_label: string }>(
              "select feeding_time_label from feeding_confirmations where feeding_time_id=$1 limit 1",
              [am],
            )
          ).rows[0].feeding_time_label,
          "Morning",
        );
        assert.equal(
          (
            await db.query<{ feeding_time_label: string }>(
              "select feeding_time_label from inventory_movements where feeding_time_id=$1 limit 1",
              [am],
            )
          ).rows[0].feeding_time_label,
          "Morning",
        );
        const request = crypto.randomUUID(),
          entries = JSON.stringify([{ horse_id: horses[0], quantity: 1 }]);
        const extra = (time: string) =>
          db.query(
            "select record_bulk_extra_feeding($1,$2,$3,'2026-01-01',$4,null,$5)",
            [request, product, unit, entries, time],
          );
        await extra(noon);
        await extra(noon);
        assert.equal(Number((await balance()).quantity_oz), 1.5);
        await assert.rejects(extra(pm), /already used/);
        await db.query(
          "update feed_rations set active=false where feeding_time_id=$1",
          [noon],
        );
        await db.query("update feeding_times set archived=true where id=$1", [
          noon,
        ]);
        await confirm(horses[0], noon); // Historical retry remains safe after archiving.
        await assert.rejects(
          confirm(horses[0], noon, "2026-01-02"),
          /active feeding time/,
        );
        await assert.rejects(
          db.query(
            "update feed_rations set active=true where feeding_time_id=$1",
            [noon],
          ),
          /active feeding time/,
        );
      },
    );
    await t.test(
      "non-admins cannot view or edit times or confirm timed feedings",
      async () => {
        await login(db, outsiderId);
        assert.equal(
          (await db.query("select * from feeding_times")).rows.length,
          0,
        );
        await assert.rejects(
          db.query("insert into feeding_times(name) values('Unauthorized')"),
          /row-level security/,
        );
        await assert.rejects(confirm(horses[0], pm), /Administrator/);
        await assert.rejects(
          db.query(
            "select confirm_bulk_scheduled_feeding($1,'2026-01-01',$2)",
            [horses, am],
          ),
          /Administrator/,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test("migrating daily totals preserves history and prevents full-day/timed double deductions", async () => {
  const db = await inventoryDatabase("20261021001700_bulk_feeding.sql");
  try {
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Legacy') returning id",
      )
    ).rows[0].id;
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Legacy feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    await db.query(
      "insert into feed_rations(horse_id,product_id,unit_id,quantity) values($1,$2,$3,2)",
      [horse, product, unit],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,20,'opening','2026-01-01',200)",
      [crypto.randomUUID(), product, unit],
    );
    await db.query("select confirm_daily_feeding($1,'2026-01-01')", [horse]);
    const before = (
      await db.query<Record<string, unknown>>(
        "select * from inventory_movements order by created_at,id",
      )
    ).rows;
    await db.exec("reset role");
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261021001800_feeding_times.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(
      (
        await db.query<{ feeding_time_id: string | null }>(
          "select feeding_time_id from feed_rations",
        )
      ).rows[0].feeding_time_id,
      null,
    );
    const after = (
      await db.query<Record<string, unknown>>(
        "select * from inventory_movements order by created_at,id",
      )
    ).rows.map(({ feeding_time_id, feeding_time_label, ...old }) => old);
    assert.deepEqual(after, before);
    const am = (
      await db.query<{ id: string }>(
        "select id from feeding_times where name='Morning'",
      )
    ).rows[0].id;
    await assert.rejects(
      db.query("select confirm_scheduled_feeding($1,'2026-01-02',$2)", [
        horse,
        am,
      ]),
      /Assign all active daily totals/,
    );
    await db.query("update feed_rations set feeding_time_id=$1", [am]);
    await assert.rejects(
      db.query("select confirm_scheduled_feeding($1,'2026-01-01',$2)", [
        horse,
        am,
      ]),
      /full-day feeding was already confirmed/,
    );
    await db.query("select confirm_scheduled_feeding($1,'2026-01-02',$2)", [
      horse,
      am,
    ]);
    assert.equal(
      Number(
        (
          await db.query<{ quantity_oz: string }>(
            "select quantity_oz from inventory_balances where product_id=$1",
            [product],
          )
        ).rows[0].quantity_oz,
      ),
      16,
    );
  } finally {
    await db.close();
  }
});
