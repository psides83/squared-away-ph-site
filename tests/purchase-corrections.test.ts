import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
  adminId,
} from "./helpers/inventory-database.ts";
test("purchase replacement retains an audit, corrects stock/cash atomically, retries safely and blocks downstream stock", async () => {
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
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,50,'opening','2020-01-01',100)",
      [crypto.randomUUID(), product, unit],
    );
    const p = (
      await db.query<{ r: { movement_id: string; expense_id: string } }>(
        "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-02',300,null,'Original notes','Vendor','2020-01-03') r",
        [crypto.randomUUID(), product, unit],
      )
    ).rows[0].r;
    await db.exec("reset role");
    await db.query(
      "insert into expense_allocations(id,expense_id,period_from,period_to,source_amount_cents,reason,created_by,submitted_rows) values($1,$2,'2020-01-02','2020-01-02',300,'Protected shared cost',$3,'[]')",
      [crypto.randomUUID(), p.expense_id, adminId],
    );
    await login(db, adminId);
    await assert.rejects(
      db.query(
        "select correct_inventory_purchase($1,$2,$3,200,500,'Cannot replace allocated source')",
        [crypto.randomUUID(), p.movement_id, unit],
      ),
      /Clear the shared-cost allocation/,
    );
    await db.exec("reset role");
    await db.query(
      "update expense_allocations set retired_at=now() where expense_id=$1",
      [p.expense_id],
    );
    await login(db, adminId);
    const req = crypto.randomUUID();
    const correct = (
      request = req,
      qty = 200,
      cost = 500,
      original = p.movement_id,
    ) =>
      db.query<{ id: string }>(
        "select correct_inventory_purchase($1,$2,$3,$4,$5,'Corrected receipt entry') id",
        [request, original, unit, qty, cost],
      );
    // An invalid replacement must not leave a voided expense or reversed stock.
    await assert.rejects(correct(crypto.randomUUID(), 0));
    assert.equal(
      (
        await db.query<{ v: null }>(
          "select voided_at v from expenses where id=$1",
          [p.expense_id],
        )
      ).rows[0].v,
      null,
    );
    assert.equal(
      (
        await db.query<{ q: string }>(
          "select quantity_oz q from inventory_balances where product_id=$1",
          [product],
        )
      ).rows[0].q,
      "150.000000000000",
    );
    const expense = (await correct()).rows[0].id;
    assert.equal((await correct()).rows[0].id, expense);
    await assert.rejects(correct(req, 201), /already used/);
    await assert.rejects(
      correct(crypto.randomUUID()),
      /already been corrected/,
    );
    const b = (
      await db.query<{ q: string; v: string }>(
        "select quantity_oz q,value_cents v from inventory_balances where product_id=$1",
        [product],
      )
    ).rows[0];
    assert.equal(Number(b.q), 250);
    assert.equal(Number(b.v), 600);
    const e = (
      await db.query<{
        paid_on: string;
        vendor: string;
        expense_date: string;
        amount_cents: number;
      }>(
        "select paid_on::text,vendor,expense_date::text,amount_cents from expenses where id=$1",
        [expense],
      )
    ).rows[0];
    assert.equal(e.paid_on, "2020-01-03");
    assert.equal(e.vendor, "Vendor");
    assert.equal(e.expense_date, "2020-01-02");
    assert.equal(e.amount_cents, 500);
    assert.ok(
      (
        await db.query<{ v: string }>(
          "select voided_at v from expenses where id=$1",
          [p.expense_id],
        )
      ).rows[0].v,
    );
    assert.equal(
      (
        await db.query<{ r: { business: { spent_cents: number } } }>(
          "select financial_report_bundle('2020-01-01','2020-12-31') r",
        )
      ).rows[0].r.business.spent_cents,
      500,
    );
    const audit = (
      await db.query<{ replacement_id: string; original_expense_id: string }>(
        "select * from inventory_purchase_corrections",
      )
    ).rows[0];
    assert.equal(audit.original_expense_id, p.expense_id);
    // Replacement can itself be corrected before later stock activity.
    const next = (
      await correct(crypto.randomUUID(), 200, 550, audit.replacement_id)
    ).rows[0].id;
    const latest = (
      await db.query<{ id: string }>(
        "select id from inventory_movements where expense_id=$1",
        [next],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'waste','2020-01-04')",
      [crypto.randomUUID(), product, unit],
    );
    await assert.rejects(
      correct(crypto.randomUUID(), 200, 600, latest),
      /Stock activity/,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from inventory_purchase_corrections",
        )
      ).rows[0].n,
      2,
    );
    await assert.rejects(
      db.query("delete from inventory_purchase_corrections"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from inventory_purchase_corrections")).rows
        .length,
      0,
    );
    await assert.rejects(correct(), /Administrator/);
    await db.exec("reset role;set role anon");
    await assert.rejects(correct(), /permission denied/);
  } finally {
    await db.close();
  }
});
