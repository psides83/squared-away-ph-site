import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedRecovery } from "../src/lib/return-expectations.ts";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("expected recovery distinguishes unknown, zero, overdue, fulfilled and cancelled targets", () => {
  assert.deepEqual(expectedRecovery(null, 500, null, "2020-02-01"), {
    remaining: null,
    excess: 0,
    overdue: false,
  });
  assert.deepEqual(expectedRecovery(0, 0, null, "2020-02-01"), {
    remaining: 0,
    excess: 0,
    overdue: false,
  });
  assert.equal(
    expectedRecovery(1000, 200, "2020-01-31", "2020-02-01").overdue,
    true,
  );
  assert.equal(
    expectedRecovery(1000, 200, "2020-02-01", "2020-02-01").overdue,
    false,
  );
  assert.equal(
    expectedRecovery(1000, 200, "2020-01-31", "2020-02-01", true).overdue,
    false,
  );
  assert.deepEqual(expectedRecovery(1000, 1200, "2020-01-31", "2020-02-01"), {
    remaining: 0,
    excess: 200,
    overdue: false,
  });
});
test("return expectations retain versioned history without changing stock or cash; active recovery totals follow reversals", async () => {
  const db = await inventoryDatabase();
  try {
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Expected feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-01',10000,null,'Purchase','Store','2020-01-01')",
      [crypto.randomUUID(), product, unit],
    );
    const ret = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,10,'2020-02-01','Store','Return')",
      [ret, product, unit],
    );
    const save = (
      expected: string | null,
      version: string,
      cash: number | null = 800,
      credit: number | null = 200,
    ) =>
      db.query(
        "select save_supplier_return_expectations($1,$2,$3,$4,$5,$6,$7,'Agreement')",
        [
          ret,
          expected,
          version,
          cash,
          cash ? "2020-02-05" : null,
          credit,
          credit ? "2020-02-06" : null,
        ],
      );
    const v1 = crypto.randomUUID();
    await save(null, v1);
    await save(null, v1);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from supplier_return_expectation_history",
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(save(null, crypto.randomUUID()), /changed since/);
    await assert.rejects(save(v1, v1, 900), /already saved/);
    const v2 = crypto.randomUUID();
    await save(v1, v2, null, 0);
    await save(null, v1); // Late retry never restores an older target.
    assert.equal(
      (
        await db.query<{ version: string }>(
          "select version from supplier_return_expectations",
        )
      ).rows[0].version,
      v2,
    );
    await assert.rejects(
      db.query(
        "select save_supplier_return_expectations($1,$2,$3,null,'2020-02-01',null,null,null)",
        [ret, v2, crypto.randomUUID()],
      ),
      /due dates require/,
    );
    const refund = crypto.randomUUID();
    await db.query(
      "select record_supplier_refund($1,$2,300,'2020-02-02',null,null)",
      [refund, ret],
    );
    const credit = crypto.randomUUID();
    await db.query(
      "select issue_supplier_credit($1,'Store','2020-02-02',200,null,'Credit',$2)",
      [credit, ret],
    );
    const overview = async () =>
      (
        await db.query<{
          r: {
            rows: {
              refunded_cents: number;
              supplier_credit_cents: number;
              expectation: { version: string };
            }[];
          };
        }>("select supplier_return_overview(1,$1,1) r", [ret])
      ).rows[0].r.rows[0];
    assert.equal((await overview()).expectation.version, v2);
    assert.equal((await overview()).refunded_cents, 300);
    assert.equal((await overview()).supplier_credit_cents, 200);
    await db.query("select reverse_supplier_refund($1,'Mistake')", [refund]);
    await db.query("select cancel_supplier_credit($1,'Mistake')", [credit]);
    assert.equal((await overview()).refunded_cents, 0);
    assert.equal((await overview()).supplier_credit_cents, 0);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from inventory_movements where product_id=$1",
          [product],
        )
      ).rows[0].n,
      2,
    );
    await db.query("select cancel_supplier_return($1,'Mistaken return')", [
      ret,
    ]);
    await assert.rejects(save(v2, crypto.randomUUID()), /active return/);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from supplier_return_expectation_history",
        )
      ).rows[0].n,
      2,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from supplier_return_expectations")).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select * from supplier_return_expectation_history")).rows
        .length,
      0,
    );
    await assert.rejects(save(v2, crypto.randomUUID()), /Administrator/);
  } finally {
    await db.close();
  }
});
