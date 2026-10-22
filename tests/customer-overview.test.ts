import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("customer summaries isolate billing from co-ownership, retain current billing responsibility, and ignore reversed payments", async () => {
  const db = await inventoryDatabase();
  try {
    const day = (
      await db.query<{ value: string }>(
        "select ((now() at time zone 'America/Chicago')::date)::text as value",
      )
    ).rows[0].value;
    const customers = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('First'),('Co-owner'),('Empty') returning id",
      )
    ).rows;
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Shared horse') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into horse_customers(horse_id,customer_id) values($1,$2),($1,$3)",
      [horse, customers[0].id, customers[1].id],
    );
    await db.query(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,monthly_rate_cents) values($1,$2,$3,0)",
      [horse, customers[0].id, day],
    );
    async function invoice(
      customer: string,
      amount: number,
      due: string,
      draft = false,
    ) {
      const id = crypto.randomUUID();
      await db.query(
        "select create_invoice($1,$2,null,'2026-01-01',$3,null,null)",
        [id, customer, due],
      );
      await db.query("select add_invoice_line($1,$2,'Charge',$3)", [
        crypto.randomUUID(),
        id,
        amount,
      ]);
      if (!draft) await db.query("select finalize_invoice($1)", [id]);
      return id;
    }
    const overdue = await invoice(customers[0].id, 10000, "2026-01-02");
    await invoice(customers[0].id, 5000, day);
    await invoice(customers[0].id, 99999, day, true);
    const voided = await invoice(customers[0].id, 99999, day);
    await db.query("select void_invoice($1,'Mistake')", [voided]);
    await invoice(customers[1].id, 7000, day);
    const payment = crypto.randomUUID();
    await db.query(
      "select record_invoice_payment($1,$2,2500,'2026-01-03','cash')",
      [payment, overdue],
    );
    const reversed = crypto.randomUUID();
    await db.query("select record_invoice_payment($1,$2,500,$3,'cash')", [
      reversed,
      overdue,
      day,
    ]);
    await db.query("select reverse_invoice_payment($1,'Mistake')", [reversed]);
    type Summary = {
      customer_id: string;
      horse_count: number;
      current_stays: number;
      outstanding_cents: number;
      overdue_cents: number;
      draft_count: number;
      last_payment_cents: number | null;
      portal_status: string;
    };
    const rows = (await db.query<Summary>("select * from customer_overview()"))
      .rows;
    const a = rows.find((r) => r.customer_id === customers[0].id)!,
      b = rows.find((r) => r.customer_id === customers[1].id)!,
      empty = rows.find((r) => r.customer_id === customers[2].id)!;
    assert.equal(Number(a.outstanding_cents), 12500);
    assert.equal(Number(a.overdue_cents), 7500);
    assert.equal(Number(a.draft_count), 1);
    assert.equal(a.last_payment_cents, 2500);
    assert.equal(Number(a.current_stays), 1);
    assert.equal(Number(a.horse_count), 1);
    assert.equal(Number(b.outstanding_cents), 7000);
    assert.equal(Number(b.overdue_cents), 0);
    assert.equal(Number(b.current_stays), 0);
    assert.equal(Number(b.horse_count), 1);
    assert.equal(b.last_payment_cents, null);
    assert.equal(Number(empty.outstanding_cents), 0);
    assert.equal(empty.portal_status, "Not linked");
    await db.query("delete from horse_customers where customer_id=$1", [
      customers[0].id,
    ]);
    const changed = (
      await db.query<Summary>(
        "select * from customer_overview() where customer_id=$1",
        [customers[0].id],
      )
    ).rows[0];
    assert.equal(Number(changed.horse_count), 0);
    assert.equal(Number(changed.current_stays), 1);
    assert.equal(Number(changed.outstanding_cents), 12500);
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select * from customer_overview()"),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});
