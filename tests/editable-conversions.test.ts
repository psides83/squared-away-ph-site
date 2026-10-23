import { conversionWeightText } from "../src/lib/weight-units.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("editable conversion names and weights affect future entries while preserving snapshots, rations, and stock", async () => {
  const db = await inventoryDatabase();
  try {
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
    const units = (
      await db.query<{ id: string; label: string }>(
        "select id,label from inventory_units where product_id=$1",
        [product],
      )
    ).rows;
    const g = units.find((u) => u.label === "g")!.id,
      lb = units.find((u) => u.label === "lb")!.id,
      oz = units.find((u) => u.label === "oz")!.id;
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Ration horse') returning id",
      )
    ).rows[0].id;
    const time = (
      await db.query<{ id: string }>(
        "select id from feeding_times where name='Morning'",
      )
    ).rows[0].id;
    await db.query(
      "insert into feed_rations(horse_id,product_id,unit_id,quantity,feeding_time_id) values($1,$2,$3,2,$4)",
      [horse, product, g, time],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,10,'opening','2026-01-01',10000)",
      [crypto.randomUUID(), product, lb],
    );
    const original = crypto.randomUUID();
    await db.query(
      "select record_stock_movement($1,$2,$3,2,'feeding','2026-01-01',null,$4)",
      [original, product, g, horse],
    );
    const before = (
      await db.query<{ quantity_delta_oz: string; unit_label: string }>(
        "select * from inventory_movements where request_id=$1",
        [original],
      )
    ).rows[0];
    await db.query(
      "select record_stock_movement($1,$2,$3,2,'feeding','2026-01-01',null,$4)",
      [original, product, g, horse],
    );
    assert.equal(
      (
        await db.query(
          "select id from inventory_movements where request_id=$1",
          [original],
        )
      ).rows.length,
      1,
    );
    const balance = (
      await db.query(
        "select quantity_oz,value_cents from inventory_balances where product_id=$1",
        [product],
      )
    ).rows[0];
    await db.query(
      "update inventory_units set label='Small Measure' where id=$1",
      [g],
    );
    assert.equal(
      (
        await db.query<{ metric_basis: string }>(
          "select metric_basis from inventory_units where id=$1",
          [g],
        )
      ).rows[0].metric_basis,
      "g",
    );
    const renamed = crypto.randomUUID();
    await db.query(
      "select record_stock_movement($1,$2,$3,2,'feeding','2026-01-01',null,$4)",
      [renamed, product, g, horse],
    );
    const renamedMove = (
      await db.query<{ quantity_delta_oz: string; unit_label: string }>(
        "select * from inventory_movements where request_id=$1",
        [renamed],
      )
    ).rows[0];
    assert.equal(renamedMove.quantity_delta_oz, before.quantity_delta_oz);
    assert.equal(renamedMove.unit_label, "Small Measure");
    const unchanged = (
      await db.query(
        "select quantity_oz,value_cents from inventory_balances where product_id=$1",
        [product],
      )
    ).rows[0];
    await db.query(
      "update inventory_units set label='g',ounces_per_unit=2,metric_basis='kg' where id=$1",
      [g],
    );
    assert.equal(
      (
        await db.query<{ metric_basis: null }>(
          "select metric_basis from inventory_units where id=$1",
          [g],
        )
      ).rows[0].metric_basis,
      null,
    );
    assert.deepEqual(
      (
        await db.query(
          "select quantity_oz,value_cents from inventory_balances where product_id=$1",
          [product],
        )
      ).rows[0],
      unchanged,
    );
    assert.deepEqual(
      (
        await db.query(
          "select * from inventory_movements where request_id=$1",
          [original],
        )
      ).rows[0],
      before,
    );
    await db.query("select confirm_scheduled_feeding($1,'2026-01-02',$2)", [
      horse,
      time,
    ]);
    const scheduled = (
      await db.query<{
        id: string;
        quantity_delta_oz: string;
        unit_label: string;
        ounces_per_unit: string;
      }>(
        "select * from inventory_movements where product_id=$1 and movement_date='2026-01-02'",
        [product],
      )
    ).rows[0];
    assert.equal(Number(scheduled.quantity_delta_oz), -4);
    assert.equal(scheduled.unit_label, "g");
    assert.equal(Number(scheduled.ounces_per_unit), 2);
    await db.query(
      "update inventory_units set label='Gram-sized scoop',ounces_per_unit=3 where id=$1",
      [g],
    );
    await db.query("select reverse_stock_consumption($1,'Correct feeding')", [
      scheduled.id,
    ]);
    assert.deepEqual(
      (
        await db.query(
          "select quantity_oz,value_cents from inventory_balances where product_id=$1",
          [product],
        )
      ).rows[0],
      unchanged,
    );
    assert.equal(
      (
        await db.query<{ unit_id: string }>(
          "select unit_id from feed_rations where horse_id=$1",
          [horse],
        )
      ).rows[0].unit_id,
      g,
    );
    await db.query(
      "update inventory_units set label='Big pound',ounces_per_unit=17 where id=$1",
      [lb],
    );
    await db.query(
      "update inventory_units set label='oz',ounces_per_unit=2 where id=$1",
      [oz],
    );
    const renamedOz = crypto.randomUUID();
    await db.query(
      "select record_stock_movement($1,$2,$3,2,'adjustment_in','2026-01-03',100,null,'New weight')",
      [renamedOz, product, oz],
    );
    assert.equal(
      Number(
        (
          await db.query<{ quantity_delta_oz: string }>(
            "select quantity_delta_oz from inventory_movements where request_id=$1",
            [renamedOz],
          )
        ).rows[0].quantity_delta_oz,
      ),
      4,
    );
    assert.notDeepEqual(balance, unchanged);
    await assert.rejects(
      db.query(
        "insert into inventory_units(product_id,label,ounces_per_unit) values($1,'BIG POUND',2)",
        [product],
      ),
    );
    await assert.rejects(
      db.query("update inventory_units set label=' ' where id=$1", [g]),
    );
    await assert.rejects(
      db.query("update inventory_units set ounces_per_unit=0 where id=$1", [g]),
    );
    await assert.rejects(
      db.query("update inventory_units set ounces_per_unit=-1 where id=$1", [
        g,
      ]),
    );
    const other = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Other','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query("update inventory_units set product_id=$1 where id=$2", [
        other,
        g,
      ]),
    );
    await login(db, outsiderId);
    assert.equal(
      (
        await db.query(
          "update inventory_units set label='Unauthorized' where id=$1 returning id",
          [g],
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into inventory_units(product_id,label,ounces_per_unit) values($1,'Unauthorized',1)",
        [product],
      ),
    );
  } finally {
    await db.close();
  }
});
test("untouched metric reference units keep exact cross-unit depletion after renaming", async () => {
  const db = await inventoryDatabase();
  try {
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Metric','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const units = (
      await db.query<{ id: string; label: string }>(
        "select id,label from inventory_units where product_id=$1",
        [product],
      )
    ).rows;
    const kg = units.find((u) => u.label === "kg")!.id,
      g = units.find((u) => u.label === "g")!.id;
    await db.query(
      "update inventory_units set label='Kilogram package' where id=$1",
      [kg],
    );
    await db.query(
      "update inventory_units set label='Gram portion' where id=$1",
      [g],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'opening','2026-01-01',500)",
      [crypto.randomUUID(), product, kg],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,1000,'waste','2026-01-01')",
      [crypto.randomUUID(), product, g],
    );
    const balance = (
      await db.query<{ quantity_oz: string; value_cents: string }>(
        "select * from inventory_balances where product_id=$1",
        [product],
      )
    ).rows[0];
    assert.equal(Number(balance.quantity_oz), 0);
    assert.equal(Number(balance.value_cents), 0);
  } finally {
    await db.close();
  }
});

test("conversion editors preserve exact decimal weights without padded zeroes", () => {
  assert.equal(conversionWeightText("32.000000000000"), "32");
  assert.equal(conversionWeightText("0.035273961950"), "0.03527396195");
  assert.equal(
    conversionWeightText("35273.961949580413"),
    "35273.961949580413",
  );
  assert.equal(conversionWeightText(0.000000000001), "0.000000000001");
});
