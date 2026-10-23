import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
async function product(
  db: Awaited<ReturnType<typeof inventoryDatabase>>,
  name: string,
) {
  const id = (
    await db.query<{ id: string }>(
      "select create_inventory_product($1,'feed',(select id from expense_categories where name='Feed')) id",
      [name],
    )
  ).rows[0].id;
  const unit = (
    await db.query<{ id: string }>(
      "select id from inventory_units where product_id=$1 and label='oz'",
      [id],
    )
  ).rows[0].id;
  return { id, unit };
}
test("quantity replay preserves actual feeding, expenses, receipts and issued charges while recosting later use and flagging invoices", async () => {
  const db = await inventoryDatabase();
  try {
    const horse = crypto.randomUUID(),
      customer = crypto.randomUUID(),
      stay = crypto.randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into customers(id,name) values($1,'Quantity customer')",
      [customer],
    );
    await db.query(
      "insert into horses(id,barn_name) values($1,'Quantity horse')",
      [horse],
    );
    await db.query(
      "insert into training_stays(id,horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing) values($1,$2,$3,'2020-01-01','2020-01-31',0,'at_cost','included')",
      [stay, horse, customer],
    );
    await login(db, adminId);
    const p = await product(db, "Quantity feed");
    const move = async (
      q: number,
      kind: string,
      cost: number | null,
      date: string,
    ) =>
      (
        await db.query<{ r: { movement_id: string; expense_id: string } }>(
          "select record_stock_movement($1,$2,$3,$4,$5,$6,$7,$8,'Quantity fixture') r",
          [
            crypto.randomUUID(),
            p.id,
            p.unit,
            q,
            kind,
            date,
            cost,
            kind === "feeding" ? horse : null,
          ],
        )
      ).rows[0].r;
    const source = await move(100, "purchase", 1000, "2020-01-01");
    const fed = await move(20, "feeding", null, "2020-01-02");
    const invoice = async () =>
      (
        await db.query<{ id: string }>(
          "select create_invoice($1,$2,$3,'2020-02-01','2020-02-08','2020-01-01','2020-01-31') id",
          [crypto.randomUUID(), customer, stay],
        )
      ).rows[0].id;
    const issued = await invoice();
    await db.query("select add_actual_feed($1)", [issued]);
    await db.query("select finalize_invoice($1)", [issued]);
    await move(100, "purchase", 2000, "2020-01-03");
    const fed2 = await move(90, "feeding", null, "2020-01-04");
    const draft = await invoice();
    await db.query("select add_actual_feed($1)", [draft]);
    const ret = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,10,'2020-01-05','Supplier','Damaged')",
      [ret, p.id, p.unit],
    );
    await db.query(
      "select record_supplier_refund($1,$2,200,'2020-01-05','Refund','')",
      [crypto.randomUUID(), ret],
    );
    const waste = await move(10, "waste", null, "2020-01-06");
    await db.query("select reverse_stock_consumption($1,'Mistake')", [
      waste.movement_id,
    ]);
    await db.exec("reset role");
    const receipt = crypto.randomUUID();
    await db.query(
      "insert into expense_receipts(id,expense_id,object_path,file_name,content_type,size_bytes) values($1,$2,'quantity/receipt.pdf','Receipt.pdf','application/pdf',100)",
      [receipt, source.expense_id],
    );
    await login(db, adminId);
    const issuedBefore = (
      await db.query("select * from invoice_lines where invoice_id=$1", [
        issued,
      ])
    ).rows;
    const request = crypto.randomUUID();
    const correct = (req = request, expected = 100, qty = 80, cost = 1000) =>
      db.query(
        "select correct_inventory_source_quantity($1,$2,1000,$3,$4,$5,'Actual purchased quantity')",
        [req, source.movement_id, cost, expected, qty],
      );
    await correct();
    await correct();
    await assert.rejects(correct(request, 100, 81), /already used/);
    await assert.rejects(correct(crypto.randomUUID()), /quantity changed/);
    const values = (
      await db.query<{ id: string; q: string; v: string }>(
        "select id,quantity_delta_oz q,value_delta_cents v from inventory_movements where id=any($1::uuid[])",
        [[fed.movement_id, fed2.movement_id]],
      )
    ).rows;
    assert.equal(Number(values.find((r) => r.id === fed.movement_id)!.q), -20);
    assert.equal(Number(values.find((r) => r.id === fed.movement_id)!.v), -250);
    assert.equal(Number(values.find((r) => r.id === fed2.movement_id)!.q), -90);
    assert.equal(
      Number(values.find((r) => r.id === fed2.movement_id)!.v),
      -1546.875,
    );
    const balance = (
      await db.query<{ q: string; v: string }>(
        "select quantity_oz q,value_cents v from inventory_balances where product_id=$1",
        [p.id],
      )
    ).rows[0];
    assert.equal(Number(balance.q), 60);
    assert.equal(Number(balance.v), 1031.25);
    assert.equal(
      Number(
        (
          await db.query<{ amount_cents: number }>(
            "select amount_cents from expenses where id=$1",
            [source.expense_id],
          )
        ).rows[0].amount_cents,
      ),
      1000,
    );
    assert.equal(
      (await db.query("select * from expense_receipts where id=$1", [receipt]))
        .rows.length,
      1,
    );
    assert.deepEqual(
      (
        await db.query("select * from invoice_lines where invoice_id=$1", [
          issued,
        ])
      ).rows,
      issuedBefore,
    );
    assert.equal(
      (
        await db.query(
          "select * from invoice_feed_cost_flags where correction_id=$1",
          [request],
        )
      ).rows.length,
      2,
    );
    await assert.rejects(
      db.query("select finalize_invoice($1)", [draft]),
      /review|cost/i,
    );
    const refunds = (
      await db.query<{ refunded_cents: number; stock_cost_cents: string }>(
        "select (supplier_return_overview(1,$1)->'rows'->0->>'refunded_cents')::integer refunded_cents,(supplier_return_overview(1,$1)->'rows'->0->>'stock_cost_cents') stock_cost_cents",
        [ret],
      )
    ).rows[0];
    assert.equal(refunds.refunded_cents, 200);
    assert.equal(Number(refunds.stock_cost_cents), 171.875);
    await login(db, outsiderId);
    await assert.rejects(correct(), /Administrator/);
    assert.equal(
      (await db.query("select * from inventory_cost_corrections")).rows.length,
      0,
    );
    await login(db, adminId);
    await assert.rejects(
      db.query(
        "select replay_inventory_source_correction($1,$2,1000,1000,80,90,'Bypass')",
        [crypto.randomUUID(), source.movement_id],
      ),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("historical shortages block atomically even when later stock exists; source snapshots and late retries are preserved", async () => {
  const db = await inventoryDatabase();
  try {
    const p = await product(db, "Shortage feed");
    const horse = crypto.randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into horses(id,barn_name) values($1,'Shortage horse')",
      [horse],
    );
    await login(db, adminId);
    const source = (
      await db.query<{ r: { movement_id: string; expense_id: string } }>(
        "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-01',1000) r",
        [crypto.randomUUID(), p.id, p.unit],
      )
    ).rows[0].r;
    await db.query(
      "select record_stock_movement($1,$2,$3,80,'feeding','2020-01-02',null,$4)",
      [crypto.randomUUID(), p.id, p.unit, horse],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-03',1000)",
      [crypto.randomUUID(), p.id, p.unit],
    );
    const before = (
      await db.query(
        "select * from inventory_movements order by recording_order",
      )
    ).rows;
    const failed = crypto.randomUUID();
    const attempt = () =>
      db.query(
        "select correct_inventory_source_quantity($1,$2,1000,600,100,50,'Correct quantity and cost')",
        [failed, source.movement_id],
      );
    await assert.rejects(attempt(), /short by 30.*feeding.*2020-01-02/);
    assert.deepEqual(
      (
        await db.query(
          "select * from inventory_movements order by recording_order",
        )
      ).rows,
      before,
    );
    assert.equal(
      (await db.query("select * from inventory_cost_corrections")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from expenses where id=$1",
          [source.expense_id],
        )
      ).rows[0].amount_cents,
      1000,
    );
    // Merely backdating a newly recorded addition must not repair an earlier shortage.
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'adjustment_in','2019-12-31',1000,null,'Counted stock')",
      [crypto.randomUUID(), p.id, p.unit],
    );
    await assert.rejects(attempt(), /short by 30/);
    const okay = crypto.randomUUID();
    await db.query(
      "select correct_inventory_source_quantity($1,$2,1000,600,100,80,'Supported earlier stock')",
      [okay, source.movement_id],
    );
    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from expenses where id=$1",
          [source.expense_id],
        )
      ).rows[0].amount_cents,
      600,
    );
    // Cost-only wrappers must stay retry-safe after a subsequent quantity correction.
    const inbound = await product(db, "Snapshot feed");
    await db.query(
      "insert into inventory_units(product_id,label,ounces_per_unit) values($1,'scoop',10)",
      [inbound.id],
    );
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='scoop'",
        [inbound.id],
      )
    ).rows[0].id;
    const start = (
      await db.query<{ r: { movement_id: string } }>(
        "select record_stock_movement($1,$2,$3,10,'opening','2020-01-01',1000) r",
        [crypto.randomUUID(), inbound.id, unit],
      )
    ).rows[0].r.movement_id;
    const costRequest = crypto.randomUUID();
    await db.query("select revalue_inbound_cost($1,$2,1000,1100,'Value fix')", [
      costRequest,
      start,
    ]);
    await db.query(
      "update inventory_units set label='large scoop',ounces_per_unit=20 where id=$1",
      [unit],
    );
    const quantityRequest = crypto.randomUUID();
    await db.query(
      "select correct_inventory_source_quantity($1,$2,1100,1100,10,8,'Actual scoops')",
      [quantityRequest, start],
    );
    const snapshot = (
      await db.query<{
        q: string;
        unit_label: string;
        ounces_per_unit: string;
      }>(
        "select quantity_delta_oz q,unit_label,ounces_per_unit from inventory_movements where id=$1",
        [start],
      )
    ).rows[0];
    assert.equal(Number(snapshot.q), 80);
    assert.equal(snapshot.unit_label, "scoop");
    assert.equal(Number(snapshot.ounces_per_unit), 10);
    await db.query("select revalue_inbound_cost($1,$2,1000,1100,'Value fix')", [
      costRequest,
      start,
    ]);
    await db.query(
      "select correct_inventory_source_quantity($1,$2,1100,1100,8,9,'Recounted')",
      [crypto.randomUUID(), start],
    );
    await db.query(
      "select correct_inventory_source_quantity($1,$2,1100,1100,10,8,'Actual scoops')",
      [quantityRequest, start],
    );
    assert.equal(
      Number(
        (
          await db.query<{ q: string }>(
            "select quantity_delta_oz q from inventory_movements where id=$1",
            [start],
          )
        ).rows[0].q,
      ),
      90,
    );
    const adjustments = await product(db, "Addition feed");
    const add = (
      await db.query<{ r: { movement_id: string } }>(
        "select record_stock_movement($1,$2,$3,100,'adjustment_in','2020-01-01',1000,null,'Initial count') r",
        [crypto.randomUUID(), adjustments.id, adjustments.unit],
      )
    ).rows[0].r.movement_id;
    await db.query(
      "select record_stock_movement($1,$2,$3,25,'waste','2020-01-02',null,null,'Spilled')",
      [crypto.randomUUID(), adjustments.id, adjustments.unit],
    );
    await db.query(
      "select correct_inventory_source_quantity($1,$2,1000,1000,100,80,'Count fix')",
      [crypto.randomUUID(), add],
    );
    assert.equal(
      Number(
        (
          await db.query<{ q: string }>(
            "select quantity_oz q from inventory_balances where product_id=$1",
            [adjustments.id],
          )
        ).rows[0].q,
      ),
      55,
    );
  } finally {
    await db.close();
  }
});
