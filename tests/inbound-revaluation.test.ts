import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";

test("opening and inbound cost replay restates feeding without expenses, preserves bills and restricts entry points", async () => {
  const db = await inventoryDatabase();
  try {
    for (const kind of ["opening", "adjustment_in"]) {
      const horse = crypto.randomUUID(),
        customer = crypto.randomUUID(),
        stay = crypto.randomUUID();
      await db.exec("reset role");
      await db.query(
        "insert into customers(id,name) values($1,'Stock value customer')",
        [customer],
      );
      await db.query(
        "insert into horses(id,barn_name) values($1,'Stock value horse')",
        [horse],
      );
      await db.query(
        "insert into training_stays(id,horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing) values($1,$2,$3,'2020-01-01','2020-01-31',0,'at_cost','included')",
        [stay, horse, customer],
      );
      await login(db, adminId);
      const category = (
        await db.query<{ id: string }>(
          "select id from expense_categories where name='Feed'",
        )
      ).rows[0].id;
      const product = (
        await db.query<{ id: string }>(
          "select create_inventory_product($1,'feed',$2) id",
          [kind, category],
        )
      ).rows[0].id;
      const unit = (
        await db.query<{ id: string }>(
          "select id from inventory_units where product_id=$1 and label='oz'",
          [product],
        )
      ).rows[0].id;
      const source = (
        await db.query<{ r: { movement_id: string } }>(
          "select record_stock_movement($1,$2,$3,100,$4,'2020-01-01',1000,null,'Initial stock') r",
          [crypto.randomUUID(), product, unit, kind],
        )
      ).rows[0].r.movement_id;
      const feed = (
        await db.query<{ r: { movement_id: string } }>(
          "select record_stock_movement($1,$2,$3,25,'feeding','2020-01-02',null,$4,'Fed') r",
          [crypto.randomUUID(), product, unit, horse],
        )
      ).rows[0].r.movement_id;
      const invoice = (
        await db.query<{ id: string }>(
          "select create_invoice($1,$2,$3,'2020-02-01','2020-02-08','2020-01-01','2020-01-31') id",
          [crypto.randomUUID(), customer, stay],
        )
      ).rows[0].id;
      await db.query("select add_actual_feed($1)", [invoice]);
      await db.query("select finalize_invoice($1)", [invoice]);
      const request = crypto.randomUUID();
      const correct = (req = request, expected = 1000, value = 2000) =>
        db.query<{ id: string }>(
          "select revalue_inbound_cost($1,$2,$3,$4,'Correct starting value') id",
          [req, source, expected, value],
        );
      assert.equal((await correct()).rows[0].id, request);
      assert.equal((await correct()).rows[0].id, request);
      await assert.rejects(correct(request, 1000, 2001), /already used/);
      await assert.rejects(correct(crypto.randomUUID()), /cost changed/);
      const balance = (
        await db.query<{ q: string; v: string }>(
          "select quantity_oz q,value_cents v from inventory_balances where product_id=$1",
          [product],
        )
      ).rows[0];
      assert.equal(Number(balance.q), 75);
      assert.equal(Number(balance.v), 1500);
      assert.equal(
        Number(
          (
            await db.query<{ v: string }>(
              "select value_delta_cents v from inventory_movements where id=$1",
              [feed],
            )
          ).rows[0].v,
        ),
        -500,
      );
      assert.equal(
        (
          await db.query<{ amount_cents: number }>(
            "select amount_cents from invoice_lines where invoice_id=$1",
            [invoice],
          )
        ).rows[0].amount_cents,
        250,
      );
      assert.equal(
        (
          await db.query(
            "select * from invoice_feed_cost_flags where invoice_id=$1 and resolved_at is null",
            [invoice],
          )
        ).rows.length,
        1,
      );
      assert.equal((await db.query("select * from expenses")).rows.length, 0);
      await db.query(
        "select resolve_feed_cost_flag($1,$2,'Review issued amount separately')",
        [request, invoice],
      );
      await correct(crypto.randomUUID(), 2000, 0);
      assert.equal(
        Number(
          (
            await db.query<{ v: string }>(
              "select value_cents v from inventory_balances where product_id=$1",
              [product],
            )
          ).rows[0].v,
        ),
        0,
      );
      assert.equal(
        (
          await db.query(
            "select * from invoice_feed_cost_flags where invoice_id=$1 and resolved_at is null",
            [invoice],
          )
        ).rows.length,
        1,
      );
      await assert.rejects(
        db.query("select revalue_purchase_cost($1,$2,0,1000,'Wrong type')", [
          crypto.randomUUID(),
          source,
        ]),
        /Choose a purchase/,
      );
      await assert.rejects(
        db.query(
          "select revalue_inventory_cost($1,$2,0,1000,'Private engine')",
          [crypto.randomUUID(), source],
        ),
        /permission denied/,
      );
      await login(db, outsiderId);
      await assert.rejects(correct(crypto.randomUUID()), /Administrator/);
      assert.equal(
        (await db.query("select * from inventory_cost_corrections")).rows
          .length,
        0,
      );
      await db.exec("reset role;set role anon");
      await assert.rejects(correct(crypto.randomUUID()), /permission denied/);
      await login(db, adminId);
    }
  } finally {
    await db.close();
  }
});
