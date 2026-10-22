import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inventoryDatabase } from "./helpers/inventory-database.ts";
import { weightInOunces, weightUnits } from "../src/lib/weight-units.ts";

test("measured serving weights support metric units without floating point drift", () => {
  assert.equal(weightInOunces("250", "g"), "8.818490487395");
  assert.equal(weightInOunces("1", "mg"), "0.000035273962");
  assert.equal(weightInOunces("2.5", "lb"), "40.000000000000");
  assert.equal(weightInOunces("1", "ton"), "32000.000000000000");
  for (const value of ["0", "-1", "1e3", "NaN", "1.0000000000001"])
    assert.throws(() => weightInOunces(value, "g"));
  assert.throws(() => weightInOunces("1", "cup"));
});

test("metric migration preserves old units and stock; new products receive fixed weights", async () => {
  const db = await inventoryDatabase("20261021001500_horse_files.sql");
  try {
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
    const old = (
      await db.query<{ id: string }>(
        "insert into inventory_units(product_id,label,ounces_per_unit) values($1,'g',2) returning id",
        [product],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'opening','2026-01-01',100)",
      [crypto.randomUUID(), product, old],
    );
    await db.exec("reset role");
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261021001600_metric_weight_units.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const legacy = (
      await db.query<{ label: string; ounces_per_unit: string }>(
        "select label,ounces_per_unit from inventory_units where id=$1",
        [old],
      )
    ).rows[0];
    assert.match(legacy.label, /^legacy-/);
    assert.equal(Number(legacy.ounces_per_unit), 2);
    const snapshot = (
      await db.query<{ unit_label: string; quantity_delta_oz: string }>(
        "select unit_label,quantity_delta_oz from inventory_movements where product_id=$1",
        [product],
      )
    ).rows[0];
    assert.equal(snapshot.unit_label, "g");
    assert.equal(Number(snapshot.quantity_delta_oz), 2);
    const newProduct = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Metric supplement','supplement',$1) id",
        [category],
      )
    ).rows[0].id;
    const units = (
      await db.query<{ id: string; label: string; ounces_per_unit: string }>(
        "select * from inventory_units where product_id=$1",
        [newProduct],
      )
    ).rows;
    assert.equal(units.length, weightUnits.length);
    for (const unit of weightUnits)
      assert.equal(
        Number(units.find((u) => u.label === unit.label)!.ounces_per_unit),
        Number(unit.ounces),
      );
    const mg = units.find((u) => u.label === "mg")!.id;
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'opening','2026-01-01',100)",
      [crypto.randomUUID(), newProduct, mg],
    );
    assert.equal(
      (
        await db.query<{ quantity_oz: string }>(
          "select quantity_oz from inventory_balances where product_id=$1",
          [newProduct],
        )
      ).rows[0].quantity_oz,
      "0.000035273962",
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'waste','2026-01-01')",
      [crypto.randomUUID(), newProduct, mg],
    );
    const balance = (
      await db.query<{ quantity_oz: string; value_cents: string }>(
        "select * from inventory_balances where product_id=$1",
        [newProduct],
      )
    ).rows[0];
    assert.equal(Number(balance.quantity_oz), 0);
    assert.equal(Number(balance.value_cents), 0);
    const kg = units.find((u) => u.label === "kg")!.id;
    const g = units.find((u) => u.label === "g")!.id;
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'adjustment_in','2026-01-01',250,null,'Metric stock')",
      [crypto.randomUUID(), newProduct, kg],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,1000,'waste','2026-01-01')",
      [crypto.randomUUID(), newProduct, g],
    );
    const empty = (
      await db.query<{ quantity_oz: string; value_cents: string }>(
        "select * from inventory_balances where product_id=$1",
        [newProduct],
      )
    ).rows[0];
    assert.equal(Number(empty.quantity_oz), 0);
    assert.equal(Number(empty.value_cents), 0);
    await assert.rejects(
      db.query("update inventory_units set ounces_per_unit=2 where id=$1", [
        mg,
      ]),
      /fixed/,
    );
    await assert.rejects(
      db.query("delete from inventory_units where id=$1", [mg]),
      /fixed/,
    );
  } finally {
    await db.close();
  }
});
