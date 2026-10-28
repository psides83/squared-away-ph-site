import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { expenseAbsorptionValues } from "../src/lib/expense-absorption.ts";
test("absorbed-cost input requires positive cents or an explicit removal with a reason", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    expense_id: crypto.randomUUID(),
    amount: "12.34",
    reason: "Business courtesy",
  }))
    f.set(k, v);
  assert.equal(expenseAbsorptionValues(f).p_cents, 1234);
  f.set("amount", "0");
  assert.throws(() => expenseAbsorptionValues(f), /positive/);
  f.set("amount", "1.001");
  assert.throws(() => expenseAbsorptionValues(f));
  f.set("remove", "yes");
  assert.equal(expenseAbsorptionValues(f).p_cents, 0);
  f.set("reason", " ");
  assert.throws(() => expenseAbsorptionValues(f));
});
async function fixture() {
  const db = await inventoryDatabase();
  const customer = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Absorbed customer') returning id",
    )
  ).rows[0].id;
  const horse = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Absorbed horse') returning id",
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
    await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
      {
        expense_date: "2020-01-10",
        paid_on: "2020-01-10",
        category_id: category,
        horse_id: horse,
        amount_cents: 10000,
        reimbursable: true,
        vendor: "Facility",
      },
      crypto.randomUUID(),
    ])
  ).rows[0].id;
  const invoice = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,null,'2020-02-01','2020-02-10',null,null)",
    [invoice, customer],
  );
  const set = (
    request: string,
    current: string | null,
    amount: number,
    reason = "Business courtesy",
  ) =>
    db.query("select set_expense_absorption($1,$2,$3,$4,$5)", [
      request,
      current,
      expense,
      amount,
      reason,
    ]);
  const report = async () =>
    (
      await db.query<{ r: any }>(
        "select expense_recovery_report('2020-01-01','2020-01-31') r",
      )
    ).rows[0].r;
  const follow = async () =>
    (
      await db.query<{ r: any[] }>(
        "select expense_followup(array[$1::uuid]) r",
        [expense],
      )
    ).rows[0].r[0];
  return {
    db,
    customer,
    horse,
    category,
    expense,
    invoice,
    set,
    report,
    follow,
  };
}
test("partial absorption protects remaining cost, fee snapshots, and cash/credit recovery caps", async () => {
  const f = await fixture();
  try {
    const { db, expense, invoice, set, report, follow } = f;
    const absorption = crypto.randomUUID();
    await set(absorption, null, 3000);
    const before = (
      await db.query<{ r: any }>(
        "select cash_report('2020-01-01','2020-02-28') r",
      )
    ).rows[0].r;
    let r = await report();
    assert.equal(r.totals.absorbed_cost_cents, 3000);
    assert.equal(r.totals.undecided_cost_cents, 7000);
    assert.equal(r.totals.unbilled_reimbursable_cents, 7000);
    const line = (
      await db.query<{ id: string }>(
        "select add_expense_chargeback($1,$2,500) id",
        [invoice, expense],
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select add_expense_chargeback($1,$2,500) id",
          [invoice, expense],
        )
      ).rows[0].id,
      line,
    );
    const l = (
      await db.query<{ amount_cents: number; source_snapshot: any }>(
        "select * from invoice_lines where id=$1",
        [line],
      )
    ).rows[0];
    assert.equal(l.amount_cents, 7500);
    assert.equal(l.source_snapshot.original_cost_cents, 7000);
    assert.equal(l.source_snapshot.absorbed_cost_cents, 3000);
    assert.equal((await follow()).draft_cost_cents, 7000);
    assert.equal((await follow()).absorbed_cost_cents, 3000);
    assert.equal((await follow()).unassigned_cost_cents, 0);
    r = await report();
    assert.equal(r.totals.draft_cost_cents, 7000);
    assert.equal(r.totals.unbilled_cost_cents, 3000);
    assert.equal(r.totals.undecided_cost_cents, 0);
    await assert.rejects(
      set(crypto.randomUUID(), absorption, 3001),
      /already reserved/,
    );
    await db.query("select finalize_invoice($1)", [invoice]);
    const payment = crypto.randomUUID();
    await db.query(
      "select record_invoice_payment($1,$2,7500,'2020-02-02','cash')",
      [payment, invoice],
    );
    await assert.rejects(
      db.query("select assign_expense_payment($1,null,$2,$3,7001,'Recovery')", [
        crypto.randomUUID(),
        payment,
        expense,
      ]),
      /unrecovered/,
    );
    await db.query(
      "select assign_expense_payment($1,null,$2,$3,7000,'Recovery')",
      [crypto.randomUUID(), payment, expense],
    );
    r = await report();
    assert.equal(r.totals.issued_cost_cents, 7000);
    assert.equal(r.totals.issued_fee_cents, 500);
    assert.equal(r.totals.recovered_cents, 7000);
    assert.equal(r.totals.not_recovered_cents, 3000);
    // Clearing the designation does not silently change an issued invoice or its recovery cap.
    await set(crypto.randomUUID(), absorption, 0, "Explicit removal");
    assert.equal((await report()).totals.issued_cost_cents, 7000);
    const after = (
      await db.query<{ r: any }>(
        "select cash_report('2020-01-01','2020-02-28') r",
      )
    ).rows[0].r;
    assert.equal(after.spent_cents, before.spent_cents);
    assert.equal(after.received_cents, 7500);
  } finally {
    await f.db.close();
  }
});
test("absorption revisions retain history, reject stale requests, and block full absorption billing and unsafe expense edits", async () => {
  const f = await fixture();
  try {
    const { db, set, expense, invoice } = f;
    const first = crypto.randomUUID(),
      second = crypto.randomUUID(),
      removed = crypto.randomUUID();
    await set(first, null, 10000);
    await set(first, null, 10000);
    await assert.rejects(set(first, null, 9999), /already used/);
    await assert.rejects(set(crypto.randomUUID(), null, 4000), /changed/);
    await assert.rejects(
      db.query("select add_expense_chargeback($1,$2,0)", [invoice, expense]),
      /fully absorbed/,
    );
    await assert.rejects(
      db.query("select save_expense($1,$2,$3)", [
        expense,
        {
          expense_date: "2020-01-10",
          paid_on: "2020-01-10",
          category_id: f.category,
          horse_id: f.horse,
          amount_cents: 9999,
          reimbursable: true,
          vendor: "Facility",
        },
        crypto.randomUUID(),
      ]),
      /absorbed/,
    );
    await assert.rejects(
      db.query("select set_expense_status($1,'2020-01-10',true)", [expense]),
      /absorbed/,
    );
    await set(second, first, 2500);
    await set(first, null, 10000);
    assert.equal((await f.report()).totals.absorbed_cost_cents, 2500);
    await set(removed, second, 0, "Removed deliberately");
    await set(second, first, 2500);
    assert.equal((await f.report()).totals.absorbed_cost_cents, 0);
    assert.equal(
      (
        await db.query(
          "select * from expense_absorptions where expense_id=$1",
          [expense],
        )
      ).rows.length,
      3,
    );
    await assert.rejects(set(crypto.randomUUID(), second, 100), /changed/);
    await assert.rejects(
      set(crypto.randomUUID(), removed, -1),
      /valid absorbed/,
    );
    await assert.rejects(
      set(crypto.randomUUID(), removed, 10001),
      /already reserved/,
    );
    await db.query("select add_expense_chargeback($1,$2,0)", [
      invoice,
      expense,
    ]);
    await assert.rejects(
      set(crypto.randomUUID(), removed, 1),
      /already reserved/,
    );
  } finally {
    await f.db.close();
  }
});
test("actual-cost boarding cannot reserve absorbed portions; rejected billing is atomic", async () => {
  const f = await fixture();
  try {
    const { db, set, expense, customer, horse } = f;
    const stay = crypto.randomUUID(),
      split = crypto.randomUUID(),
      invoice = crypto.randomUUID();
    await db.query(
      "insert into training_stays(id,horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,boarding_billing) values($1,$2,$3,'2020-01-01','2020-01-31',0,'at_cost')",
      [stay, horse, customer],
    );
    await db.query(
      "select create_invoice($1,$2,$3,'2020-02-01','2020-02-10','2020-01-01','2020-01-31')",
      [invoice, customer, stay],
    );
    await db.query(
      "select save_cost_stay_split($1,$2,null,$3,$4::jsonb,'Reviewed cost')",
      [
        split,
        expense,
        horse,
        JSON.stringify([{ stay_id: stay, amount_cents: 8000 }]),
      ],
    );
    const absorbed = crypto.randomUUID();
    await set(absorbed, null, 3000);
    await assert.rejects(
      db.query("select add_actual_boarding($1,$2)", [invoice, split]),
      /absorbed/,
    );
    assert.equal(
      (
        await db.query("select * from invoice_lines where invoice_id=$1", [
          invoice,
        ])
      ).rows.length,
      0,
    );
    const revised = crypto.randomUUID();
    await db.query(
      "select save_cost_stay_split($1,$2,null,$3,$4::jsonb,'Reduced to billable portion')",
      [
        revised,
        expense,
        horse,
        JSON.stringify([{ stay_id: stay, amount_cents: 7000 }]),
      ],
    );
    await db.query("select add_actual_boarding($1,$2)", [invoice, revised]);
    await assert.rejects(
      set(crypto.randomUUID(), absorbed, 3001),
      /already reserved/,
    );
    assert.equal((await f.report()).totals.draft_cost_cents, 7000);
  } finally {
    await f.db.close();
  }
});
test("absorbed decisions are private, controlled, and unavailable for consumption-based stock purchases", async () => {
  const f = await fixture();
  try {
    const { db, set, expense } = f;
    await set(crypto.randomUUID(), null, 1000);
    await assert.rejects(
      db.query(
        "insert into expense_absorptions(id,expense_id,amount_cents,reason,created_by) values(gen_random_uuid(),$1,1,'Bypass',auth.uid())",
        [expense],
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select expense_absorbed($1)", [expense]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from expense_billing_costs"),
      /permission denied/,
    );
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Purchase feed','feed',$1) id",
        [f.category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='lb'",
        [product],
      )
    ).rows[0].id;
    const purchase = (
      await db.query<{ r: any }>(
        "select record_stock_movement($1,$2,$3,10,'purchase','2020-01-10',1000,null,null,'Feed store',null) r",
        [crypto.randomUUID(), product, unit],
      )
    ).rows[0].r;
    const stockExpense = (
      await db.query<{ expense_id: string }>(
        "select expense_id from inventory_movements where id=$1",
        [purchase.movement_id],
      )
    ).rows[0].expense_id;
    await assert.rejects(
      db.query("select set_expense_absorption($1,null,$2,1,'Absorb')", [
        crypto.randomUUID(),
        stockExpense,
      ]),
      /consumption/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from expense_absorptions")).rows.length,
      0,
    );
    await assert.rejects(set(crypto.randomUUID(), null, 1), /Administrator/);
    await assert.rejects(
      db.query("select expense_recovery_report('2020-01-01','2020-01-31')"),
      /Administrator/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      set(crypto.randomUUID(), null, 1),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});

test("paid-cohort totals include absorbed costs beyond the detail limit, exclude unpaid costs, and applied credit respects partial cost", async () => {
  const f = await fixture();
  try {
    const { db, set, expense, invoice, customer } = f;
    await set(crypto.randomUUID(), null, 4000);
    await db.query("select add_expense_chargeback($1,$2,0)", [
      invoice,
      expense,
    ]);
    await db.query("select finalize_invoice($1)", [invoice]);
    const credit = crypto.randomUUID(),
      application = crypto.randomUUID();
    await db.query(
      "select record_customer_credit($1,$2,'advance',null,10000,'2020-01-20','cash','Advance',null)",
      [credit, customer],
    );
    await db.query("select apply_customer_credit($1,$2,$3,6000,'2020-02-02')", [
      application,
      credit,
      invoice,
    ]);
    await assert.rejects(
      db.query("select assign_expense_credit($1,null,$2,$3,6001,'Recovery')", [
        crypto.randomUUID(),
        application,
        expense,
      ]),
      /unassigned|unrecovered/,
    );
    await db.query(
      "select assign_expense_credit($1,null,$2,$3,6000,'Recovery')",
      [crypto.randomUUID(), application, expense],
    );
    for (let n = 0; n < 101; n++) {
      const e = (
        await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
          {
            expense_date: "2020-01-10",
            paid_on: n === 100 ? null : "2020-01-10",
            category_id: f.category,
            amount_cents: 100,
            reimbursable: false,
            vendor: "Barn",
          },
          crypto.randomUUID(),
        ])
      ).rows[0].id;
      await db.query(
        "select set_expense_absorption($1,null,$2,20,'Barn cost')",
        [crypto.randomUUID(), e],
      );
    }
    let r = await f.report();
    assert.equal(r.count, 101);
    assert.equal(r.expenses.length, 100);
    assert.equal(r.totals.absorbed_cost_cents, 6000);
    assert.equal(r.totals.undecided_cost_cents, 8000);
    assert.equal(r.totals.other_unbilled_cents, 8000);
    assert.equal(r.totals.credit_recovered_cents, 6000);
    assert.equal(
      r.totals.paid_cost_cents,
      r.totals.issued_cost_cents +
        r.totals.draft_cost_cents +
        r.totals.absorbed_cost_cents +
        r.totals.undecided_cost_cents,
    );
    const cash = (
      await db.query<{ r: any }>(
        "select cash_report('2020-01-01','2020-02-28') r",
      )
    ).rows[0].r;
    assert.equal(cash.received_cents, 10000);
  } finally {
    await f.db.close();
  }
});

test("equal invoice totals cannot hide a changed original cost and fee after designation edits", async () => {
  const f = await fixture();
  try {
    const first = crypto.randomUUID(),
      next = crypto.randomUUID();
    await f.set(first, null, 3000);
    const line = (
      await f.db.query<{ id: string }>(
        "select add_expense_chargeback($1,$2,500) id",
        [f.invoice, f.expense],
      )
    ).rows[0].id;
    await f.set(next, first, 2500);
    await assert.rejects(
      f.db.query("select add_expense_chargeback($1,$2,0)", [
        f.invoice,
        f.expense,
      ]),
      /different fee or absorbed amount/,
    );
    await f.db.query("select remove_invoice_line($1)", [line]);
    await f.db.query("select add_expense_chargeback($1,$2,0)", [
      f.invoice,
      f.expense,
    ]);
    assert.equal((await f.follow()).draft_cost_cents, 7500);
  } finally {
    await f.db.close();
  }
});
