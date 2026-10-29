import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  serviceCostValues,
  type ServiceProfitability,
} from "../src/lib/service-profitability.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const category = (
    await db.query<{ id: string }>(
      "select id from expense_categories where name='Boarding / facility'",
    )
  ).rows[0].id;
  const expense = async (amount = 12001, date = "2026-03-10") =>
    (
      await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
        {
          expense_date: date,
          category_id: category,
          amount_cents: amount,
          vendor: "Facility",
          reimbursable: false,
        },
        crypto.randomUUID(),
      ])
    ).rows[0].id;
  const report = async (from = "2026-01-01", to = "2026-01-31") =>
    (
      await db.query<{ r: ServiceProfitability }>(
        "select service_profitability($1,$2) r",
        [from, to],
      )
    ).rows[0].r;
  return { db, category, expense, report };
}
test("reviewed service costs spread exact cents over covered days, reject stale edits and preserve cleared history", async () => {
  const { db, category, expense, report } = await fixture();
  try {
    const e = await expense();
    const request = crypto.randomUUID();
    const set = (
      id: string,
      current: string | null,
      training = 6001,
      clear = false,
    ) =>
      db.query(
        "select set_service_cost_allocation($1,$2,$3,$4,$5,$6,'2026-01-30','2026-02-01','Reviewed',$7)",
        [id, e, current, training, clear ? 0 : 4000, clear ? 0 : 2000, clear],
      );
    await assert.rejects(set(request, null, 6000), /full eligible/);
    await set(request, null);
    await set(request, null);
    assert.deepEqual(
      (await report()).services.map((s) => s.cost_cents),
      [4001, 2667],
    );
    assert.equal((await report()).other_cost_cents, 1334);
    const feb = await report("2026-02-01", "2026-02-28");
    assert.deepEqual(
      feb.services.map((s) => s.cost_cents),
      [2000, 1333],
    );
    assert.equal(feb.other_cost_cents, 666);
    await assert.rejects(set(crypto.randomUUID(), null), /changed/);
    await assert.rejects(set(request, null, 6002), /different values/);
    await db.query("select save_expense($1,$2,$3)", [
      e,
      {
        expense_date: "2026-03-10",
        category_id: category,
        amount_cents: 12002,
        vendor: "Facility",
        reimbursable: false,
      },
      crypto.randomUUID(),
    ]);
    let r = await report();
    assert.equal(r.unallocated_cost_count, 1);
    assert.equal(r.unallocated_cost_cents, 12002);
    assert.equal(r.services[0].cost_cents, 0);
    const revision = crypto.randomUUID();
    await set(revision, request, 6002);
    await set(request, null);
    assert.equal((await report()).services[0].cost_cents, 4002);
    const clear = crypto.randomUUID();
    await set(clear, revision, 0, true);
    assert.equal((await report()).unallocated_cost_count, 1);
    await set(revision, request, 6002);
    assert.equal((await report()).services[0].cost_cents, 0);
    assert.equal(
      (
        await db.query(
          "select id from service_cost_allocations where expense_id=$1",
          [e],
        )
      ).rows.length,
      3,
    );
    await assert.rejects(
      db.query("update service_cost_allocations set training_cents=0"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from service_cost_allocations")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from service_cost_sources")).rows.length,
      0,
    );
    await assert.rejects(report(), /Administrator/);
    await assert.rejects(set(crypto.randomUUID(), clear), /Administrator/);
    await assert.rejects(
      db.query("select * from dated_service_revenue"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("generated package revenues follow service dates and manually allocated adjustments reconcile", async () => {
  const { db, report } = await fixture();
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
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing,proration) values($1,$2,'2026-01-01','2026-01-31',100000,'included','included','calendar_days') returning id",
        [h, c],
      )
    ).rows[0].id;
    await db.query(
      "select set_package_reporting($1,$2,null,20000,30000,'Package')",
      [crypto.randomUUID(), s],
    );
    const i = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-31')",
      [i, c, s],
    );
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-31','worked',null)",
      [s],
    );
    await db.query("select add_calendar_training($1)", [i]);
    assert.deepEqual(
      (await report()).services.map((s) => s.draft_cents),
      [50000, 30000],
    );
    await db.query("select finalize_invoice($1)", [i]);
    assert.deepEqual(
      (await report()).services.map((s) => s.gross_cents),
      [50000, 30000],
    );
    assert.equal(
      (await report("2026-02-01", "2026-02-28")).services[0].gross_cents,
      0,
    );
    const a = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-101,'2026-03-10','Discount')",
      [a, i],
    );
    assert.equal((await report()).unresolved_adjustment_count, 1);
    await db.query(
      "select set_adjustment_reporting($1,$2,null,61,0,40,0,'Split discount')",
      [crypto.randomUUID(), a],
    );
    assert.deepEqual(
      (await report()).services.map((s) => s.adjustment_cents),
      [-61, -40],
    );
    assert.equal((await report()).unresolved_adjustment_count, 0);
    const first = await report("2026-01-01", "2026-01-15"),
      second = await report("2026-01-16", "2026-01-31");
    for (let n = 0; n < 2; n++) {
      assert.equal(
        first.services[n].gross_cents + second.services[n].gross_cents,
        (await report()).services[n].gross_cents,
      );
      assert.equal(
        first.services[n].adjustment_cents +
          second.services[n].adjustment_cents,
        (await report()).services[n].adjustment_cents,
      );
    }
    await db.query("select void_invoice($1,'Correction')", [i]);
    assert.equal((await report()).services[0].gross_cents, 0);
  } finally {
    await db.close();
  }
});
test("cost input requires exact money, source identity and a reason", () => {
  const f = new FormData();
  f.set("request_id", crypto.randomUUID());
  f.set("expense_id", crypto.randomUUID());
  f.set("training", "60.01");
  f.set("board", "40");
  f.set("other", "20");
  f.set("from", "2026-01-30");
  f.set("to", "2026-02-01");
  f.set("reason", "Reviewed");
  assert.equal(serviceCostValues(f).p_training, 6001);
  f.set("training", "1.001");
  assert.throws(() => serviceCostValues(f));
  f.set("clear", "yes");
  assert.equal(serviceCostValues(f).p_training, 0);
  f.set("reason", "");
  assert.throws(() => serviceCostValues(f));
});
test("actual and monthly board use saved coverage, unpaid costs count once and manual revenue stays flagged", async () => {
  const { db, category, report } = await fixture();
  try {
    const c = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Owner') returning id",
      )
    ).rows[0].id;
    async function stay(mode: string) {
      const h = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values($1) returning id",
          [mode],
        )
      ).rows[0].id;
      const s = (
        await db.query<{ id: string }>(
          "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,boarding_billing,boarding_monthly_cents) values($1,$2,'2026-01-01','2026-01-31',0,$3,$4) returning id",
          [h, c, mode, mode === "separate_monthly" ? 3100 : null],
        )
      ).rows[0].id;
      return { h, s };
    }
    const actual = await stay("at_cost");
    const expense = (
      await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
        {
          expense_date: "2026-01-02",
          horse_id: actual.h,
          category_id: category,
          amount_cents: 1001,
          vendor: "Board",
          reimbursable: false,
        },
        crypto.randomUUID(),
      ])
    ).rows[0].id;
    const split = crypto.randomUUID();
    await db.query("select save_cost_stay_split($1,$2,null,$3,$4,'Reviewed')", [
      split,
      expense,
      actual.h,
      [{ stay_id: actual.s, amount_cents: 1001 }],
    ]);
    const i = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-03')",
      [i, c, actual.s],
    );
    await db.query("select add_actual_boarding($1,$2)", [i, split]);
    await db.query("select finalize_invoice($1)", [i]);
    await db.query(
      "select set_service_cost_allocation($1,$2,null,0,1001,0,'2026-01-01','2026-01-03','Covered board',false)",
      [crypto.randomUUID(), expense],
    );
    assert.equal((await report()).services[1].gross_cents, 1001);
    assert.equal((await report()).services[1].cost_cents, 1001);
    const days = [];
    for (const d of ["2026-01-01", "2026-01-02", "2026-01-03"])
      days.push((await report(d, d)).services[1].gross_cents);
    assert.deepEqual(days, [334, 334, 333]);
    const monthly = await stay("separate_monthly");
    const m = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-31')",
      [m, c, monthly.s],
    );
    await db.query("select add_monthly_service($1,'boarding')", [m]);
    await db.query("select finalize_invoice($1)", [m]);
    assert.equal((await report()).services[1].gross_cents, 4101);
    const legacy = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2026-01-02','2026-01-09',null,null)",
      [legacy, c],
    );
    await db.query(
      "select add_invoice_line($1,$2,'Manual board',100,'boarding')",
      [crypto.randomUUID(), legacy],
    );
    await db.query("select finalize_invoice($1)", [legacy]);
    assert.equal((await report()).unsupported_revenue_count, 1);
  } finally {
    await db.close();
  }
});
test("inventory purchases are excluded and mixed receipt allocations cannot exceed expense-only items", async () => {
  const { db, category, report } = await fixture();
  try {
    const p = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const u = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [p],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,10,'purchase','2026-01-02',1000)",
      [crypto.randomUUID(), p, u],
    );
    assert.equal((await report()).unallocated_cost_count, 0);
    const id = crypto.randomUUID();
    await db.query("select record_receipt_purchase($1,$2,$3)", [
      id,
      {
        expense_date: "2026-01-02",
        paid_on: null,
        category_id: category,
        vendor: "Store",
        notes: null,
        total_cents: 1501,
        discount_cents: 0,
        tax_cents: 0,
      },
      [
        {
          id: crypto.randomUUID(),
          kind: "inventory",
          description: "Feed",
          product_id: p,
          unit_id: u,
          quantity: "10",
          subtotal_cents: 1000,
          discount_cents: 0,
          tax_cents: 0,
        },
        {
          id: crypto.randomUUID(),
          kind: "expense",
          description: "Supplies",
          product_id: null,
          unit_id: null,
          quantity: null,
          subtotal_cents: 501,
          discount_cents: 0,
          tax_cents: 0,
        },
      ],
    ]);
    assert.equal((await report()).unallocated_cost_cents, 501);
    const req = crypto.randomUUID();
    await assert.rejects(
      db.query(
        "select set_service_cost_allocation($1,$2,null,1000,0,501,'2026-01-01','2026-01-03','Invalid',false)",
        [req, id],
      ),
      /full eligible/,
    );
    await db.query(
      "select set_service_cost_allocation($1,$2,null,0,500,1,'2026-01-01','2026-01-03','Supplies',false)",
      [req, id],
    );
    assert.equal((await report()).services[1].cost_cents, 500);
    assert.equal((await report()).other_cost_cents, 1);
    assert.equal((await report()).unallocated_cost_count, 0);
    await assert.rejects(
      db.query("select service_profitability('2026-02-01','2026-01-01')"),
      /valid dates/,
    );
  } finally {
    await db.close();
  }
});
