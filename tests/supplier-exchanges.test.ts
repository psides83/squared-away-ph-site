import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("supplier exchange links preserve costs, payments and credits, guard source changes and retain corrections", async () => {
  const db = await inventoryDatabase();
  try {
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Exchange feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const buy = async (vendor: string, date: string) =>
      (
        await db.query<{ r: { expense_id: string } }>(
          "select record_stock_movement($1,$2,$3,100,'purchase',$4,10000,null,'Purchase',$5,null) r",
          [crypto.randomUUID(), product, unit, date, vendor],
        )
      ).rows[0].r.expense_id;
    const original = await buy("Store", "2020-01-01");
    const replacement = await buy(" store  ", "2020-02-02");
    const wrong = await buy("Different store", "2020-02-02");
    const ret = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,10,'2020-02-01','Store','Return')",
      [ret, product, unit],
    );
    const second = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,10,'2020-02-02','Store','Return')",
      [second, product, unit],
    );
    const link = (
      request: string,
      expense = replacement,
      returnId = ret,
      notes = "Exchange reference",
    ) =>
      db.query("select link_supplier_exchange($1,$2,$3,$4)", [
        request,
        returnId,
        expense,
        notes,
      ]);
    const before = (
      await db.query<{ r: unknown }>(
        "select cash_report('2020-01-01','2020-12-31') r",
      )
    ).rows[0].r;
    const balances = await db.query("select * from inventory_balances");
    const id = crypto.randomUUID();
    await link(id);
    await link(id);
    await assert.rejects(link(id, original), /already saved/);
    await assert.rejects(link(crypto.randomUUID()), /already linked/);
    await assert.rejects(link(crypto.randomUUID(), wrong), /same supplier/);
    const additional = crypto.randomUUID();
    await link(additional, replacement, second); // Relationships may be many-to-many; no amounts allocated.
    const another = crypto.randomUUID();
    await link(another, original);
    assert.deepEqual(
      (
        await db.query<{ r: unknown }>(
          "select cash_report('2020-01-01','2020-12-31') r",
        )
      ).rows[0].r,
      before,
    );
    assert.deepEqual(
      (await db.query("select * from inventory_balances")).rows,
      balances.rows,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from supplier_credit_applications",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ paid_on: string | null; amount_cents: number }>(
          "select paid_on,amount_cents from expenses where id=$1",
          [replacement],
        )
      ).rows[0].paid_on,
      null,
    );
    await assert.rejects(
      db.query("select cancel_supplier_return($1,'Mistake')", [ret]),
      /Remove active replacement/,
    );
    assert.deepEqual(
      (await db.query("select * from inventory_balances")).rows,
      balances.rows,
    ); // Failed cancellation must roll stock reversal back.
    await db.exec("reset role");
    await assert.rejects(
      db.query("update expenses set vendor='Other store' where id=$1", [
        replacement,
      ]),
      /Remove active exchange/,
    );
    await assert.rejects(
      db.query("update expenses set voided_at=now() where id=$1", [
        replacement,
      ]),
      /Remove active exchange/,
    );
    // Restore administrator context after testing privileged edits against the database guards.
    const { adminId } = await import("./helpers/inventory-database.ts");
    await login(db, adminId);
    const overview = async (page = 1) =>
      (
        await db.query<{
          r: {
            total: number;
            rows: { id: string; removed_at: string | null }[];
            eligible: { id: string }[];
          };
        }>("select supplier_return_exchanges($1,$2) r", [ret, page])
      ).rows[0].r;
    assert.equal((await overview()).total, 2);
    assert.equal(
      (await overview()).eligible.some((e) => e.id === replacement),
      false,
    );
    await assert.rejects(
      db.query("select remove_supplier_exchange($1,'')", [id]),
      /reason/,
    );
    await db.query("select remove_supplier_exchange($1,'Wrong match')", [id]);
    await db.query("select remove_supplier_exchange($1,'Repeated click')", [
      id,
    ]);
    await link(id); // Late retries leave removed links removed.
    assert.ok((await overview()).rows.find((r) => r.id === id)?.removed_at);
    assert.equal(
      (await overview()).eligible.some((e) => e.id === replacement),
      true,
    );
    const relink = crypto.randomUUID();
    await link(relink);
    for (const active of [relink, another])
      await db.query("select remove_supplier_exchange($1,'Correction')", [
        active,
      ]);
    await db.query("select cancel_supplier_return($1,'Mistake')", [ret]);
    await assert.rejects(link(crypto.randomUUID()), /active supplier return/);
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from supplier_exchange_links")).rows.length,
      0,
    );
    await assert.rejects(link(crypto.randomUUID()), /Administrator/);
    await assert.rejects(
      db.query("select supplier_return_exchanges($1,1)", [ret]),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select remove_supplier_exchange($1,'Wrong match')", [
        additional,
      ]),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});
test("exchange history paginates retained links and excludes void/non-stock suppliers from purchase choices", async () => {
  const db = await inventoryDatabase();
  try {
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Exchange history','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const expense = (
      await db.query<{ r: { expense_id: string } }>(
        "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-01',10000,null,'Purchase','Store',null) r",
        [crypto.randomUUID(), product, unit],
      )
    ).rows[0].r.expense_id;
    const ret = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,10,'2020-02-01','Store','Return')",
      [ret, product, unit],
    );
    for (let n = 0; n < 26; n++) {
      const id = crypto.randomUUID();
      await db.query("select link_supplier_exchange($1,$2,$3,null)", [
        id,
        ret,
        expense,
      ]);
      await db.query("select remove_supplier_exchange($1,'Test correction')", [
        id,
      ]);
    }
    const pages = await Promise.all(
      [1, 2].map(
        async (page) =>
          (
            await db.query<{
              r: {
                total: number;
                rows: { id: string }[];
                eligible: { id: string }[];
              };
            }>("select supplier_return_exchanges($1,$2) r", [ret, page])
          ).rows[0].r,
      ),
    );
    assert.equal(pages[0].total, 26);
    assert.equal(pages[0].rows.length, 25);
    assert.equal(pages[1].rows.length, 1);
    assert.equal(
      new Set(pages.flatMap((p) => p.rows.map((r) => r.id))).size,
      26,
    );
    assert.equal(pages[0].eligible[0].id, expense);
    await assert.rejects(
      db.query("select supplier_return_exchanges($1,0)", [ret]),
      /valid page/,
    );
    await assert.rejects(
      db.query("select supplier_return_exchanges($1,1)", [crypto.randomUUID()]),
      /not found/,
    );
    await db.exec("reset role");
    const nonStock = crypto.randomUUID();
    await db.query(
      "insert into expenses(id,expense_date,category_id,vendor,amount_cents) values($1,'2020-01-01',(select id from expense_categories where name='Feed'),'Store',500)",
      [nonStock],
    );
    await db.query("update expenses set voided_at=now() where id=$1", [
      expense,
    ]);
    const { adminId } = await import("./helpers/inventory-database.ts");
    await login(db, adminId);
    await assert.rejects(
      db.query("select link_supplier_exchange($1,$2,$3,null)", [
        crypto.randomUUID(),
        ret,
        nonStock,
      ]),
      /active inventory purchase/,
    );
    assert.equal(
      (
        await db.query<{ r: { eligible: unknown[] } }>(
          "select supplier_return_exchanges($1,1) r",
          [ret],
        )
      ).rows[0].r.eligible.length,
      0,
    );
    await assert.rejects(
      db.query("select link_supplier_exchange($1,$2,$3,null)", [
        crypto.randomUUID(),
        ret,
        expense,
      ]),
      /active inventory purchase/,
    );
  } finally {
    await db.close();
  }
});
