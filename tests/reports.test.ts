import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";

test("cash reports reconcile paid dates, corrections, unpaid balances, and empty months without row truncation", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec(`reset role;
      insert into public.customers(id,name) values('30000000-0000-4000-8000-000000000001','Report customer');
      insert into public.invoices(id,customer_id,status,issue_date,due_date,issued_total_cents) values
      ('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','issued','2025-12-01','2025-12-10',10000),
      ('30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','draft','2026-01-01','2026-01-10',90000);
      insert into public.invoice_payments(id,invoice_id,paid_on,amount_cents,method,reversed_at) values
      (gen_random_uuid(),'30000000-0000-4000-8000-000000000002','2026-01-01',3000,'cash',null),
      (gen_random_uuid(),'30000000-0000-4000-8000-000000000002','2026-01-31',2000,'cash',null),
      (gen_random_uuid(),'30000000-0000-4000-8000-000000000002','2025-12-31',1000,'cash',null),
      (gen_random_uuid(),'30000000-0000-4000-8000-000000000002','2026-01-15',500,'cash',now());
      insert into public.expenses(expense_date,paid_on,category_id,amount_cents)
      select '2025-12-01','2026-01-31',id,1 from public.expense_categories cross join generate_series(1,1001) where name='Feed';
      insert into public.expenses(expense_date,paid_on,category_id,amount_cents,voided_at)
      select '2026-01-01',null,id,9000,null from public.expense_categories where name='Feed';
      insert into public.expenses(expense_date,paid_on,category_id,amount_cents,voided_at)
      select '2026-01-01','2026-01-15',id,9000,now() from public.expense_categories where name='Feed';
    `);
    await login(db, adminId);
    const read = async (from: string, to: string) =>
      (
        await db.query<{ report: any }>(
          "select public.cash_report($1,$2) as report",
          [from, to],
        )
      ).rows[0].report;
    const r = await read("2026-01-01", "2026-02-28");
    assert.equal(r.received_cents, 5000);
    assert.equal(r.spent_cents, 1001);
    assert.equal(r.net_cents, 3999);
    assert.equal(r.outstanding_cents, 4000);
    assert.equal(r.overdue_cents, 4000);
    assert.equal(r.categories[0].expense_count, 1001);
    assert.equal(r.months.length, 2);
    assert.equal(r.months[1].received_cents, 0);
    assert.equal((await read("2026-02-01", "2026-02-28")).net_cents, 0);
    await assert.rejects(
      read("2026-02-01", "2026-01-01"),
      /valid reporting period/,
    );
    await assert.rejects(
      read("2000-01-01", "2026-01-01"),
      /valid reporting period/,
    );
    await db.exec(
      "reset role; update public.invoice_payments set reversed_at=now() where amount_cents=3000",
    );
    await login(db, adminId);
    assert.equal((await read("2026-01-01", "2026-01-31")).received_cents, 2000);
    await login(db, outsiderId);
    await assert.rejects(
      read("2026-01-01", "2026-01-31"),
      /Administrator access/,
    );
  } finally {
    await db.close();
  }
});
