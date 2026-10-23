import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
type Queue = {
  as_of: string;
  total: number;
  summary: {
    cash_remaining_cents: number;
    credit_remaining_cents: number;
    outstanding_count: number;
    overdue_count: number;
    unset_count: number;
    active_count: number;
  };
  rows: {
    id: string;
    cash_remaining_cents: number | null;
    credit_remaining_cents: number | null;
    overdue: boolean;
    unset: boolean;
  }[];
};
test("supplier follow-up totals cover all active returns, preserve unknown targets, follow actual recovery and paginate without duplicates", async () => {
  const db = await inventoryDatabase();
  try {
    const dates = (
      await db.query<{ today: string; yesterday: string; tomorrow: string }>(
        "select ((now() at time zone 'America/Chicago')::date)::text today, ((now() at time zone 'America/Chicago')::date-1)::text yesterday,((now() at time zone 'America/Chicago')::date+1)::text tomorrow",
      )
    ).rows[0];
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Recovery feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const purchase = (
      await db.query<{ r: { expense_id: string } }>(
        "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-01',10000,null,'Purchase','Store',null) r",
        [crypto.randomUUID(), product, unit],
      )
    ).rows[0].r.expense_id;
    const ids: string[] = [];
    for (let n = 0; n < 31; n++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await db.query(
        "select record_supplier_return($1,$2,$3,1,'2020-02-01','Store','Return')",
        [id, product, unit],
      );
      if (n === 3) continue;
      const cash = n === 4 || n === 5 ? 0 : 1000,
        credit = n === 0 || n === 6 || n === 7 ? 2000 : n === 4 ? null : 0;
      await db.query(
        "select save_supplier_return_expectations($1,null,$2,$3,$4,$5,$6,null)",
        [
          id,
          crypto.randomUUID(),
          cash,
          cash === 0 || n === 2
            ? null
            : n === 1
              ? dates.today
              : dates.yesterday,
          credit,
          credit ? (n === 0 ? dates.tomorrow : dates.yesterday) : null,
        ],
      );
    }
    await db.query("select cancel_supplier_return($1,'Mistake')", [ids[7]]);
    const partial = crypto.randomUUID();
    await db.query("select record_supplier_refund($1,$2,400,$3,null,null)", [
      partial,
      ids[0],
      dates.today,
    ]);
    const full = crypto.randomUUID();
    await db.query("select record_supplier_refund($1,$2,1000,$3,null,null)", [
      full,
      ids[6],
      dates.today,
    ]);
    const credit = crypto.randomUUID();
    await db.query(
      "select issue_supplier_credit($1,'Store',$2,2500,null,'Issued credit',$3)",
      [credit, dates.today, ids[6]],
    );
    const queue = async (filter = "outstanding", page = 1) =>
      (
        await db.query<{ r: Queue }>(
          "select supplier_recovery_queue($1,$2) r",
          [filter, page],
        )
      ).rows[0].r;
    const before = (await db.query("select * from inventory_balances")).rows;
    const first = await queue();
    assert.equal(first.as_of, dates.today);
    assert.deepEqual(first.summary, {
      cash_remaining_cents: 25600,
      credit_remaining_cents: 2000,
      outstanding_count: 26,
      overdue_count: 24,
      unset_count: 2,
      active_count: 30,
    });
    assert.equal(first.total, 26);
    assert.equal(first.rows.length, 25);
    const second = await queue("outstanding", 2);
    assert.equal(second.rows.length, 1);
    assert.deepEqual(second.summary, first.summary);
    assert.equal(
      new Set([...first.rows, ...second.rows].map((r) => r.id)).size,
      26,
    );
    const overdue = await queue("overdue");
    assert.equal(overdue.total, 24);
    assert.equal(
      overdue.rows.every((r) => r.overdue),
      true,
    );
    assert.equal(
      overdue.rows.some(
        (r) =>
          r.id === ids[1] ||
          r.id === ids[2] ||
          r.id === ids[6] ||
          r.id === ids[7],
      ),
      false,
    );
    const unset = await queue("unset");
    assert.equal(unset.total, 2);
    assert.equal(
      unset.rows.every((r) => r.unset),
      true,
    );
    assert.equal(
      unset.rows.find((r) => r.id === ids[3])?.cash_remaining_cents,
      null,
    );
    assert.equal(
      unset.rows.find((r) => r.id === ids[4])?.cash_remaining_cents,
      0,
    );
    assert.equal((await queue("all")).total, 30);
    assert.equal(
      (await queue("all", 2)).rows.some((r) => r.id === ids[7]),
      false,
    );
    const app = crypto.randomUUID();
    await db.query("select apply_supplier_credit($1,$2,$3,1000,$4)", [
      app,
      credit,
      purchase,
      dates.today,
    ]);
    assert.deepEqual((await queue()).summary, first.summary); // Spending issued credit does not reopen the return target.
    await db.query("select reverse_supplier_refund($1,'Mistake')", [full]);
    assert.equal((await queue()).summary.cash_remaining_cents, 26600);
    assert.equal((await queue()).summary.overdue_count, 25);
    await db.query("select reverse_supplier_credit_application($1,'Mistake')", [
      app,
    ]);
    await db.query("select cancel_supplier_credit($1,'Mistake')", [credit]);
    assert.equal((await queue()).summary.credit_remaining_cents, 4000);
    assert.deepEqual(
      (await db.query("select * from inventory_balances")).rows,
      before,
    );
    await assert.rejects(queue("bogus"), /valid recovery/);
    await assert.rejects(queue("all", 0), /valid recovery/);
    await login(db, outsiderId);
    await assert.rejects(queue(), /Administrator/);
  } finally {
    await db.close();
  }
});
test("empty supplier follow-up reports zero totals for every filter", async () => {
  const db = await inventoryDatabase();
  try {
    for (const filter of ["outstanding", "overdue", "unset", "all"]) {
      const result = (
        await db.query<{ r: Queue }>("select supplier_recovery_queue($1,1) r", [
          filter,
        ])
      ).rows[0].r;
      assert.equal(result.total, 0);
      assert.deepEqual(result.rows, []);
      assert.equal(result.summary.cash_remaining_cents, 0);
      assert.equal(result.summary.credit_remaining_cents, 0);
      assert.equal(result.summary.active_count, 0);
    }
  } finally {
    await db.close();
  }
});
