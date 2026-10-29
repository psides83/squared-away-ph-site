import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
type Comparison = {
  horses: {
    horse_id: string;
    issued_cents: number;
    draft_cents: number;
    package_cents: number;
    adjustment_cents: number;
    cost_cents: number;
    difference_cents: number;
    included: boolean;
    has_adjustments: boolean;
    has_unmatched: boolean;
  }[];
  totals: {
    issued_cents: number;
    package_cents: number;
    adjustment_cents: number;
  };
};
test("package feed follows service dates, manually assigned discounts reconcile every cent and stale agreements never restate charges", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Owner') returning id",
      )
    ).rows[0].id;
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Package horse') returning id",
      )
    ).rows[0].id;
    const stay = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing,proration) values($1,$2,'2026-01-01','2026-01-03',100000,'included','included','calendar_days') returning id",
        [horse, customer],
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
    const oz = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'opening','2026-01-01',10000)",
      [crypto.randomUUID(), product, oz],
    );
    for (const day of ["2026-01-01", "2026-01-02", "2026-01-03"])
      await db.query(
        "select record_stock_movement($1,$2,$3,1,'feeding',$4,null,$5)",
        [crypto.randomUUID(), product, oz, day, horse],
      );
    const plan = crypto.randomUUID();
    await db.query(
      "select set_package_reporting($1,$2,null,20000,30000,'Package')",
      [plan, stay],
    );
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-03')",
      [invoice, customer, stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-03','worked',null)",
      [stay],
    );
    await db.query("select add_calendar_training($1)", [invoice]);
    async function report(from = "2026-01-01", to = "2026-01-03") {
      return (
        await db.query<{ r: Comparison }>(
          "select feed_charge_comparison($1,$2) r",
          [from, to],
        )
      ).rows[0].r;
    }
    assert.equal((await report()).horses[0].draft_cents, 1935);
    assert.equal((await report()).horses[0].issued_cents, 0);
    await db.query("select finalize_invoice($1)", [invoice]);
    let r = (await report()).horses[0];
    assert.equal(r.package_cents, 1935);
    assert.equal(r.included, false);
    assert.equal(r.cost_cents, 300);
    assert.equal(r.difference_cents, 1635);
    const adjustment = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-101,'2026-03-01','Feed discount')",
      [adjustment, invoice],
    );
    assert.equal((await report()).horses[0].has_adjustments, true);
    const allocation = crypto.randomUUID();
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,101,0,0,'All feed')",
      [allocation, adjustment],
    );
    r = (await report()).horses[0];
    assert.equal(r.issued_cents, 1834);
    assert.equal(r.adjustment_cents, -101);
    assert.equal(r.has_adjustments, false);
    assert.equal(r.difference_cents, 1534);
    let sliced = 0;
    const amounts = [];
    for (const day of ["2026-01-01", "2026-01-02", "2026-01-03"]) {
      const slice = (await report(day, day)).horses[0];
      sliced += slice.issued_cents;
      amounts.push(slice.adjustment_cents);
    }
    assert.equal(sliced, 1834);
    assert.deepEqual(amounts, [-34, -34, -33]);
    assert.equal(
      (await report("2026-02-01", "2026-03-31")).totals.issued_cents,
      0,
    );
    await db.query(
      "select set_package_reporting($1,$2,$3,10000,10000,'Later plan')",
      [crypto.randomUUID(), stay, plan],
    );
    assert.equal((await report()).totals.package_cents, 1935);
    // A reviewed zero-feed allocation clears the blocker without assigning an adjustment to feed.
    await db.query(
      "select set_adjustment_reporting($1,$2,$3,101,0,0,0,'Training instead')",
      [crypto.randomUUID(), adjustment, allocation],
    );
    assert.equal((await report()).horses[0].has_adjustments, false);
    assert.equal((await report()).totals.issued_cents, 1935);
    const excess = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-2000,'2026-03-02','Feed reduction')",
      [excess, invoice],
    );
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,2000,0,0,'Feed reduction')",
      [crypto.randomUUID(), excess],
    );
    assert.equal((await report()).totals.issued_cents, -65);
    await db.query("select void_invoice($1,'Test void')", [invoice]);
    assert.equal((await report()).totals.issued_cents, 0);
    await login(db, outsiderId);
    await assert.rejects(report(), /Administrator/);
  } finally {
    await db.close();
  }
});
test("separately billed monthly feed uses explicit allocations and unsupported manual feed lines block adjustment dating", async () => {
  const db = await inventoryDatabase();
  try {
    const c = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Owner') returning id",
      )
    ).rows[0].id;
    const h = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Horse') returning id",
      )
    ).rows[0].id;
    const s = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,feed_monthly_cents) values($1,$2,'2026-01-01','2026-01-31',0,'separate_monthly',3100) returning id",
        [h, c],
      )
    ).rows[0].id;
    const i = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-31')",
      [i, c, s],
    );
    await db.query("select add_monthly_service($1,'feed')", [i]);
    await db.query("select finalize_invoice($1)", [i]);
    const a = crypto.randomUUID();
    await db.query("select adjust_invoice($1,$2,31,'2026-03-01','Increase')", [
      a,
      i,
    ]);
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,31,0,0,'Feed')",
      [crypto.randomUUID(), a],
    );
    const report = async () =>
      (
        await db.query<{ r: Comparison }>(
          "select feed_charge_comparison('2026-01-01','2026-01-31') r",
        )
      ).rows[0].r;
    assert.equal((await report()).totals.issued_cents, 3131);
    assert.equal((await report()).horses[0].has_adjustments, false);
    // Model an older unsupported source on another finalized invoice through the public manual-line operation.
    const other = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-31')",
      [other, c, s],
    );
    await db.query("select add_invoice_line($1,$2,'Manual feed',100,'feed')", [
      crypto.randomUUID(),
      other,
    ]);
    await db.query("select finalize_invoice($1)", [other]);
    const second = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-10,'2026-03-01','Manual feed discount')",
      [second, other],
    );
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,10,0,0,'Feed')",
      [crypto.randomUUID(), second],
    );
    assert.equal((await report()).horses[0].has_unmatched, true);
    assert.equal((await report()).totals.adjustment_cents, 31);
  } finally {
    await db.close();
  }
});
test("saving a package plan after invoicing does not invent historical feed revenue", async () => {
  const db = await inventoryDatabase();
  try {
    const c = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Owner') returning id",
      )
    ).rows[0].id;
    const h = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Horse') returning id",
      )
    ).rows[0].id;
    const s = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,proration) values($1,$2,'2026-01-01','2026-01-01',100000,'included','calendar_days') returning id",
        [h, c],
      )
    ).rows[0].id;
    const i = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-01')",
      [i, c, s],
    );
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-01','worked',null)",
      [s],
    );
    await db.query("select add_calendar_training($1)", [i]);
    await db.query("select finalize_invoice($1)", [i]);
    await db.query(
      "select set_package_reporting($1,$2,null,20000,0,'Later plan')",
      [crypto.randomUUID(), s],
    );
    const r = (
      await db.query<{ r: Comparison }>(
        "select feed_charge_comparison('2026-01-01','2026-01-01') r",
      )
    ).rows[0].r;
    assert.equal(r.horses[0].included, true);
    assert.equal(r.totals.package_cents, 0);
    assert.equal(r.totals.issued_cents, 0);
  } finally {
    await db.close();
  }
});
test("zero-valued feed sources reconcile adjustment pennies, while board-only packages cannot invent feed dates", async () => {
  const db = await inventoryDatabase();
  try {
    const c = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Owner') returning id",
      )
    ).rows[0].id;
    for (const mode of ["included", "not_provided"]) {
      const h = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values($1) returning id",
          [mode],
        )
      ).rows[0].id;
      const s = (
        await db.query<{ id: string }>(
          "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing,proration) values($1,$2,'2026-01-01','2026-01-03',31,$3,'included','calendar_days') returning id",
          [h, c, mode],
        )
      ).rows[0].id;
      await db.query(
        "select set_package_reporting($1,$2,null,0,1,'Zero feed')",
        [crypto.randomUUID(), s],
      );
      const i = crypto.randomUUID();
      await db.query(
        "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-03')",
        [i, c, s],
      );
      await db.query(
        "select set_training_days($1,'2026-01-01','2026-01-03','worked',null)",
        [s],
      );
      await db.query("select add_calendar_training($1)", [i]);
      await db.query("select finalize_invoice($1)", [i]);
      const a = crypto.randomUUID();
      await db.query(
        "select adjust_invoice($1,$2,2,'2026-03-01','Feed increase')",
        [a, i],
      );
      await db.query(
        "select set_adjustment_reporting($1,$2,null,0,2,0,0,'Feed')",
        [crypto.randomUUID(), a],
      );
      const r = (
        await db.query<{ r: Comparison }>(
          "select feed_charge_comparison('2026-01-01','2026-01-03') r",
        )
      ).rows[0].r.horses.find((row) => row.horse_id === h)!;
      assert.equal(r.adjustment_cents, mode === "included" ? 2 : 0);
      assert.equal(r.has_adjustments, mode !== "included");
    }
    const totals = [];
    for (const day of ["2026-01-01", "2026-01-02", "2026-01-03"])
      totals.push(
        (
          await db.query<{ r: Comparison }>(
            "select feed_charge_comparison($1,$1) r",
            [day],
          )
        ).rows[0].r.totals.adjustment_cents,
      );
    assert.deepEqual(totals, [1, 1, 0]);
  } finally {
    await db.close();
  }
});
