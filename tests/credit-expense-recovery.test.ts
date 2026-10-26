import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { recoveryAssignmentValues } from "../src/lib/recovery-assignment.ts";
test("recovery inputs distinguish actual payments from applied credit and reject malformed sources", () => {
  const f = new FormData();
  const id = crypto.randomUUID();
  for (const [k, v] of Object.entries({
    payment_id: id,
    request_id: crypto.randomUUID(),
    expense_id: crypto.randomUUID(),
    amount: "12.34",
    reason: "Designated recovery",
  }))
    f.set(k, v);
  assert.equal(recoveryAssignmentValues(f).kind, "payment");
  f.set("payment_id", `credit:${id}`);
  assert.equal(recoveryAssignmentValues(f).source, id);
  assert.equal(recoveryAssignmentValues(f).kind, "credit");
  assert.equal(recoveryAssignmentValues(f).values.p_cents, 1234);
  f.set("payment_id", `bogus:${id}`);
  assert.throws(() => recoveryAssignmentValues(f), /valid record/);
  f.set("payment_id", id);
  f.set("amount", "0");
  assert.throws(() => recoveryAssignmentValues(f), /positive/);
});
async function fixture() {
  const db = await inventoryDatabase();
  const customer = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Credit recovery customer') returning id",
    )
  ).rows[0].id;
  const horse = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Recovery horse') returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into horse_customers(horse_id,customer_id) values($1,$2)",
    [horse, customer],
  );
  const category = (
    await db.query<{ id: string }>(
      "select id from expense_categories where name='Vet'",
    )
  ).rows[0].id;
  const expense = async (amount: number, paid: string | null = "2020-01-10") =>
    (
      await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
        {
          expense_date: "2020-01-01",
          paid_on: paid,
          category_id: category,
          horse_id: horse,
          amount_cents: amount,
          reimbursable: true,
          vendor: "Vet",
        },
        crypto.randomUUID(),
      ])
    ).rows[0].id;
  const e1 = await expense(10000),
    e2 = await expense(2000),
    unlinked = await expense(1000),
    unpaid = await expense(500, null);
  const invoice = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,null,'2020-02-01','2020-02-10',null,null)",
    [invoice, customer],
  );
  for (const e of [e1, e2, unpaid])
    await db.query("select add_expense_chargeback($1,$2,0)", [invoice, e]);
  await db.query("select add_invoice_line($1,$2,'Training',10000)", [
    crypto.randomUUID(),
    invoice,
  ]);
  await db.query("select finalize_invoice($1)", [invoice]);
  const credit = crypto.randomUUID(),
    application = crypto.randomUUID(),
    payment = crypto.randomUUID();
  await db.query(
    "select record_customer_credit($1,$2,'advance',null,15000,'2020-01-20','cash','Future training',null)",
    [credit, customer],
  );
  await db.query("select apply_customer_credit($1,$2,$3,8000,'2020-02-02')", [
    application,
    credit,
    invoice,
  ]);
  await db.query(
    "select record_invoice_payment($1,$2,10000,'2020-02-03','cash')",
    [payment, invoice],
  );
  const assign = (
    id: string,
    expense: string,
    amount: number,
    current: string | null = null,
  ) =>
    db.query("select assign_expense_credit($1,$2,$3,$4,$5,'Chosen recovery')", [
      id,
      current,
      application,
      expense,
      amount,
    ]);
  const cash = (
    id: string,
    expense: string,
    amount: number,
    current: string | null = null,
  ) =>
    db.query(
      "select assign_expense_payment($1,$2,$3,$4,$5,'Chosen recovery')",
      [id, current, payment, expense, amount],
    );
  const report = async () =>
    (
      await db.query<{
        r: {
          totals: {
            recovered_cents: number;
            cash_recovered_cents: number;
            credit_recovered_cents: number;
            not_recovered_cents: number;
            paid_cost_cents: number;
          };
          expenses: {
            id: string;
            recovered_cents: number;
            credit_recovered_cents: number;
          }[];
        };
      }>("select expense_recovery_report('2020-01-01','2020-01-31') r")
    ).rows[0].r;
  const overview = async () =>
    (
      await db.query<{
        r: {
          payments: {
            id: string;
            source_kind: string;
            available_cents: number;
          }[];
          assignments: {
            id: string;
            credit_application_id: string | null;
            source_kind: string;
            counted: boolean;
            retired_at: string | null;
          }[];
        };
      }>("select invoice_expense_recovery($1) r", [invoice])
    ).rows[0].r;
  return {
    db,
    customer,
    invoice,
    credit,
    application,
    payment,
    e1,
    e2,
    unpaid,
    unlinked,
    assign,
    cash,
    report,
    overview,
  };
}
test("cash and applied credit share original-cost caps; unused credit and fees are never assumed recovered", async () => {
  const f = await fixture();
  try {
    const {
      db,
      e1,
      e2,
      unpaid,
      unlinked,
      assign,
      cash,
      report,
      overview,
      application,
      payment,
    } = f;
    const creditId = crypto.randomUUID(),
      cashId = crypto.randomUUID();
    await assign(creditId, e1, 6000);
    await assign(creditId, e1, 6000);
    await assert.rejects(assign(creditId, e1, 6001), /already used/);
    await assert.rejects(assign(crypto.randomUUID(), e1, 1), /changed/);
    await assert.rejects(assign(crypto.randomUUID(), unlinked, 1), /no linked/);
    await cash(cashId, e1, 4000);
    await assert.rejects(
      cash(crypto.randomUUID(), e1, 4001, cashId),
      /unrecovered/,
    );
    await assert.rejects(
      assign(crypto.randomUUID(), e1, 6001, creditId),
      /unrecovered/,
    );
    await assign(crypto.randomUUID(), e2, 2000);
    await assert.rejects(assign(crypto.randomUUID(), unpaid, 1), /unassigned/);
    const r = await report();
    assert.equal(r.totals.paid_cost_cents, 13000);
    assert.equal(r.totals.recovered_cents, 12000);
    assert.equal(r.totals.cash_recovered_cents, 4000);
    assert.equal(r.totals.credit_recovered_cents, 8000);
    assert.equal(r.totals.not_recovered_cents, 1000);
    const o = await overview();
    assert.equal(
      o.payments.find((p) => p.id === application)?.available_cents,
      0,
    );
    assert.equal(
      o.payments.find((p) => p.id === payment)?.available_cents,
      6000,
    );
    assert.equal(
      o.assignments.find((a) => a.id === creditId)?.source_kind,
      "credit",
    );
    const cashReport = (
      await db.query<{ r: { received_cents: number } }>(
        "select cash_report('2020-01-01','2020-02-28') r",
      )
    ).rows[0].r;
    assert.equal(cashReport.received_cents, 25000);
    const totals = (
      await db.query<{ balance_cents: number; paid_cents: number }>(
        "select balance_cents,paid_cents from invoice_totals where id=$1",
        [f.invoice],
      )
    ).rows[0];
    assert.deepEqual(totals, { balance_cents: 4500, paid_cents: 18000 });
  } finally {
    await f.db.close();
  }
});
test("credit assignment replacement/removal retains history and late retries never recreate retired entries", async () => {
  const f = await fixture();
  try {
    const id = crypto.randomUUID(),
      next = crypto.randomUUID();
    await f.assign(id, f.e1, 5000);
    await assert.rejects(f.assign(crypto.randomUUID(), f.e1, 4000), /changed/);
    await f.assign(next, f.e1, 4000, id);
    await f.assign(id, f.e1, 5000);
    assert.equal((await f.report()).totals.recovered_cents, 4000);
    let o = await f.overview();
    assert.equal(o.assignments.length, 2);
    assert.equal(o.assignments.filter((a) => a.counted).length, 1);
    await f.db.query("select clear_expense_payment($1,'Wrong designation')", [
      next,
    ]);
    await f.db.query("select clear_expense_payment($1,'Repeated click')", [
      next,
    ]);
    await f.assign(next, f.e1, 4000, id);
    assert.equal((await f.report()).totals.recovered_cents, 0);
    o = await f.overview();
    assert.equal(
      o.payments.find((p) => p.id === f.application)?.available_cents,
      8000,
    );
    assert.equal(o.assignments.filter((a) => a.counted).length, 0);
    await assert.rejects(
      f.assign(crypto.randomUUID(), f.e1, 4000, id),
      /changed/,
    );
  } finally {
    await f.db.close();
  }
});
test("reversing a credit application stops its recovery while preserving assignment history and cash dates", async () => {
  const f = await fixture();
  try {
    const id = crypto.randomUUID();
    await f.assign(id, f.e1, 6000);
    await f.cash(crypto.randomUUID(), f.e1, 2000);
    await f.db.query(
      "select reverse_customer_credit($1,true,'Wrong invoice')",
      [f.application],
    );
    assert.equal((await f.report()).totals.recovered_cents, 2000);
    assert.equal((await f.report()).totals.credit_recovered_cents, 0);
    assert.equal(
      (await f.overview()).assignments.find((a) => a.id === id)?.counted,
      false,
    );
    await assert.rejects(
      f.assign(crypto.randomUUID(), f.e1, 1, id),
      /active applied credit/,
    );
    await f.assign(id, f.e1, 6000);
    assert.equal((await f.report()).totals.recovered_cents, 2000);
    await f.db.query(
      "select reverse_customer_credit($1,false,'Wrong advance')",
      [f.credit],
    );
    const cash = (
      await f.db.query<{ r: { received_cents: number } }>(
        "select cash_report('2020-01-01','2020-02-28') r",
      )
    ).rows[0].r;
    assert.equal(cash.received_cents, 10000);
    await login(f.db, outsiderId);
    assert.equal(
      (await f.db.query("select * from expense_payment_assignments")).rows
        .length,
      0,
    );
    await assert.rejects(
      f.assign(crypto.randomUUID(), f.e1, 1),
      /Administrator/,
    );
    await assert.rejects(
      f.db.query("select * from expense_recovery_entries"),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("select invoice_expense_recovery($1)", [f.invoice]),
      /Administrator/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(
      f.assign(crypto.randomUUID(), f.e1, 1),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});
