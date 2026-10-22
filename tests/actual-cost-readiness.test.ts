import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("actual-cost review is explicit, retry-safe, invalidated by source and charge changes, and enforced on guarded finalization", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Customer') returning id",
      )
    ).rows[0].id;
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Horse') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into horse_customers(horse_id,customer_id) values($1,$2)",
      [horse, customer],
    );
    const stay = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,monthly_rate_cents,feed_billing,boarding_billing) values($1,$2,'2026-01-01',0,'at_cost','at_cost') returning id",
        [horse, customer],
      )
    ).rows[0].id;
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-01-31','2026-01-31','2026-01-01','2026-01-31')",
      [invoice, customer, stay],
    );
    await db.query("select add_invoice_line($1,$2,'Training',1000)", [
      crypto.randomUUID(),
      invoice,
    ]);
    async function ready(service: string, value = true) {
      await db.query("select set_invoice_cost_ready($1,$2,$3,$4)", [
        invoice,
        service,
        value,
        "All period records reviewed, including intentional zero costs",
      ]);
    }
    type Status = { service: string; ready: boolean; changed: boolean };
    async function status() {
      return (
        await db.query<{ result: Status[] }>(
          "select invoice_cost_readiness($1) result",
          [invoice],
        )
      ).rows[0].result;
    }
    assert.equal(
      (await status()).every((s) => !s.ready),
      true,
    );
    await assert.rejects(
      db.query("select finalize_cost_reviewed_invoice($1)", [invoice]),
      /Mark every/,
    );
    await ready("feed");
    await ready("feed");
    assert.equal(
      Number(
        (
          await db.query<{ count: string }>(
            "select count(*) from invoice_cost_review_events",
          )
        ).rows[0].count,
      ),
      1,
    );
    await assert.rejects(
      db.query("select finalize_cost_reviewed_invoice($1)", [invoice]),
      /Mark every/,
    );
    await ready("boarding");
    assert.equal(
      (await status()).every((s) => s.ready),
      true,
    );
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
      "select record_stock_movement($1,$2,$3,10,'opening','2026-01-01',1000)",
      [crypto.randomUUID(), product, unit],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'feeding','2026-01-02',null,$4)",
      [crypto.randomUUID(), product, unit, horse],
    );
    assert.equal(
      (await status()).find((s) => s.service === "feed")!.changed,
      true,
    );
    await assert.rejects(
      db.query("select finalize_cost_reviewed_invoice($1)", [invoice]),
      /Mark every/,
    );
    await ready("feed");
    await assert.rejects(
      db.query("select finalize_cost_reviewed_invoice($1)", [invoice]),
      /Generate all unbilled/,
    );
    await db.query("select add_actual_feed($1)", [invoice]);
    assert.equal(
      (await status()).find((s) => s.service === "feed")!.ready,
      false,
    );
    await ready("feed");
    await ready("boarding", false);
    await assert.rejects(
      db.query("select finalize_cost_reviewed_invoice($1)", [invoice]),
      /Mark every/,
    );
    await ready("boarding");
    const boardCategory = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Boarding / facility'",
      )
    ).rows[0].id;
    const expense = (
      await db.query<{ id: string }>("select save_expense(null,$1::jsonb) id", [
        JSON.stringify({
          expense_date: "2026-01-15",
          category_id: boardCategory,
          horse_id: horse,
          amount_cents: 5000,
          vendor: "Boarding",
        }),
      ])
    ).rows[0].id;
    const split = crypto.randomUUID();
    await db.query(
      "select save_cost_stay_split($1,$2,null,$3,$4::jsonb,'Reviewed boarding')",
      [
        split,
        expense,
        horse,
        JSON.stringify([{ stay_id: stay, amount_cents: 5000 }]),
      ],
    );
    assert.equal(
      (await status()).find((s) => s.service === "boarding")!.changed,
      true,
    );
    await ready("boarding");
    await assert.rejects(
      db.query("select finalize_cost_reviewed_invoice($1)", [invoice]),
      /Generate all unbilled actual boarding/,
    );
    await db.query("select add_actual_boarding($1,$2)", [invoice, split]);
    assert.equal(
      (await status()).find((s) => s.service === "boarding")!.ready,
      false,
    );
    await ready("boarding");
    const number = (
      await db.query<{ number: string }>(
        "select finalize_cost_reviewed_invoice($1) number",
        [invoice],
      )
    ).rows[0].number;
    assert.ok(number);
    assert.equal(
      (
        await db.query<{ number: string }>(
          "select finalize_cost_reviewed_invoice($1) number",
          [invoice],
        )
      ).rows[0].number,
      number,
    );
    await assert.rejects(ready("feed"), /Only a draft/);
    await login(db, outsiderId);
    await assert.rejects(status(), /Administrator/);
    await assert.rejects(ready("feed"), /Administrator/);
    await assert.rejects(
      db.query("select invoice_cost_review_snapshot($1,$2)", [invoice, "feed"]),
      /permission denied/,
    );
    assert.equal(
      (await db.query("select * from invoice_cost_review_events")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("update invoice_cost_reviews set ready=true"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
