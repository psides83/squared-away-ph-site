import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("undo feeding restores stock once, retains history and permits a fresh confirmation", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec("reset role");
    const horse = crypto.randomUUID();
    await db.query("insert into horses(id,barn_name) values($1,'Undo horse')", [
      horse,
    ]);
    await login(db, adminId);
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Undo feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const time = (
      await db.query<{ id: string }>(
        "select id from feeding_times order by sort_order limit 1",
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'opening','2020-01-01',1000)",
      [crypto.randomUUID(), product, unit],
    );
    await db.query(
      "insert into feed_rations(horse_id,product_id,unit_id,quantity,feeding_time_id) values($1,$2,$3,10,$4)",
      [horse, product, unit, time],
    );
    const confirm = async () =>
      (
        await db.query<{ id: string }>(
          "select confirm_scheduled_feeding($1,'2020-01-02',$2) id",
          [horse, time],
        )
      ).rows[0].id;
    const qty = async () =>
      (
        await db.query<{ q: string }>(
          "select quantity_oz::text q from inventory_balances where product_id=$1",
          [product],
        )
      ).rows[0].q;
    const first = await confirm();
    assert.equal(await confirm(), first);
    assert.equal(Number(await qty()), 90);
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select undo_feeding_confirmation($1,'Mistake')", [first]),
      /Administrator/,
    );
    await login(db, adminId);
    await assert.rejects(
      db.query("select undo_feeding_confirmation($1,'')", [first]),
      /reason/,
    );
    await db.query("select undo_feeding_confirmation($1,'Not actually fed')", [
      first,
    ]);
    assert.equal(Number(await qty()), 100);
    await db.query("select undo_feeding_confirmation($1,'Retry')", [first]);
    assert.equal(Number(await qty()), 100);
    const second = await confirm();
    assert.notEqual(second, first);
    assert.equal(Number(await qty()), 90);
    await db.query("select undo_feeding_confirmation($1,'Late retry')", [
      first,
    ]);
    assert.equal(Number(await qty()), 90);
    const history = (
      await db.query<{ cancelled: boolean; reason: string }>(
        "select cancelled_at is not null cancelled,cancellation_reason reason from feeding_confirmations where id=$1",
        [first],
      )
    ).rows[0];
    assert.equal(history.cancelled, true);
    assert.equal(history.reason, "Not actually fed");
  } finally {
    await db.close();
  }
});
