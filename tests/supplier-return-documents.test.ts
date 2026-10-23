import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("supplier return documents remain private, deduplicate and retain reversible correction history without changing finances", async () => {
  const db = await inventoryDatabase();
  try {
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Document feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'opening','2020-01-01',1000)",
      [crypto.randomUUID(), product, unit],
    );
    const ret = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,20,'2020-01-02','Supplier','Damaged bags')",
      [ret, product, unit],
    );
    const before = (
      await db.query(
        "select quantity_oz,value_cents from inventory_balances where product_id=$1",
        [product],
      )
    ).rows;
    const hash = "a".repeat(64),
      path = `${ret}/${hash}.pdf`;
    const register = async (name = "Return slip.pdf", digest = hash) =>
      (
        await db.query<{ id: string }>(
          "select register_supplier_return_document($1,$2,$3,'application/pdf',100,'return_slip') id",
          [ret, digest, name],
        )
      ).rows[0].id;
    await assert.rejects(register(), /Upload/);
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('supplier-return-documents','bad/path')",
      ),
      /row.level security/,
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('supplier-return-documents',$1)",
      [path],
    );
    const doc = await register();
    assert.equal(await register("Renamed duplicate.pdf"), doc);
    assert.equal(
      (await db.query("select * from supplier_return_documents")).rows.length,
      1,
    );
    const get = async () =>
      (
        await db.query<{ version: string; archived_at: string | null }>(
          "select version,archived_at from supplier_return_documents where id=$1",
          [doc],
        )
      ).rows[0];
    const initial = await get();
    const correct = (archived: boolean, reason: string, version: string) =>
      db.query("select set_supplier_return_document_archived($1,$2,$3,$4)", [
        doc,
        archived,
        reason,
        version,
      ]);
    await assert.rejects(correct(true, "", initial.version), /reason/);
    await correct(true, "Duplicate scan", initial.version);
    const archived = await get();
    assert.ok(archived.archived_at);
    await correct(true, "Retry", initial.version);
    assert.equal(
      (await db.query("select * from supplier_return_document_events")).rows
        .length,
      1,
    );
    assert.equal(await register(), doc);
    assert.ok((await get()).archived_at);
    const blockedDelete = await db.query(
      "delete from storage.objects where bucket_id='supplier-return-documents' and name=$1 returning id",
      [path],
    );
    assert.equal(blockedDelete.rows.length, 0);
    await correct(false, "Useful original", archived.version);
    assert.equal((await get()).archived_at, null);
    await assert.rejects(correct(true, "Old form", initial.version), /changed/);
    assert.equal(
      (await db.query("select * from supplier_return_document_events")).rows
        .length,
      2,
    );
    await assert.rejects(
      db.query("delete from supplier_return_documents where id=$1", [doc]),
      /permission denied/,
    );
    assert.deepEqual(
      (
        await db.query(
          "select quantity_oz,value_cents from inventory_balances where product_id=$1",
          [product],
        )
      ).rows,
      before,
    );
    assert.equal(
      (await db.query("select * from supplier_refunds")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from expenses")).rows.length, 0);
    await db.query("select cancel_supplier_return($1,'Mistaken return')", [
      ret,
    ]);
    assert.equal(
      (await db.query("select * from supplier_return_documents")).rows.length,
      1,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from supplier_return_documents")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from supplier_return_document_events")).rows
        .length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='supplier-return-documents'",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(register(), /Administrator/);
    await login(db, adminId);
    await assert.rejects(register("Bad.pdf", "invalid"), /supported document/);
  } finally {
    await db.close();
  }
});
