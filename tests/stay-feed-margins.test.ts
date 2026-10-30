import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
type Report = {
  rows: {
    stay_id: string;
    cost_cents: number;
    issued_cents: number;
    draft_cents: number;
    package_cents: number;
    adjustment_cents: number;
    feeding_lines: number;
    review_count: number;
    package_review: boolean;
  }[];
  count: number;
  totals: { cost_cents: number; issued_cents: number; draft_cents: number };
  unassigned_cost_cents: number;
  unassigned_revenue_cents: number;
  review_count: number;
};
async function fixture() {
  const db = await inventoryDatabase();
  const c = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Owner') returning id",
    )
  ).rows[0].id;
  const h = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Rio') returning id",
    )
  ).rows[0].id;
  const stay = async (from: string, to: string) =>
    (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,proration) values($1,$2,$3,$4,31000,'calendar_days') returning id",
        [h, c, from, to],
      )
    ).rows[0].id;
  const report = async (from = "2026-01-01", to = "2026-01-31", page = 1) =>
    (
      await db.query<{ r: Report }>("select stay_feed_margins($1,$2,$3) r", [
        from,
        to,
        page,
      ])
    ).rows[0].r;
  const category = (
    await db.query<{ id: string }>(
      "select id from expense_categories where name='Feed'",
    )
  ).rows[0].id;
  const product = (
    await db.query<{ id: string }>(
      "select create_inventory_product('Hay','hay',$1) id",
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
    "select record_stock_movement($1,$2,$3,100,'opening','2026-01-01',51)",
    [crypto.randomUUID(), product, oz],
  );
  const feed = async (day: string) =>
    (
      await db.query<{ id: string }>(
        "select record_stock_movement($1,$2,$3,1,'feeding',$4,null,$5)->>'movement_id' id",
        [crypto.randomUUID(), product, oz, day, h],
      )
    ).rows[0].id;
  const manual = async (
    s: string | null,
    from: string,
    to: string,
    amount = 1001,
  ) => {
    const invoice = crypto.randomUUID(),
      line = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08',$4,$5)",
      [invoice, c, s, from, to],
    );
    await db.query("select add_invoice_line($1,$2,'Manual feed',$3,'feed')", [
      line,
      invoice,
      amount,
    ]);
    if (!s)
      await db.query(
        "select set_invoice_reporting_link($1,$2,$3,null,'Horse only')",
        [crypto.randomUUID(), invoice, h],
      );
    await db.query(
      "select set_manual_feed_period($1,$2,null,$3,$4,$5,$6,$7,'Covered feed',false)",
      [crypto.randomUUID(), line, h, s, amount, from, to],
    );
    return { invoice, line };
  };
  return { db, c, h, stay, report, feed, manual };
}
test("stay feed costs use inclusive feeding dates, preserve fractional horse totals and keep horse-only revenue unassigned", async () => {
  const { db, h, stay, report, feed, manual } = await fixture();
  try {
    const a = await stay("2026-01-02", "2026-01-03"),
      b = await stay("2026-01-05", "2026-01-06");
    const movements = [];
    for (const day of ["01", "02", "03", "04", "05", "06", "07"])
      movements.push(await feed(`2026-01-${day}`));
    await db.query(
      "select record_stock_movement($1,(select product_id from inventory_movements where id=$2),(select unit_id from inventory_movements where id=$2),1,'waste','2026-01-02')",
      [crypto.randomUUID(), movements[0]],
    );
    const m = await manual(null, "2026-01-02", "2026-01-06");
    await db.query("select finalize_invoice($1)", [m.invoice]);
    let r = await report();
    assert.equal(r.count, 2);
    assert.equal(r.rows.find((x) => x.stay_id === a)?.feeding_lines, 2);
    assert.equal(r.rows.find((x) => x.stay_id === b)?.feeding_lines, 2);
    assert.equal(r.unassigned_revenue_cents, 1001);
    assert.equal(r.totals.issued_cents, 0);
    const horse = (
      await db.query<{
        r: { horses: { horse_id: string; cost_cents: number }[] };
      }>("select feed_charge_comparison('2026-01-01','2026-01-31') r")
    ).rows[0].r.horses.find((x) => x.horse_id === h)!;
    assert.equal(
      r.totals.cost_cents + r.unassigned_cost_cents,
      horse.cost_cents,
    );
    assert.equal(horse.cost_cents, 4);
    await db.query("select reverse_stock_consumption($1,'Duplicate')", [
      movements[1],
    ]);
    r = await report();
    assert.equal(r.rows.find((x) => x.stay_id === a)?.feeding_lines, 1);
    // Costs are reporting values, never the purchase or waste amount.
    assert.ok(r.totals.cost_cents + r.unassigned_cost_cents < 10);
    const late = await report("2026-03-01", "2026-03-31");
    assert.equal(late.unassigned_revenue_cents, 0);
    assert.equal(late.count, 0);
  } finally {
    await db.close();
  }
});
test("stay feed uses saved package sources, exact dated adjustments and reviewed manual periods; unknown charges block their stay", async () => {
  const { db, c, h, stay, report, feed, manual } = await fixture();
  try {
    const a = await stay("2026-01-01", "2026-01-03");
    await db.query(
      "update training_stays set feed_billing='included' where id=$1",
      [a],
    );
    for (const d of ["01", "02", "03"]) await feed(`2026-01-${d}`);
    assert.equal((await report()).rows[0].package_review, true);
    await db.query(
      "select set_package_reporting($1,$2,null,10000,0,'Feed portion')",
      [crypto.randomUUID(), a],
    );
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-01-01','2026-01-03')",
      [invoice, c, a],
    );
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-03','worked',null)",
      [a],
    );
    await db.query("select add_calendar_training($1)", [invoice]);
    let r = await report();
    assert.equal(r.rows[0].package_review, false);
    assert.ok(r.rows[0].draft_cents > 0);
    assert.equal(r.rows[0].issued_cents, 0);
    await db.query("select finalize_invoice($1)", [invoice]);
    const adj = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-101,'2026-03-02','Discount')",
      [adj, invoice],
    );
    assert.ok((await report()).rows[0].review_count > 0);
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,101,0,0,'Feed')",
      [crypto.randomUUID(), adj],
    );
    r = await report();
    assert.equal(r.rows[0].adjustment_cents, -101);
    assert.equal(r.rows[0].review_count, 0);
    let sum = 0;
    for (const day of ["01", "02", "03"])
      sum += (await report(`2026-01-${day}`, `2026-01-${day}`)).totals
        .issued_cents;
    assert.equal(sum, r.totals.issued_cents);
    const comparison = (
      await db.query<{ r: { totals: { issued_cents: number } } }>(
        "select feed_charge_comparison('2026-01-01','2026-01-31') r",
      )
    ).rows[0].r;
    assert.equal(r.totals.issued_cents, comparison.totals.issued_cents);
    const m = await manual(a, "2026-01-01", "2026-01-03");
    await db.query("select finalize_invoice($1)", [m.invoice]);
    assert.equal(
      (await report()).totals.issued_cents,
      r.totals.issued_cents + 1001,
    );
    await db.query("reset role");
    await db.query("update invoice_lines set amount_cents=1002 where id=$1", [
      m.line,
    ]);
    assert.ok((await report()).rows[0].review_count > 0);
  } finally {
    await db.close();
  }
});
test("stay feed pagination retains complete totals and denies customers, anonymous access and invalid periods", async () => {
  const { db, stay, report, feed } = await fixture();
  try {
    for (let n = 1; n <= 28; n++)
      await stay(
        `2026-01-${String(n).padStart(2, "0")}`,
        `2026-01-${String(n).padStart(2, "0")}`,
      );
    await feed("2026-01-01");
    const first = await report(),
      second = await report("2026-01-01", "2026-01-31", 2);
    assert.equal(first.count, 28);
    assert.equal(first.rows.length, 25);
    assert.equal(second.rows.length, 3);
    assert.deepEqual(first.totals, second.totals);
    assert.equal(
      new Set([...first.rows, ...second.rows].map((x) => x.stay_id)).size,
      28,
    );
    await assert.rejects(report("2026-01-02", "2026-01-01"), /valid dates/);
    await assert.rejects(report("2026-01-01", "2026-01-31", 0), /valid dates/);
    await login(db, outsiderId);
    await assert.rejects(report(), /Administrator/);
    await assert.rejects(
      db.query("select * from dated_feed_revenue"),
      /permission denied/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(report(), /permission denied/);
  } finally {
    await db.close();
  }
});

test("monthly and actual-cost stay charges reconcile through cost corrections and voided invoices", async () => {
  const { db, c, stay, report, feed } = await fixture();
  try {
    const a = await stay("2026-01-01", "2026-01-03");
    await db.query(
      "update training_stays set feed_billing='separate_monthly',feed_monthly_cents=3101 where id=$1",
      [a],
    );
    const b = await stay("2026-01-05", "2026-01-06");
    await db.query(
      "update training_stays set feed_billing='at_cost' where id=$1",
      [b],
    );
    await feed("2026-01-01");
    const m = await feed("2026-01-05");
    const monthly = crypto.randomUUID(),
      actual = crypto.randomUUID();
    for (const [i, s, from, to] of [
      [monthly, a, "2026-01-01", "2026-01-03"],
      [actual, b, "2026-01-05", "2026-01-06"],
    ])
      await db.query(
        "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08',$4,$5)",
        [i, c, s, from, to],
      );
    await db.query("select add_monthly_service($1,'feed')", [monthly]);
    await db.query("select add_actual_feed($1)", [actual]);
    await db.query("select finalize_invoice($1)", [monthly]);
    await db.query("select finalize_invoice($1)", [actual]);
    let r = await report();
    assert.equal(r.rows.find((x) => x.stay_id === a)?.issued_cents, 300);
    assert.equal(r.rows.find((x) => x.stay_id === b)?.issued_cents, 1);
    const opening = (
      await db.query<{ id: string }>(
        "select id from inventory_movements where kind='opening' and product_id=(select product_id from inventory_movements where id=$1)",
        [m],
      )
    ).rows[0].id;
    await db.query(
      "select revalue_inbound_cost($1,$2,51,151,'Correct feed cost')",
      [crypto.randomUUID(), opening],
    );
    r = await report();
    assert.ok(r.rows.find((x) => x.stay_id === b)!.review_count > 0);
    assert.equal(r.rows.find((x) => x.stay_id === b)?.issued_cents, 1);
    assert.equal(r.totals.cost_cents + r.unassigned_cost_cents, 3);
    await db.query("select void_invoice($1,'Cancel unpaid')", [actual]);
    r = await report();
    assert.equal(r.rows.find((x) => x.stay_id === b)?.issued_cents, 0);
  } finally {
    await db.close();
  }
});
