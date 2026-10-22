import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("horse billing overview uses assigned invoices, remaining balances, and strict past-due dates", async () => {
  const db = await inventoryDatabase();
  try {
    const date = (
      await db.query<{ value: string }>(
        "select ((now() at time zone 'America/Chicago')::date)::text as value",
      )
    ).rows[0].value;
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Shared owner') returning id",
      )
    ).rows[0].id;
    const horses = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('First'),('Second'),('No activity') returning id",
      )
    ).rows;
    for (const h of horses)
      await db.query(
        "insert into horse_customers(horse_id,customer_id) values($1,$2)",
        [h.id, customer],
      );
    const stay = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,'2026-01-01','2026-01-05',0) returning id",
        [horses[0].id, customer],
      )
    ).rows[0].id;
    async function invoice(
      amount: number,
      due: string,
      horse: string | null,
      stayId: string | null = null,
      draft = false,
    ) {
      const id = crypto.randomUUID();
      await db.query("select create_invoice($1,$2,$3,'2026-01-01',$4,$5,$6)", [
        id,
        customer,
        stayId,
        due,
        stayId ? "2026-01-01" : null,
        stayId ? "2026-01-05" : null,
      ]);
      await db.query("select add_invoice_line($1,$2,'Training bill',$3)", [
        crypto.randomUUID(),
        id,
        amount,
      ]);
      if (horse && !stayId)
        await db.query(
          "select set_invoice_reporting_link($1,$2,$3,null,'Assigned to horse')",
          [crypto.randomUUID(), id, horse],
        );
      if (!draft) await db.query("select finalize_invoice($1)", [id]);
      return id;
    }
    const overdue = await invoice(10000, "2026-01-02", horses[0].id, stay);
    await db.query("select record_invoice_payment($1,$2,2500,$3,'cash')", [
      crypto.randomUUID(),
      overdue,
      date,
    ]);
    const dueToday = await invoice(5000, date, horses[0].id);
    await invoice(99999, "2026-01-02", horses[0].id, null, true);
    const voided = await invoice(99999, "2026-01-02", horses[0].id);
    await db.query("select void_invoice($1,'Created by mistake')", [voided]);
    const paid = await invoice(1000, "2026-01-02", horses[0].id);
    await db.query("select record_invoice_payment($1,$2,1000,$3,'cash')", [
      crypto.randomUUID(),
      paid,
      date,
    ]);
    await invoice(90000, "2026-01-02", null);
    await invoice(7000, "2026-01-02", horses[1].id);
    await db.query(
      "insert into training_entries(horse_id,kind,entry_date,title,notes) values($1,'session','2026-01-02','Roping','Notes'),($1,'note','2026-01-03','Newer note','Notes')",
      [horses[0].id],
    );
    type Status = {
      horse_id: string;
      outstanding_cents: number;
      overdue_cents: number;
      training_title: string | null;
      last_fed: unknown;
      bills: { id: string }[];
    };
    const rows = (await db.query<Status>("select * from horse_overview()"))
      .rows;
    const first = rows.find((r) => r.horse_id === horses[0].id)!;
    assert.equal(Number(first.outstanding_cents), 12500);
    assert.equal(Number(first.overdue_cents), 7500);
    assert.deepEqual(
      new Set(first.bills.map((b) => b.id)),
      new Set([overdue, dueToday]),
    );
    assert.equal(first.training_title, "Roping");
    assert.equal(first.last_fed, null);
    assert.equal(
      Number(rows.find((r) => r.horse_id === horses[1].id)!.outstanding_cents),
      7000,
    );
    assert.equal(
      Number(rows.find((r) => r.horse_id === horses[2].id)!.outstanding_cents),
      0,
    );
    await db.query("delete from horse_customers where horse_id=$1", [
      horses[0].id,
    ]);
    assert.equal(
      Number(
        (
          await db.query<Status>(
            "select * from horse_overview() where horse_id=$1",
            [horses[0].id],
          )
        ).rows[0].outstanding_cents,
      ),
      12500,
    );
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select * from horse_overview()"),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});
