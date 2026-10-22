import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";

test("bulk daily rations and extra feedings are atomic, repeat-safe, and admin-only", async (t) => {
  const db = await inventoryDatabase();
  try {
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Bulk feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='lb'",
        [product],
      )
    ).rows[0].id;
    const horses = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values ('First'),('Second'),('No ration') returning id",
      )
    ).rows
      .map((h) => h.id)
      .sort();
    // Use UUID order so the shortage happens after at least one successful row.
    await db.query(
      "insert into feed_rations(horse_id,product_id,unit_id,quantity) values ($1,$3,$4,3),($2,$3,$4,4)",
      [horses[0], horses[1], product, unit],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,6,'opening','2026-01-01',600)",
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
    await t.test(
      "daily shortages roll back all confirmations, deductions, and cost",
      async () => {
        const before = await balance();
        await assert.rejects(
          db.query("select confirm_bulk_daily_feeding($1,'2026-01-01')", [
            [horses[0], horses[1]],
          ]),
          /Not enough stock/,
        );
        assert.deepEqual(await balance(), before);
        assert.equal(
          (await db.query("select id from feeding_confirmations")).rows.length,
          0,
        );
        await db.query(
          "select record_stock_movement($1,$2,$3,4,'adjustment_in','2026-01-01',400,null,'More feed')",
          [crypto.randomUUID(), product, unit],
        );
        await db.query("select confirm_bulk_daily_feeding($1,'2026-01-01')", [
          [horses[0], horses[1]],
        ]);
        assert.equal(Number((await balance()).quantity_oz), 48);
        assert.equal(Number((await balance()).value_cents), 300);
        const after = await balance();
        await db.query("select confirm_bulk_daily_feeding($1,'2026-01-01')", [
          [horses[1], horses[0]],
        ]);
        assert.deepEqual(await balance(), after);
        await assert.rejects(
          db.query("select confirm_bulk_daily_feeding($1,'2026-01-02')", [
            [horses[2]],
          ]),
          /active ration/,
        );
        await assert.rejects(
          db.query("select confirm_bulk_daily_feeding($1,'2026-01-02')", [
            [horses[0], horses[0]],
          ]),
          /different horses/,
        );
        await assert.rejects(
          db.query("select confirm_bulk_daily_feeding($1,'2099-01-01')", [
            [horses[0]],
          ]),
          /future date/,
        );
      },
    );
    async function extras(request: string, entries: unknown) {
      return db.query(
        "select record_bulk_extra_feeding($1,$2,$3,'2026-01-01',$4,'Extra feed')",
        [request, product, unit, JSON.stringify(entries)],
      );
    }
    await t.test(
      "extra feeding batches use separate horse quantities and reject changed retries",
      async () => {
        const before = await balance();
        const request = crypto.randomUUID();
        await assert.rejects(
          extras(request, [
            { horse_id: horses[0], quantity: 1 },
            { horse_id: horses[1], quantity: 4 },
          ]),
          /Not enough stock/,
        );
        assert.deepEqual(await balance(), before);
        assert.equal(
          (await db.query("select request_id from feeding_entry_batches")).rows
            .length,
          0,
        );
        const entries = [
          { horse_id: horses[0], quantity: 1 },
          { horse_id: horses[1], quantity: 2 },
        ];
        await extras(request, entries);
        assert.equal(Number((await balance()).quantity_oz), 0);
        assert.equal(Number((await balance()).value_cents), 0);
        await extras(request, [...entries].reverse());
        await assert.rejects(extras(request, [entries[0]]), /already used/);
        await assert.rejects(
          extras(crypto.randomUUID(), [
            { horse_id: horses[0], quantity: 1 },
            { horse_id: horses[0], quantity: 1 },
          ]),
          /only once/,
        );
        await assert.rejects(
          extras(crypto.randomUUID(), [{ horse_id: horses[0], quantity: -1 }]),
          /positive quantity/,
        );
        await assert.rejects(
          extras(crypto.randomUUID(), [
            { horse_id: horses[0], quantity: 0.0000001 },
          ]),
          /six decimal/,
        );
      },
    );
    await t.test(
      "non-admins cannot use either batch operation or read batch records",
      async () => {
        await login(db, outsiderId);
        await assert.rejects(
          db.query("select confirm_bulk_daily_feeding($1,'2026-01-01')", [
            [horses[0]],
          ]),
          /Administrator/,
        );
        await assert.rejects(
          extras(crypto.randomUUID(), [{ horse_id: horses[0], quantity: 1 }]),
          /Administrator/,
        );
        assert.equal(
          (await db.query("select * from feeding_entry_batches")).rows.length,
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});
