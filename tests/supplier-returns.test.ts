import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("supplier returns separate weighted stock, actual partial refunds and cash; corrections retain history", async () => {
  const db = await inventoryDatabase();
  try {
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Returned feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const purchase = (
      await db.query<{ r: { movement_id: string; expense_id: string } }>(
        "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-01',1000,null,'Purchase','Feed supplier','2020-01-01') r",
        [crypto.randomUUID(), product, unit],
      )
    ).rows[0].r;
    const request = crypto.randomUUID();
    const ret = (req = request, qty = 20) =>
      db.query<{ id: string }>(
        "select record_supplier_return($1,$2,$3,$4,'2020-01-05','Feed supplier','Damaged bags') id",
        [req, product, unit, qty],
      );
    await assert.rejects(ret(crypto.randomUUID(), 101), /Not enough stock/);
    assert.equal(
      (await db.query("select * from supplier_returns")).rows.length,
      0,
    );
    assert.equal((await ret()).rows[0].id, request);
    assert.equal((await ret()).rows[0].id, request);
    await assert.rejects(ret(request, 21), /already used/);
    const movement = (
      await db.query<{ movement_id: string }>(
        "select movement_id from supplier_returns where id=$1",
        [request],
      )
    ).rows[0].movement_id;
    assert.equal(
      Number(
        (
          await db.query<{ v: string }>(
            "select value_delta_cents v from inventory_movements where id=$1",
            [movement],
          )
        ).rows[0].v,
      ),
      -200,
    );
    await assert.rejects(
      db.query("select reverse_stock_consumption($1,'Bypass')", [movement]),
      /Supplier returns/,
    );
    const refund = crypto.randomUUID();
    const pay = (req = refund, amount = 25, date = "2020-02-01") =>
      db.query<{ id: string }>(
        "select record_supplier_refund($1,$2,$3,$4,'Refund reference','Partial refund') id",
        [req, request, amount, date],
      );
    await assert.rejects(pay(crypto.randomUUID(), 0), /actual refund/);
    await assert.rejects(
      pay(crypto.randomUUID(), 25, "2020-01-04"),
      /cannot precede/,
    );
    await assert.rejects(
      pay(crypto.randomUUID(), 25, "2099-01-01"),
      /actual refund/,
    );
    assert.equal((await pay()).rows[0].id, refund);
    assert.equal((await pay()).rows[0].id, refund);
    await assert.rejects(pay(refund, 26), /already used/);
    const second = crypto.randomUUID();
    await pay(second, 225);
    type Cash = {
      received_cents: number;
      spent_cents: number;
      net_cents: number;
      supplier_refunds_cents: number;
      months: { supplier_refunds_cents: number }[];
    };
    const cash = async (from = "2020-01-01", to = "2020-02-28") =>
      (await db.query<{ r: Cash }>("select cash_report($1,$2) r", [from, to]))
        .rows[0].r;
    let report = await cash();
    assert.equal(report.received_cents, 0);
    assert.equal(report.spent_cents, 1000);
    assert.equal(report.supplier_refunds_cents, 250);
    assert.equal(report.net_cents, -750);
    assert.equal(report.months[0].supplier_refunds_cents, 0);
    assert.equal(report.months[1].supplier_refunds_cents, 250);
    assert.equal((await cash("2020-02-01", "2020-02-28")).net_cents, 250);
    assert.equal((await db.query("select * from expenses")).rows.length, 1);
    // Explicit purchase correction recosts the return; actual refunded cash stays fixed.
    await db.query(
      "select revalue_purchase_cost($1,$2,1000,2000,'Corrected price')",
      [crypto.randomUUID(), purchase.movement_id],
    );
    type Overview = {
      total: number;
      rows: {
        id: string;
        stock_cost_cents: number;
        refunded_cents: number;
        refund_count: number;
        refunds: unknown[];
        cancelled_at: string | null;
      }[];
    };
    const overview = async () =>
      (await db.query<{ r: Overview }>("select supplier_return_overview() r"))
        .rows[0].r;
    let detail = (await overview()).rows[0];
    assert.equal(detail.stock_cost_cents, 400);
    assert.equal(detail.refunded_cents, 250);
    report = await cash();
    assert.equal(report.spent_cents, 2000);
    assert.equal(report.net_cents, -1750);
    await assert.rejects(
      db.query("select cancel_supplier_return($1,'Mistaken return')", [
        request,
      ]),
      /Correct active refund/,
    );
    await db.query("select reverse_supplier_refund($1,'Mistaken refund')", [
      refund,
    ]);
    await db.query("select reverse_supplier_refund($1,'Repeated request')", [
      refund,
    ]);
    assert.equal((await cash()).supplier_refunds_cents, 225);
    await db.query("select reverse_supplier_refund($1,'Mistaken refund')", [
      second,
    ]);
    await db.query("select cancel_supplier_return($1,'Wrong stock entry')", [
      request,
    ]);
    await db.query(
      "select cancel_supplier_return($1,'Repeated cancellation')",
      [request],
    );
    assert.ok((await overview()).rows[0].cancelled_at);
    const balance = (
      await db.query<{ q: string; v: string }>(
        "select quantity_oz q,value_cents v from inventory_balances where product_id=$1",
        [product],
      )
    ).rows[0];
    assert.equal(Number(balance.q), 100);
    assert.equal(Number(balance.v), 2000);
    assert.equal((await cash()).supplier_refunds_cents, 0);
    await assert.rejects(pay(crypto.randomUUID()), /cancelled/);
    // Retrying a previously saved entry never recreates its cancelled/reversed effect.
    assert.equal((await ret()).rows[0].id, request);
    assert.equal((await pay()).rows[0].id, refund);
    const next = crypto.randomUUID();
    await ret(next, 1);
    for (let n = 0; n < 22; n++)
      await db.query("select record_supplier_refund($1,$2,1,'2020-02-01')", [
        crypto.randomUUID(),
        next,
      ]);
    detail = (await overview()).rows.find((r) => r.id === next)!;
    assert.equal(detail.refunded_cents, 22);
    assert.equal(detail.refund_count, 22);
    assert.equal(detail.refunds.length, 20);
    assert.equal((await cash()).supplier_refunds_cents, 22);
    const older = (
      await db.query<{ r: Overview }>(
        "select supplier_return_overview(1,$1,2) r",
        [next],
      )
    ).rows[0].r;
    assert.equal(older.total, 1);
    assert.equal(older.rows.length, 1);
    assert.equal(older.rows[0].refunds.length, 2);
    assert.equal(older.rows[0].refunded_cents, 22);

    for (let n = 0; n < 26; n++) await ret(crypto.randomUUID(), 1);
    const firstPage = await overview();
    assert.equal(firstPage.total, 28);
    assert.equal(firstPage.rows.length, 25);
    const secondPage = (
      await db.query<{ r: Overview }>("select supplier_return_overview(2) r")
    ).rows[0].r;
    assert.equal(secondPage.rows.length, 3);
    const bundle = (
      await db.query<{
        r: {
          business: { net_cents: number; supplier_refunds_cents: number };
          horse: {
            horses: { margin_cents: number }[];
            unassigned_received_cents: number;
            unallocated_paid_cents: number;
          };
          stay: {
            stays: { margin_cents: number }[];
            unassigned_received_cents: number;
            unassigned_direct_cents: number;
            unassigned_shared_cents: number;
            unallocated_shared_cents: number;
          };
        };
      }>("select financial_report_bundle('2020-01-01','2020-02-28') r")
    ).rows[0].r;
    assert.equal(
      bundle.business.net_cents,
      bundle.horse.horses.reduce((sum, h) => sum + h.margin_cents, 0) +
        bundle.horse.unassigned_received_cents -
        bundle.horse.unallocated_paid_cents +
        bundle.business.supplier_refunds_cents,
    );
    assert.equal(
      bundle.business.net_cents,
      bundle.stay.stays.reduce((sum, h) => sum + h.margin_cents, 0) +
        bundle.stay.unassigned_received_cents -
        bundle.stay.unassigned_direct_cents -
        bundle.stay.unassigned_shared_cents -
        bundle.stay.unallocated_shared_cents +
        bundle.business.supplier_refunds_cents,
    );
    await assert.rejects(
      db.query("select supplier_return_overview(0)"),
      /valid page/,
    );
    await assert.rejects(
      db.query("delete from supplier_returns"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from supplier_returns")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from supplier_refunds")).rows.length,
      0,
    );
    await assert.rejects(ret(crypto.randomUUID()), /Administrator/);
    await assert.rejects(
      db.query("select supplier_return_overview()"),
      /Administrator/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(ret(crypto.randomUUID()), /permission denied/);
  } finally {
    await db.close();
  }
});
