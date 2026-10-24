import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { customerRefundValues } from "../src/lib/customer-refunds.ts";
test("refund input requires a deliberate invoice effect and actual method", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    request: crypto.randomUUID(),
    payment_id: crypto.randomUUID(),
    amount: "20.25",
    refunded_on: "2020-03-01",
    effect: "reduce",
    method: "cash",
    reason: "Unused training days",
  }))
    form.set(key, value);
  assert.equal(customerRefundValues(form).p_amount, 2025);
  form.set("effect", "");
  assert.throws(() => customerRefundValues(form), /effect/);
  form.set("effect", "reopen");
  form.set("method", "automatic");
  assert.throws(() => customerRefundValues(form), /method/);
});
async function fixture() {
  const db = await inventoryDatabase();
  const customer = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Refund customer') returning id",
    )
  ).rows[0].id;
  const invoice = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,null,'2020-01-01','2020-01-10',null,null)",
    [invoice, customer],
  );
  await db.query("select add_invoice_line($1,$2,'Training',10000)", [
    crypto.randomUUID(),
    invoice,
  ]);
  await db.query("select finalize_invoice($1)", [invoice]);
  const payment = crypto.randomUUID();
  await db.query(
    "select record_invoice_payment($1,$2,10000,'2020-01-02','cash')",
    [payment, invoice],
  );
  const totals = async () =>
    (
      await db.query<{
        total_cents: number;
        paid_cents: number;
        balance_cents: number;
        gross_paid_cents: number;
        refunded_cents: number;
      }>(
        "select total_cents,paid_cents,balance_cents,gross_paid_cents,refunded_cents from invoice_totals where id=$1",
        [invoice],
      )
    ).rows[0];
  const refund = (
    id: string,
    amount: number,
    effect = "reduce",
    date = "2020-02-02",
  ) =>
    db.query(
      "select record_invoice_refund($1,$2,$3,$4,$5,'cash','Unused service','Reference','Private refund notes')",
      [id, payment, amount, date, effect],
    );
  return { db, customer, invoice, payment, totals, refund };
}
test("completed refunds support invoice reductions or reopened balances with atomic corrections and exact retry safety", async () => {
  const { db, invoice, payment, totals, refund } = await fixture();
  try {
    const reduced = crypto.randomUUID();
    await refund(reduced, 2000);
    await refund(reduced, 2000);
    assert.deepEqual(await totals(), {
      total_cents: 8000,
      paid_cents: 8000,
      balance_cents: 0,
      gross_paid_cents: 10000,
      refunded_cents: 2000,
    });
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from invoice_adjustments",
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(refund(reduced, 2001), /already saved/);
    const reopened = crypto.randomUUID();
    await refund(reopened, 1000, "reopen");
    assert.deepEqual(await totals(), {
      total_cents: 8000,
      paid_cents: 7000,
      balance_cents: 1000,
      gross_paid_cents: 10000,
      refunded_cents: 3000,
    });
    await assert.rejects(refund(crypto.randomUUID(), 7001), /still retained/);
    await assert.rejects(
      refund(crypto.randomUUID(), 1, "reduce", "2020-01-01"),
      /cannot precede/,
    );
    await assert.rejects(
      db.query("select reverse_invoice_payment($1,'Mistake')", [payment]),
      /active refund/,
    );
    await assert.rejects(
      db.query("select void_invoice($1,'Mistake')", [invoice]),
      /payment|Refunded/,
    );
    await db.query("select reverse_invoice_refund($1,'Wrong amount')", [
      reduced,
    ]);
    await db.query("select reverse_invoice_refund($1,'Repeated click')", [
      reduced,
    ]);
    await refund(reduced, 2000);
    assert.deepEqual(await totals(), {
      total_cents: 10000,
      paid_cents: 9000,
      balance_cents: 1000,
      gross_paid_cents: 10000,
      refunded_cents: 1000,
    });
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from invoice_adjustments",
        )
      ).rows[0].n,
      2,
    );
    const later = crypto.randomUUID();
    await db.query(
      "select record_invoice_payment($1,$2,1000,'2020-02-03','cash')",
      [later, invoice],
    );
    await assert.rejects(
      db.query("select reverse_invoice_refund($1,'Mistake')", [reopened]),
      /since been paid/,
    );
    assert.equal((await totals()).refunded_cents, 1000);
    await db.query("select reverse_invoice_payment($1,'Wrong later payment')", [
      later,
    ]);
    await db.query("select reverse_invoice_refund($1,'Mistake')", [reopened]);
    assert.equal((await totals()).balance_cents, 0);
    assert.equal((await totals()).paid_cents, 10000);
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from invoice_refunds")).rows.length,
      0,
    );
    await assert.rejects(refund(crypto.randomUUID(), 100), /Administrator/);
    await assert.rejects(
      db.query("select invoice_refund_overview($1,1)", [invoice]),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});
test("refund dates drive business and assigned horse cash results; portal exposes own public history without private notes", async () => {
  const { db, customer, invoice, totals, refund } = await fixture();
  try {
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Refund horse') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into horse_customers(horse_id,customer_id) values($1,$2)",
      [horse, customer],
    );
    await db.query(
      "select set_invoice_reporting_link($1,$2,$3,null,'Manual assignment')",
      [crypto.randomUUID(), invoice, horse],
    );
    const id = crypto.randomUUID();
    await refund(id, 2000);
    const report = async (from: string, to: string) =>
      (
        await db.query<{
          r: {
            received_cents: number;
            customer_refunds_cents: number;
            net_cents: number;
            months: { customer_refunds_cents: number }[];
          };
        }>("select cash_report($1,$2) r", [from, to])
      ).rows[0].r;
    assert.equal((await report("2020-01-01", "2020-01-31")).net_cents, 10000);
    const feb = await report("2020-02-01", "2020-02-29");
    assert.equal(feb.received_cents, 0);
    assert.equal(feb.customer_refunds_cents, 2000);
    assert.equal(feb.net_cents, -2000);
    assert.equal(feb.months[0].customer_refunds_cents, 2000);
    const horseReport = (
      await db.query<{
        r: {
          horses: {
            horse_id: string;
            received_cents: number;
            margin_cents: number;
          }[];
        };
      }>("select horse_cash_report('2020-02-01','2020-02-29') r")
    ).rows[0].r;
    assert.equal(
      horseReport.horses.find((h) => h.horse_id === horse)?.received_cents,
      -2000,
    );
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='refund.customer@example.com' where id=$1",
      [outsiderId],
    );
    await login(db, adminId);
    await db.query(
      "select grant_customer_portal($1,$2,'refund.customer@example.com','Existing account')",
      [crypto.randomUUID(), customer],
    );
    await login(db, outsiderId);
    const own = (
      await db.query<{
        r: { refunded_cents: number; paid_cents: number; refunds: unknown[] };
      }>("select portal_invoice($1) r", [invoice])
    ).rows[0].r;
    assert.equal(own.refunded_cents, 2000);
    assert.equal(own.paid_cents, 8000);
    assert.equal(own.refunds.length, 1);
    assert.equal(JSON.stringify(own).includes("Private refund notes"), false);
    assert.equal(
      (
        await db.query<{ r: unknown }>("select portal_invoice($1) r", [
          crypto.randomUUID(),
        ])
      ).rows[0].r,
      null,
    );
    await login(db, adminId);
    await db.query("select reverse_invoice_refund($1,'Mistake')", [id]);
    assert.equal((await report("2020-02-01", "2020-02-29")).net_cents, 0);
    assert.equal((await totals()).paid_cents, 10000);
  } finally {
    await db.close();
  }
});

test("refunds respect explicit expense-recovery assignments and history totals remain complete beyond one page", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Recovery customer') returning id",
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
    const expense = (
      await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
        {
          expense_date: "2020-01-01",
          paid_on: "2020-01-01",
          category_id: category,
          horse_id: horse,
          amount_cents: 9000,
          reimbursable: true,
          vendor: "Vet",
        },
        crypto.randomUUID(),
      ])
    ).rows[0].id;
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2020-01-01','2020-01-10',null,null)",
      [invoice, customer],
    );
    await db.query("select add_expense_chargeback($1,$2,1000)", [
      invoice,
      expense,
    ]);
    await db.query("select finalize_invoice($1)", [invoice]);
    const payment = crypto.randomUUID();
    await db.query(
      "select record_invoice_payment($1,$2,10000,'2020-01-02','cash')",
      [payment, invoice],
    );
    const assignment = crypto.randomUUID();
    await db.query(
      "select assign_expense_payment($1,null,$2,$3,7000,'Explicit allocation')",
      [assignment, payment, expense],
    );
    const refund = (amount: number) =>
      db.query(
        "select record_invoice_refund($1,$2,$3,'2020-02-02','reduce','cash','Refund')",
        [crypto.randomUUID(), payment, amount],
      );
    await assert.rejects(refund(3001), /expense-recovery/);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from invoice_refunds",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from invoice_adjustments",
        )
      ).rows[0].n,
      0,
    );
    await refund(2000);
    const recovery = (
      await db.query<{ r: { payments: { available_cents: number }[] } }>(
        "select invoice_expense_recovery($1) r",
        [invoice],
      )
    ).rows[0].r;
    assert.equal(recovery.payments[0].available_cents, 1000);
    await assert.rejects(
      db.query("select assign_expense_payment($1,$2,$3,$4,8001,'Too much')", [
        crypto.randomUUID(),
        assignment,
        payment,
        expense,
      ]),
      /unassigned/,
    );
    await db.query("select clear_expense_payment($1,'Customer refund')", [
      assignment,
    ]);
    const refundIds: string[] = [];
    for (let n = 0; n < 26; n++) {
      const id = crypto.randomUUID();
      refundIds.push(id);
      await db.query(
        "select record_invoice_refund($1,$2,1,'2020-02-03','reopen','cash','Small refund')",
        [id, payment],
      );
    }
    const overview = async (page: number) =>
      (
        await db.query<{
          r: { total: number; refunded_cents: number; rows: { id: string }[] };
        }>("select invoice_refund_overview($1,$2) r", [invoice, page])
      ).rows[0].r;
    const first = await overview(1),
      second = await overview(2);
    assert.equal(first.total, 27);
    assert.equal(first.rows.length, 25);
    assert.equal(second.rows.length, 2);
    assert.equal(first.refunded_cents, 2026);
    assert.equal(
      new Set([...first.rows, ...second.rows].map((r) => r.id)).size,
      27,
    );
    await db.query("select reverse_invoice_refund($1,'Mistake')", [
      refundIds[0],
    ]);
    assert.equal((await overview(1)).refunded_cents, 2025);
    assert.equal((await overview(1)).total, 27);
    await assert.rejects(overview(0), /valid refund page/);
  } finally {
    await db.close();
  }
});
