import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("manual recovery uses real payments with source/payment caps, revision history and no double-counted cash", async () => {
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
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Vet'",
      )
    ).rows[0].id;
    async function expense(amount: number, paid: string | null = "2020-01-10") {
      return (
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
    }
    const e1 = await expense(10000),
      e2 = await expense(3000),
      unpaid = await expense(500, null),
      other = await expense(2000);
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2020-02-01','2020-02-08',null,null)",
      [invoice, customer],
    );
    await db.query("select add_expense_chargeback($1,$2,1000)", [invoice, e1]);
    await db.query("select add_expense_chargeback($1,$2,0)", [invoice, e2]);
    await db.query("select add_invoice_line($1,$2,'Training',9000)", [
      crypto.randomUUID(),
      invoice,
    ]);
    await db.query("select finalize_invoice($1)", [invoice]);
    const payment = crypto.randomUUID();
    await db.query(
      "select record_invoice_payment($1,$2,8000,'2020-02-02','cash')",
      [payment, invoice],
    );
    async function assign(
      req: string,
      current: string | null,
      paid: string,
      expense: string,
      cents: number,
    ) {
      return db.query(
        "select assign_expense_payment($1,$2,$3,$4,$5,'Customer designated reimbursement')",
        [req, current, paid, expense, cents],
      );
    }
    const first = crypto.randomUUID();
    await assign(first, null, payment, e1, 6000);
    await assign(first, null, payment, e1, 6000);
    await assert.rejects(
      assign(first, null, payment, e1, 6001),
      /already used/,
    );
    await assert.rejects(
      assign(crypto.randomUUID(), null, payment, e1, 100),
      /changed/,
    );
    await assign(crypto.randomUUID(), null, payment, e2, 2000);
    await assert.rejects(
      assign(crypto.randomUUID(), null, payment, other, 1),
      /no linked/,
    );
    await assert.rejects(
      assign(crypto.randomUUID(), first, payment, e1, 6001),
      /unassigned/,
    );
    async function report(from = "2020-01-01", to = "2020-01-31") {
      return (
        await db.query<{
          r: {
            totals: {
              paid_cost_cents: number;
              recovered_cents: number;
              not_recovered_cents: number;
              issued_cost_cents: number;
              issued_fee_cents: number;
              unbilled_cost_cents: number;
            };
            count: number;
            expenses: { id: string; recovered_cents: number }[];
          };
        }>("select expense_recovery_report($1,$2) r", [from, to])
      ).rows[0].r;
    }
    let r = await report();
    assert.equal(r.totals.paid_cost_cents, 15000);
    assert.equal(r.totals.issued_cost_cents, 13000);
    assert.equal(r.totals.issued_fee_cents, 1000);
    assert.equal(r.totals.unbilled_cost_cents, 2000);
    assert.equal(r.totals.recovered_cents, 8000);
    assert.equal(r.totals.not_recovered_cents, 7000);
    assert.equal(r.count, 3);
    assert.ok(!r.expenses.some((e) => e.id === unpaid));
    assert.equal(
      (await report("2020-02-01", "2020-02-28")).totals.paid_cost_cents,
      0,
    );
    const cash = (
      await db.query<{ r: { business: { received_cents: number } } }>(
        "select financial_report_bundle('2020-02-01','2020-02-28') r",
      )
    ).rows[0].r.business.received_cents;
    assert.equal(cash, 8000);
    const replacement = crypto.randomUUID();
    await assign(replacement, first, payment, e1, 5000);
    assert.equal((await report()).totals.recovered_cents, 7000);
    await assert.rejects(
      assign(crypto.randomUUID(), first, payment, e1, 4000),
      /changed/,
    );
    await db.query("select clear_expense_payment($1,'Correct attribution')", [
      replacement,
    ]);
    await db.query("select clear_expense_payment($1,'Correct attribution')", [
      replacement,
    ]);
    assert.equal((await report()).totals.recovered_cents, 2000);
    const p2 = crypto.randomUUID();
    await db.query(
      "select record_invoice_payment($1,$2,11000,'2020-02-03','cash')",
      [p2, invoice],
    );
    await assert.rejects(
      assign(crypto.randomUUID(), null, p2, e1, 10001),
      /original expense/,
    );
    await assign(crypto.randomUUID(), null, p2, e1, 10000);
    await assert.rejects(
      assign(crypto.randomUUID(), null, p2, e2, 1001),
      /unassigned|original expense/,
    );
    await db.query(
      "select reverse_invoice_payment($1,'Payment entered incorrectly')",
      [p2],
    );
    assert.equal((await report()).totals.recovered_cents, 2000);
    const source = (
      await db.query<{
        r: { assignments: { counted: boolean; retired_at: string | null }[] };
      }>("select invoice_expense_recovery($1) r", [invoice])
    ).rows[0].r;
    assert.ok(source.assignments.some((a) => !a.counted && !a.retired_at));
    await assert.rejects(
      assign(crypto.randomUUID(), null, p2, e1, 1),
      /active payment/,
    );
    await assert.rejects(
      db.query("update expense_payment_assignments set amount_cents=1"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select expense_recovery_report('2020-02-01','2020-01-01')"),
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from expense_payment_assignments")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select expense_recovery_report('2020-01-01','2020-01-31')"),
      /Administrator/,
    );
    await assert.rejects(
      assign(crypto.randomUUID(), null, payment, e1, 1),
      /Administrator/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select invoice_expense_recovery($1)", [invoice]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("recovery report separates boarding portions on drafts and issued invoices and bounds detail without truncating totals", async () => {
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
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Boarding / facility'",
      )
    ).rows[0].id;
    const expense = (
      await db.query<{ id: string }>("select save_expense(null,$1) id", [
        {
          expense_date: "2020-01-15",
          paid_on: "2020-01-16",
          category_id: category,
          horse_id: horse,
          amount_cents: 20000,
          reimbursable: false,
        },
      ])
    ).rows[0].id;
    const stays: string[] = [];
    for (const [from, to] of [
      ["2020-01-01", "2020-01-31"],
      ["2020-02-01", "2020-02-29"],
    ])
      stays.push(
        (
          await db.query<{ id: string }>(
            "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,boarding_billing) values($1,$2,$3,$4,0,'at_cost') returning id",
            [horse, customer, from, to],
          )
        ).rows[0].id,
      );
    const split = crypto.randomUUID();
    await db.query(
      "select save_cost_stay_split($1,$2,null,$3,$4,'Reviewed costs')",
      [
        split,
        expense,
        horse,
        [
          { stay_id: stays[0], amount_cents: 6000 },
          { stay_id: stays[1], amount_cents: 4000 },
        ],
      ],
    );
    const invoices: string[] = [];
    for (let n = 0; n < 2; n++) {
      const id = crypto.randomUUID();
      invoices.push(id);
      await db.query("select create_invoice($1,$2,$3,$4,$4,$5,$4)", [
        id,
        customer,
        stays[n],
        n === 0 ? "2020-01-31" : "2020-02-29",
        n === 0 ? "2020-01-01" : "2020-02-01",
      ]);
      await db.query("select add_actual_boarding($1,$2)", [id, split]);
    }
    await db.query("select finalize_invoice($1)", [invoices[1]]);
    const payment = crypto.randomUUID();
    await db.query(
      "select record_invoice_payment($1,$2,4000,'2020-03-01','cash')",
      [payment, invoices[1]],
    );
    await db.query(
      "select assign_expense_payment($1,null,$2,$3,4000,'Designated boarding reimbursement')",
      [crypto.randomUUID(), payment, expense],
    );
    async function report() {
      return (
        await db.query<{
          r: {
            totals: {
              issued_cost_cents: number;
              draft_cost_cents: number;
              unbilled_cost_cents: number;
              recovered_cents: number;
              paid_cost_cents: number;
            };
            count: number;
            expenses: unknown[];
          };
        }>("select expense_recovery_report('2020-01-01','2020-01-31') r")
      ).rows[0].r;
    }
    let r = await report();
    assert.equal(r.totals.issued_cost_cents, 4000);
    assert.equal(r.totals.draft_cost_cents, 6000);
    assert.equal(r.totals.unbilled_cost_cents, 10000);
    assert.equal(r.totals.recovered_cents, 4000);
    await db.query("select reverse_invoice_payment($1,'Incorrect payment')", [
      payment,
    ]);
    await db.query("select void_invoice($1,'Wrong bill')", [invoices[1]]);
    r = await report();
    assert.equal(r.totals.issued_cost_cents, 0);
    assert.equal(r.totals.recovered_cents, 0);
    assert.equal(r.totals.unbilled_cost_cents, 14000);
    // Trusted fixture adds enough paid costs to exercise the detail cap.
    await db.exec("reset role");
    await db.query(
      "insert into expenses(expense_date,paid_on,category_id,amount_cents) select '2020-01-01','2020-01-02',$1,100 from generate_series(1,101)",
      [category],
    );
    await login(db, "20000000-0000-4000-8000-000000000001");
    r = await report();
    assert.equal(r.count, 102);
    assert.equal(r.expenses.length, 100);
    assert.equal(r.totals.paid_cost_cents, 30100);
  } finally {
    await db.close();
  }
});
