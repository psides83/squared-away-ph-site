import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { allocationValues, splitAllocation } from "../src/lib/allocations.ts";
const ids = {
  customer: "40000000-0000-4000-8000-000000000001",
  a: "40000000-0000-4000-8000-000000000002",
  b: "40000000-0000-4000-8000-000000000003",
  own: "40000000-0000-4000-8000-000000000004",
  stay: "40000000-0000-4000-8000-000000000005",
  expense: "40000000-0000-4000-8000-000000000006",
  revision: "40000000-0000-4000-8000-000000000007",
  next: "40000000-0000-4000-8000-000000000008",
  invoice: "40000000-0000-4000-8000-000000000009",
};
test("allocation form validates actual days and preview reconciles pennies deterministically", () => {
  const form = new FormData();
  form.set("request_id", ids.revision);
  form.set("expense_id", ids.expense);
  form.set("period_from", "2026-01-01");
  form.set("period_to", "2026-01-31");
  form.set("reason", "Include own horse");
  form.set(`days_${ids.a}`, "31");
  form.set(`days_${ids.own}`, "0");
  assert.equal(allocationValues(form).p_rows.length, 1);
  form.set(`days_${ids.own}`, "32");
  assert.throws(() => allocationValues(form), /within the period/);
  form.set(`days_${ids.own}`, "1.5");
  assert.throws(() => allocationValues(form), /whole numbers/);
  const split = splitAllocation(
    10001,
    [ids.own, ids.b, ids.a].map((horse_id) => ({ horse_id, board_days: 1 })),
  );
  assert.equal(split.get(ids.a), 3334);
  assert.equal(split.get(ids.b), 3334);
  assert.equal(split.get(ids.own), 3333);
  assert.equal(
    [...split.values()].reduce((a, b) => a + b, 0),
    10001,
  );
  assert.equal(
    splitAllocation(0, [{ horse_id: ids.a, board_days: 1 }]).get(ids.a),
    0,
  );
});

test("shared-cost revisions retain approved board days, include own horses, and reconcile cash margins", async (t) => {
  const db = await inventoryDatabase();
  try {
    await db.exec(`reset role;
      insert into public.customers(id,name) values('${ids.customer}','Customer');
      insert into public.horses(id,barn_name) values('${ids.a}','Training A'),('${ids.b}','Training B'),('${ids.own}','My own horse');
      insert into public.training_stays(id,horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values
      ('${ids.stay}','${ids.a}','${ids.customer}','2026-01-01','2026-01-31',100000),
      (gen_random_uuid(),'${ids.b}','${ids.customer}','2026-01-16','2026-01-31',100000);
      insert into public.expenses(id,expense_date,paid_on,category_id,amount_cents)
        select '${ids.expense}','2026-01-15','2026-02-01',id,10001 from public.expense_categories where name='Hay';
      insert into public.expenses(expense_date,paid_on,category_id,amount_cents,horse_id)
        select '2026-01-15','2026-02-10',id,2000,'${ids.a}' from public.expense_categories where name='Vet';
      insert into public.expenses(expense_date,paid_on,category_id,amount_cents)
        select '2026-01-15','2026-02-10',id,5000 from public.expense_categories where name='Other';
      insert into public.expenses(expense_date,category_id,amount_cents)
        select '2026-01-15',id,90000 from public.expense_categories where name='Other';
      insert into public.invoices(id,customer_id,stay_id,status,issue_date,due_date,issued_total_cents) values
      ('${ids.invoice}','${ids.customer}','${ids.stay}','issued','2026-01-31','2026-02-01',100000),
      ('40000000-0000-4000-8000-000000000010','${ids.customer}',null,'issued','2026-01-31','2026-02-01',50000);
      insert into public.invoice_payments(id,invoice_id,paid_on,amount_cents,method) values
      (gen_random_uuid(),'${ids.invoice}','2026-02-05',100000,'cash'),
      (gen_random_uuid(),'40000000-0000-4000-8000-000000000010','2026-02-05',50000,'cash');
    `);
    await login(db, adminId);
    const basis = async () =>
      (
        await db.query<{
          horse_id: string;
          horse_name: string;
          board_days: number;
        }>(
          "select * from public.allocation_board_days('2026-01-01','2026-01-31')",
        )
      ).rows;
    const save = async (
      request: string,
      rows: { horse_id: string; board_days: number }[],
      reason = "Confirmed own horse and boarding days",
    ) =>
      db.query(
        "select public.save_expense_allocation($1,$2,'2026-01-01','2026-01-31',$3::jsonb,$4)",
        [request, ids.expense, JSON.stringify(rows), reason],
      );
    const report = async () =>
      (
        await db.query<{ r: any }>(
          "select public.horse_cash_report('2026-02-01','2026-02-28') r",
        )
      ).rows[0].r;
    const rows = [
      { horse_id: ids.a, board_days: 31 },
      { horse_id: ids.b, board_days: 16 },
      { horse_id: ids.own, board_days: 31 },
    ];
    await t.test(
      "defaults use inclusive physical days and own horses can be added without fake training stays",
      async () => {
        const b = await basis();
        assert.equal(b.find((h) => h.horse_id === ids.a)?.board_days, 31);
        assert.equal(b.find((h) => h.horse_id === ids.b)?.board_days, 16);
        assert.equal(b.find((h) => h.horse_id === ids.own)?.board_days, 0);
        await save(ids.revision, rows);
        const lines = (
          await db.query<{
            horse_id: string;
            amount_cents: number;
            training_days_snapshot: number;
          }>(
            "select * from public.expense_allocation_lines where allocation_id=$1",
            [ids.revision],
          )
        ).rows;
        const expected = splitAllocation(10001, rows);
        for (const line of lines)
          assert.equal(line.amount_cents, expected.get(line.horse_id));
        assert.equal(
          lines.find((l) => l.horse_id === ids.own)?.training_days_snapshot,
          0,
        );
      },
    );
    await t.test(
      "retries never duplicate, invalid revisions roll back, and allocated source amounts are protected",
      async () => {
        await save(ids.revision, rows);
        assert.equal(
          (await db.query("select * from public.expense_allocations")).rows
            .length,
          1,
        );
        await assert.rejects(
          save(ids.revision, rows, "Different reason"),
          /already used/,
        );
        await assert.rejects(
          save(ids.next, [{ horse_id: ids.a, board_days: 32 }]),
          /fit the period/,
        );
        await assert.rejects(
          save(ids.next, [
            { horse_id: ids.a, board_days: 1 },
            { horse_id: ids.a, board_days: 1 },
          ]),
          /appear once/,
        );
        await assert.rejects(
          db.query(
            "select public.save_expense_allocation($1,$2,'2026-02-01','2026-01-01',$3,'bad')",
            [ids.next, ids.expense, JSON.stringify(rows)],
          ),
          /elapsed allocation/,
        );
        assert.equal(
          (
            await db.query(
              "select * from public.expense_allocations where retired_at is null",
            )
          ).rows.length,
          1,
        );
        await db.exec("reset role");
        await assert.rejects(
          db.query(
            "update public.expenses set amount_cents=20000 where id=$1",
            [ids.expense],
          ),
          /Clear the shared-cost/,
        );
        await assert.rejects(
          db.query("update public.expenses set voided_at=now() where id=$1", [
            ids.expense,
          ]),
          /Clear the shared-cost/,
        );
        await db.query(
          "update public.expenses set paid_on='2026-02-02' where id=$1",
          [ids.expense],
        );
        await db.query(
          "update public.training_stays set departure_date='2026-02-01' where id=$1",
          [ids.stay],
        );
        await assert.rejects(
          db.query("update public.training_stays set horse_id=$1 where id=$2", [
            ids.own,
            ids.stay,
          ]),
          /cannot be reassigned/,
        );
        await login(db, adminId);
        assert.equal(
          (
            await db.query<{ n: number }>(
              "select board_days as n from public.expense_allocation_lines where allocation_id=$1 and horse_id=$2",
              [ids.revision, ids.a],
            )
          ).rows[0].n,
          31,
        );
      },
    );
    await t.test(
      "horse margins reconcile to business profit with manual invoice revenue and unallocated costs visible",
      async () => {
        const r = await report();
        const cash = (
          await db.query<{ r: any }>(
            "select public.cash_report('2026-02-01','2026-02-28') r",
          )
        ).rows[0].r;
        assert.equal(r.unassigned_received_cents, 50000);
        assert.equal(r.unallocated_paid_cents, 5000);
        assert.equal(
          r.horses.reduce((sum: number, h: any) => sum + h.shared_cents, 0),
          10001,
        );
        assert.equal(
          r.horses.reduce((sum: number, h: any) => sum + h.margin_cents, 0) +
            r.unassigned_received_cents -
            r.unallocated_paid_cents,
          cash.net_cents,
        );
        const january = (
          await db.query<{ r: any }>(
            "select public.horse_cash_report('2026-01-01','2026-01-31') r",
          )
        ).rows[0].r;
        assert.equal(
          january.horses.reduce(
            (sum: number, h: any) => sum + h.shared_cents,
            0,
          ),
          0,
        );
      },
    );
    await t.test(
      "replacement and clearing preserve history and never count both revisions",
      async () => {
        await save(
          ids.next,
          [ids.a, ids.b, ids.own].map((horse_id) => ({
            horse_id,
            board_days: 1,
          })),
          "Corrected board days",
        );
        const lines = (
          await db.query<{ horse_id: string; amount_cents: number }>(
            "select horse_id,amount_cents from public.expense_allocation_lines where allocation_id=$1 order by horse_id",
            [ids.next],
          )
        ).rows;
        assert.deepEqual(
          lines.map((l) => l.amount_cents),
          [3334, 3334, 3333],
        );
        assert.equal(
          (
            await db.query(
              "select * from public.expense_allocations where retired_at is not null",
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (await report()).horses.reduce(
            (sum: number, h: any) => sum + h.shared_cents,
            0,
          ),
          10001,
        );
        await db.query(
          "select public.clear_expense_allocation($1,'Correct source amount')",
          [ids.expense],
        );
        await db.query(
          "select public.clear_expense_allocation($1,'Repeated clear')",
          [ids.expense],
        );
        assert.equal(
          (await db.query("select * from public.expense_allocation_lines")).rows
            .length,
          6,
        );
        assert.equal((await report()).unallocated_paid_cents, 15001);
        await db.exec("reset role");
        await db.query(
          "update public.expenses set amount_cents=20000 where id=$1",
          [ids.expense],
        );
        await login(db, adminId);
        assert.equal((await report()).unallocated_paid_cents, 25000);
      },
    );
    await t.test(
      "administrator records are private and direct edits cannot bypass allocation safeguards",
      async () => {
        await assert.rejects(
          db.query("delete from public.expense_allocation_lines"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("update public.expense_allocations set retired_at=null"),
          /permission denied/,
        );
        await login(db, outsiderId);
        assert.equal(
          (await db.query("select * from public.expense_allocations")).rows
            .length,
          0,
        );
        assert.equal(
          (await db.query("select * from public.expense_allocation_lines")).rows
            .length,
          0,
        );
        await assert.rejects(report(), /Administrator access/);
        await assert.rejects(basis(), /Administrator access/);
        await assert.rejects(
          save(crypto.randomUUID(), rows),
          /Administrator access/,
        );
        await assert.rejects(
          db.query(
            "select public.clear_expense_allocation($1,'unauthorized')",
            [ids.expense],
          ),
          /Administrator access/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
