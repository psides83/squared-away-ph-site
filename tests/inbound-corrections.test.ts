import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("inbound corrections retain history, replace stock atomically without cash, and protect consumed costs", async () => {
  const db = await inventoryDatabase();
  try {
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Opening feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const original = (
      await db.query<{ r: { movement_id: string } }>(
        "select record_stock_movement($1,$2,$3,100,'opening','2020-01-01',300) r",
        [crypto.randomUUID(), product, unit],
      )
    ).rows[0].r.movement_id;
    const request = crypto.randomUUID();
    const correct = (req = request, qty = 200, id = original) =>
      db.query<{ id: string }>(
        "select correct_inventory_inbound($1,$2,$3,$4,500,'Correct count') id",
        [req, id, unit, qty],
      );
    await assert.rejects(correct(crypto.randomUUID(), 0));
    assert.equal(
      (
        await db.query<{ q: string }>(
          "select quantity_oz q from inventory_balances where product_id=$1",
          [product],
        )
      ).rows[0].q,
      "100.000000000000",
    );
    const replacement = (await correct()).rows[0].id;
    assert.equal((await correct()).rows[0].id, replacement);
    await assert.rejects(correct(request, 201), /already used/);
    await assert.rejects(
      correct(crypto.randomUUID()),
      /already been corrected/,
    );
    assert.equal((await db.query("select * from expenses")).rows.length, 0);
    assert.equal(
      (await db.query("select * from inventory_inbound_corrections")).rows
        .length,
      1,
    );
    const balance = (
      await db.query<{ q: string; v: string }>(
        "select quantity_oz q,value_cents v from inventory_balances where product_id=$1",
        [product],
      )
    ).rows[0];
    assert.equal(balance.q, "200.000000000000");
    assert.equal(Number(balance.v), 500);
    const ledger = (
      await db.query<{ q: string; v: string }>(
        "select sum(quantity_delta_oz) q,sum(value_delta_cents) v from inventory_movements where product_id=$1",
        [product],
      )
    ).rows[0];
    assert.equal(Number(ledger.q), 200);
    assert.equal(Number(ledger.v), 500);
    // A corrected entry can itself be corrected, excluding its paired reversal.
    const second = (await correct(crypto.randomUUID(), 150, replacement))
      .rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,10,'waste','2020-01-02',null,null,'Spilled')",
      [crypto.randomUUID(), product, unit],
    );
    await assert.rejects(
      correct(crypto.randomUUID(), 100, second),
      /Stock activity/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from inventory_inbound_corrections")).rows
        .length,
      0,
    );
    await assert.rejects(correct(crypto.randomUUID()), /Administrator/);
    await login(db, adminId);
    await assert.rejects(
      db.query("delete from inventory_inbound_corrections"),
      /permission denied/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(correct(crypto.randomUUID()), /permission denied/);
  } finally {
    await db.close();
  }
});
