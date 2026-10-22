import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("inventory usage retains weighted costs and separates feeding, waste, corrections, and cash purchases", async () => {
  const db = await inventoryDatabase();
  try {
    const day = (
      await db.query<{ value: string }>(
        "select ((now() at time zone 'America/Chicago')::date)::text as value",
      )
    ).rows[0].value;
    const horses = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Own horse'),('Training horse') returning id",
      )
    ).rows;
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Supplement','supplement',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    async function movement(
      kind: string,
      qty: number,
      date: string,
      cost: number | null = null,
      horse: string | null = null,
    ) {
      await db.query(
        "select record_stock_movement($1,$2,$3,$4,$5,$6,$7,$8,'Inventory entry')",
        [crypto.randomUUID(), product, unit, qty, kind, date, cost, horse],
      );
    }
    await movement("opening", 10, "2026-01-01", 1000);
    await movement("feeding", 2, "2026-01-02", null, horses[0].id);
    await movement("waste", 1, "2026-01-02");
    await movement("purchase", 10, "2026-01-03", 3000);
    await movement("feeding", 1, "2026-01-04", null, horses[1].id);
    await movement("adjustment_out", 1, "2026-01-04");
    type Report = {
      totals: {
        feed_cents: number;
        waste_cents: number;
        adjustment_cents: number;
        correction_cents: number;
      };
      products: { feed_oz: number; feed_cents: number }[];
      horses: {
        horse_id: string;
        feed_cents: number;
        feeding_lines: number;
        corrected_lines: number;
      }[];
    };
    async function report(from: string, to: string) {
      return (
        await db.query<{ result: Report }>(
          "select inventory_usage_report($1,$2) result",
          [from, to],
        )
      ).rows[0].result;
    }
    const initial = await report("2026-01-01", "2026-01-04");
    assert.equal(initial.products.length, 1);
    assert.equal(Number(initial.products[0].feed_oz), 3);
    assert.equal(
      Number(
        initial.horses.find((h) => h.horse_id === horses[0].id)!.feed_cents,
      ),
      200,
    );
    assert.equal(Number(initial.totals.waste_cents), 100);
    assert.ok(Number(initial.totals.adjustment_cents) > 217);
    assert.ok(
      Math.abs(Number(initial.totals.feed_cents) - (200 + 3700 / 17)) < 0.00001,
    );
    const feed = (
      await db.query<{ id: string }>(
        "select id from inventory_movements where kind='feeding' and horse_id=$1",
        [horses[0].id],
      )
    ).rows[0].id;
    await db.query(
      "select reverse_stock_consumption($1,'Recorded by mistake')",
      [feed],
    );
    const historical = await report("2026-01-01", "2026-01-04");
    assert.equal(
      Number(historical.totals.feed_cents),
      Number(initial.totals.feed_cents),
    );
    const correction = await report(day, day);
    assert.equal(Number(correction.totals.feed_cents), -200);
    assert.equal(Number(correction.totals.correction_cents), 200);
    assert.equal(Number(correction.products[0].feed_oz), -2);
    const all = await report("2026-01-01", day);
    const own = all.horses.find((h) => h.horse_id === horses[0].id)!;
    assert.equal(Number(own.feed_cents), 0);
    assert.equal(Number(own.corrected_lines), 1);
    assert.equal(Number(own.feeding_lines), 1);
    const empty = await report("2025-01-01", "2025-01-01");
    assert.deepEqual(empty.products, []);
    assert.equal(Number(empty.totals.feed_cents), 0);
    await assert.rejects(report("2026-02-01", "2026-01-01"), /valid date/);
    await assert.rejects(report("2000-01-01", day), /ten years/);
    await login(db, outsiderId);
    await assert.rejects(report("2026-01-01", day), /Administrator/);
  } finally {
    await db.close();
  }
});
