import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("supplier credits apply once to matching purchases, retain feed value and reduce only settled cash spending", async () => {
  const db = await inventoryDatabase();
  try {
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Credit feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const buy = async (
      amount: number,
      date: string,
      paid: string | null,
      vendor = "Feed Store",
    ) =>
      (
        await db.query<{ r: { movement_id: string; expense_id: string } }>(
          "select record_stock_movement($1,$2,$3,100,'purchase',$4,$5,null,'Purchase',$6,$7) r",
          [crypto.randomUUID(), product, unit, date, amount, vendor, paid],
        )
      ).rows[0].r;
    const first = await buy(10000, "2020-02-05", "2020-02-05"),
      second = await buy(5000, "2020-02-06", null);
    const issue = async (
      id: string,
      amount: number,
      vendor = " feed   STORE ",
      ret: string | null = null,
    ) =>
      (
        await db.query<{ id: string }>(
          "select issue_supplier_credit($1,$2,'2020-02-07',$3,'Reference','Returned goods',$4) id",
          [id, vendor, amount, ret],
        )
      ).rows[0].id;
    // Use an issue date before the first purchase for this fixture.
    const credit = crypto.randomUUID();
    await db.query(
      "select issue_supplier_credit($1,' feed   STORE ','2020-02-01',6000,'Note','Credit issued')",
      [credit],
    );
    await db.query(
      "select issue_supplier_credit($1,'Feed Store','2020-02-01',6000,'Note','Credit issued')",
      [credit],
    );
    const apply = (
      id: string,
      c: string,
      e: string,
      n: number,
      date = "2020-02-05",
    ) =>
      db.query("select apply_supplier_credit($1,$2,$3,$4,$5)", [
        id,
        c,
        e,
        n,
        date,
      ]);
    const application = crypto.randomUUID();
    await apply(application, credit, first.expense_id, 4000);
    await apply(application, credit, first.expense_id, 4000);
    await assert.rejects(
      apply(application, credit, first.expense_id, 4001),
      /already used/,
    );
    const cash = async () =>
      (
        await db.query<{
          r: {
            spent_cents: number;
            supplier_credit_used_cents: number;
            net_cents: number;
            categories: { amount_cents: number }[];
            months: {
              spent_cents: number;
              supplier_credit_used_cents: number;
            }[];
          };
        }>("select cash_report('2020-02-01','2020-02-29') r")
      ).rows[0].r;
    assert.equal((await cash()).spent_cents, 11000 - 5000);
    assert.equal((await cash()).supplier_credit_used_cents, 4000);
    assert.equal((await cash()).net_cents, -6000);
    assert.equal(
      (await cash()).months.reduce(
        (sum, m) => sum + m.supplier_credit_used_cents,
        0,
      ),
      4000,
    );
    assert.equal(
      (await cash()).categories.reduce((s, c) => s + c.amount_cents, 0),
      6000,
    );
    assert.equal(
      (await cash()).months.reduce((s, c) => s + c.spent_cents, 0),
      6000,
    );
    await assert.rejects(
      apply(crypto.randomUUID(), credit, first.expense_id, 3000),
      /insufficient/,
    );
    await assert.rejects(
      db.query("select revalue_purchase_cost($1,$2,10000,3000,'Too low')", [
        crypto.randomUUID(),
        first.movement_id,
      ]),
      /applied credit/,
    );
    await assert.rejects(
      db.query("select set_expense_status($1,'2020-02-04',false)", [
        first.expense_id,
      ]),
      /dates/,
    );
    const wrong = await buy(1000, "2020-02-05", null, "Other vendor");
    await assert.rejects(
      apply(crypto.randomUUID(), credit, wrong.expense_id, 100),
      /supplier must match/,
    );
    const secondApplication = crypto.randomUUID();
    await apply(
      secondApplication,
      credit,
      second.expense_id,
      2000,
      "2020-02-06",
    );
    assert.equal((await cash()).spent_cents, 6000);
    assert.equal((await cash()).supplier_credit_used_cents, 4000);
    await db.query("select set_expense_status($1,'2020-02-06',false)", [
      second.expense_id,
    ]);
    assert.equal((await cash()).spent_cents, 9000);
    assert.equal((await cash()).supplier_credit_used_cents, 6000);
    const extra = crypto.randomUUID();
    await db.query(
      "select issue_supplier_credit($1,'Feed Store','2020-02-01',20000,null,'More credit')",
      [extra],
    );
    await assert.rejects(
      apply(crypto.randomUUID(), extra, first.expense_id, 6001),
      /exceed this purchase/,
    );
    const full = crypto.randomUUID();
    await apply(full, extra, second.expense_id, 3000, "2020-02-06");
    assert.equal((await cash()).spent_cents, 6000);
    assert.equal((await cash()).supplier_credit_used_cents, 9000);
    const expense = (
      await db.query<{ r: { applied_cents: number; cash_cents: number } }>(
        "select expense_supplier_credits($1) r",
        [second.expense_id],
      )
    ).rows[0].r;
    assert.equal(expense.applied_cents, 5000);
    assert.equal(expense.cash_cents, 0);
    await db.query(
      "select reverse_supplier_credit_application($1,'Wrong note used')",
      [full],
    );
    await db.query("select reverse_supplier_credit_application($1,'Retry')", [
      full,
    ]);
    await apply(full, extra, second.expense_id, 3000, "2020-02-06");
    assert.equal((await cash()).spent_cents, 9000);
    await assert.rejects(
      db.query("select cancel_supplier_credit($1,'Mistake')", [credit]),
      /Reverse/,
    );
    // A credit's retained application history is paged without truncating its balance.
    for (let i = 0; i < 22; i++) {
      const id = crypto.randomUUID();
      await apply(id, extra, first.expense_id, 1);
      await db.query(
        "select reverse_supplier_credit_application($1,'Test correction')",
        [id],
      );
    }
    const overview = (
      await db.query<{
        r: {
          rows: {
            used_cents: number;
            application_count: number;
            applications: unknown[];
          }[];
        };
      }>("select supplier_credit_overview(1,$1,1) r", [extra])
    ).rows[0].r;
    assert.equal(overview.rows[0].used_cents, 0);
    assert.equal(overview.rows[0].application_count, 23);
    assert.equal(overview.rows[0].applications.length, 20);
    assert.equal(
      (
        await db.query<{ r: { rows: { applications: unknown[] }[] } }>(
          "select supplier_credit_overview(1,$1,2) r",
          [extra],
        )
      ).rows[0].r.rows[0].applications.length,
      3,
    );
    const value = (
      await db.query<{ amount_cents: number }>(
        "select amount_cents from expenses where id=$1",
        [first.expense_id],
      )
    ).rows[0].amount_cents;
    assert.equal(value, 10000);
    assert.equal(
      Number(
        (
          await db.query<{ v: string }>(
            "select value_delta_cents v from inventory_movements where id=$1",
            [first.movement_id],
          )
        ).rows[0].v,
      ),
      10000,
    );
    const horse = (
      await db.query<{ r: { unallocated_paid_cents: number } }>(
        "select horse_cash_report('2020-02-01','2020-02-29') r",
      )
    ).rows[0].r;
    assert.equal(
      -horse.unallocated_paid_cents + (await cash()).supplier_credit_used_cents,
      (await cash()).net_cents,
    );
    const ret = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,10,'2020-02-07','Feed Store','Damaged')",
      [ret, product, unit],
    );
    const linked = crypto.randomUUID();
    await issue(linked, 500, "Feed Store", ret);
    await assert.rejects(
      db.query("select cancel_supplier_return($1,'Mistake')", [ret]),
      /linked supplier credits/,
    );
    await db.query("select cancel_supplier_credit($1,'Mistaken note')", [
      linked,
    ]);
    await db.query("select cancel_supplier_return($1,'Mistake')", [ret]);
    await db.query(
      "select reverse_supplier_credit_application($1,'Correction')",
      [application],
    );
    await db.query(
      "select reverse_supplier_credit_application($1,'Correction')",
      [secondApplication],
    );
    await db.query("select cancel_supplier_credit($1,'Mistaken note')", [
      credit,
    ]);
    await db.query(
      "select issue_supplier_credit($1,'Feed Store','2020-02-01',6000,'Note','Credit issued')",
      [credit],
    );
    assert.ok(
      (
        await db.query<{ cancelled_at: string | null }>(
          "select cancelled_at from supplier_credits where id=$1",
          [credit],
        )
      ).rows[0].cancelled_at,
    );
    assert.equal((await cash()).spent_cents, 15000);
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from supplier_credits")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from supplier_credit_applications")).rows
        .length,
      0,
    );
    await assert.rejects(issue(crypto.randomUUID(), 100), /Administrator/);
    await assert.rejects(
      db.query("select expense_supplier_credits($1)", [first.expense_id]),
      /Administrator/,
    );
    await login(db, adminId);
    await assert.rejects(
      db.query("select supplier_credit_used($1)", [first.expense_id]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("delete from supplier_credits"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
