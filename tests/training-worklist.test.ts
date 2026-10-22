import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("training worklist includes current stays and latest actual sessions and unreversed feeding", async () => {
  const db = await inventoryDatabase();
  try {
    const day = (
      await db.query<{ value: string }>(
        "select ((now() at time zone 'America/Chicago')::date)::text as value",
      )
    ).rows[0].value;
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Customer') returning id",
      )
    ).rows[0].id;
    const horses = (
      await db.query<{ id: string; barn_name: string }>(
        "insert into horses(barn_name) values('Active'),('Arriving'),('Departed'),('Leaving today'),('No stay') returning id,barn_name",
      )
    ).rows;
    const active = horses[0].id;
    for (const [i, start, end] of [
      [0, -5, null],
      [1, 1, null],
      [2, -5, -1],
      [3, -5, 0],
    ] as const) {
      await db.query(
        "insert into horse_customers(horse_id,customer_id) values($1,$2)",
        [horses[i].id, customer],
      );
      await db.query(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,$3::date+$4::int,case when $5::int is null then null else $3::date+$5::int end,0)",
        [horses[i].id, customer, day, start, end],
      );
    }
    await db.query(
      "insert into training_entries(horse_id,kind,entry_date,title,notes) values($1,'session',$2::date-2,'Cow work','Notes'),($1,'note',$2,'Health note','Notes'),($1,'session',$2::date+1,'Future session','Notes')",
      [active, day],
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
      "select record_stock_movement($1,$2,$3,10,'opening',$4,100)",
      [crypto.randomUUID(), product, unit, day],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'feeding',$4::date-1,null,$5)",
      [crypto.randomUUID(), product, unit, day, active],
    );
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'feeding',$4,null,$5)",
      [crypto.randomUUID(), product, unit, day, active],
    );
    const latest = (
      await db.query<{ id: string }>(
        "select id from inventory_movements where kind='feeding' and movement_date=$1",
        [day],
      )
    ).rows[0].id;
    await db.query(
      "select reverse_stock_consumption($1,'Entered by mistake')",
      [latest],
    );
    const rows = (
      await db.query<{
        horse_id: string;
        last_trained: Date;
        last_fed: Date;
        training_title: string;
      }>("select * from training_worklist()")
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.horse_id),
      [active, horses[3].id],
    );
    assert.equal(rows[0].training_title, "Cow work");
    assert.ok(rows[0].last_trained);
    assert.ok(rows[0].last_fed);
    assert.equal(rows[1].last_trained, null);
    assert.equal(rows[1].last_fed, null);
    assert.equal(
      String(
        (
          await db.query<{ value: string }>(
            "select last_fed::text as value from training_worklist() where horse_id=$1",
            [active],
          )
        ).rows[0].value,
      ),
      String(
        (
          await db.query<{ value: string }>(
            "select ($1::date-1)::text as value",
            [day],
          )
        ).rows[0].value,
      ),
    );
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select * from training_worklist()"),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});
