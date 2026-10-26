import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("account credits retain cash once, transfer only retained funds and apply manually to the same customer", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Credit customer') returning id",
      )
    ).rows[0].id;
    const other = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Other') returning id",
      )
    ).rows[0].id;
    const makeInvoice = async (c = customer) => {
      const id = crypto.randomUUID();
      await db.query(
        "select create_invoice($1,$2,null,'2020-01-01','2020-01-10',null,null)",
        [id, c],
      );
      await db.query("select add_invoice_line($1,$2,'Training',10000)", [
        crypto.randomUUID(),
        id,
      ]);
      await db.query("select finalize_invoice($1)", [id]);
      return id;
    };
    const source = await makeInvoice(),
      target = await makeInvoice(),
      wrong = await makeInvoice(other),
      payment = crypto.randomUUID();
    await db.query(
      "select record_invoice_payment($1,$2,10000,'2020-01-02','cash')",
      [payment, source],
    );
    const advance = crypto.randomUUID(),
      transfer = crypto.randomUUID();
    const record = (id: string, amount = 3000) =>
      db.query(
        "select record_customer_credit($1,$2,'advance',null,$3,'2020-02-01','cash','Future training',null)",
        [id, customer, amount],
      );
    await record(advance);
    await record(advance);
    await assert.rejects(record(advance, 3001), /already saved/);
    await db.query(
      "select record_customer_credit($1,$2,'invoice',$3,2000,'2020-02-02',null,'Unused days',null)",
      [transfer, customer, payment],
    );
    const totals = async (id: string) =>
      (
        await db.query<{
          balance_cents: number;
          total_cents: number;
          paid_cents: number;
        }>(
          "select balance_cents,total_cents,paid_cents from invoice_totals where id=$1",
          [id],
        )
      ).rows[0];
    assert.deepEqual(await totals(source), {
      balance_cents: 0,
      total_cents: 8000,
      paid_cents: 8000,
    });
    const application = crypto.randomUUID();
    const apply = (
      id: string,
      credit = advance,
      invoice = target,
      amount = 2500,
    ) =>
      db.query("select apply_customer_credit($1,$2,$3,$4,'2020-02-03')", [
        id,
        credit,
        invoice,
        amount,
      ]);
    await assert.rejects(
      apply(crypto.randomUUID(), advance, wrong),
      /same customer/,
    );
    await apply(application);
    await apply(application);
    assert.equal((await totals(target)).balance_cents, 7500);
    await assert.rejects(
      apply(crypto.randomUUID(), advance, target, 501),
      /exceeds/,
    );
    const report = (
      await db.query<{
        r: {
          received_cents: number;
          net_cents: number;
          months: { received_cents: number; net_cents: number }[];
        };
      }>("select cash_report('2020-02-01','2020-02-29') r")
    ).rows[0].r;
    assert.equal(report.received_cents, 3000);
    assert.equal(report.net_cents, 3000);
    assert.equal(report.months[0].received_cents, 3000);
    assert.equal(report.months[0].net_cents, 3000);
    const csv = (
      await db.query<{
        r: { rows: { kind: string }[]; totals: { received_cents: number } };
      }>("select cash_ledger_export('2020-02-01','2020-02-29') r")
    ).rows[0].r;
    assert.equal(csv.totals.received_cents, 3000);
    assert.deepEqual(
      csv.rows.map((r) => r.kind),
      ["advance"],
    );
    await assert.rejects(
      db.query("select reverse_invoice_payment($1,'Wrong')", [payment]),
      /account credits/,
    );
    await assert.rejects(
      db.query(
        "select record_invoice_refund($1,$2,8001,'2020-02-03','reopen','cash','Refund')",
        [crypto.randomUUID(), payment],
      ),
      /retained/,
    );
    await assert.rejects(
      db.query("select void_invoice($1,'Wrong')", [target]),
      /account credits/,
    );
    await assert.rejects(
      db.query("select reverse_customer_credit($1,false,'Wrong')", [advance]),
      /applications/,
    );
    await db.query("select reverse_customer_credit($1,true,'Wrong')", [
      application,
    ]);
    await apply(application);
    assert.equal((await totals(target)).balance_cents, 10000);
    await db.query("select reverse_customer_credit($1,false,'Wrong')", [
      advance,
    ]);
    await record(advance);
    await db.query("select reverse_customer_credit($1,false,'Wrong')", [
      transfer,
    ]);
    assert.deepEqual(await totals(source), {
      balance_cents: 0,
      total_cents: 10000,
      paid_cents: 10000,
    });
    assert.equal(
      (
        await db.query<{ r: { received_cents: number } }>(
          "select cash_report('2020-02-01','2020-02-29') r",
        )
      ).rows[0].r.received_cents,
      0,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from customer_credits")).rows.length,
      0,
    );
    await assert.rejects(record(crypto.randomUUID()), /Administrator/);
    await assert.rejects(apply(crypto.randomUUID()), /Administrator/);
    await assert.rejects(
      db.query("select customer_credit_overview($1,1)", [customer]),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});

test("credit history pages keep full balances and customer access never exposes another account or private corrections", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Portal credits') returning id",
      )
    ).rows[0].id;
    const other = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Other credits') returning id",
      )
    ).rows[0].id;
    for (let n = 0; n < 26; n++)
      await db.query(
        "select record_customer_credit($1,$2,'advance',null,100,'2020-01-01','cash','Future training',null)",
        [crypto.randomUUID(), customer],
      );
    await db.query(
      "select record_customer_credit($1,$2,'advance',null,9000,'2020-01-01','cash','Other private account',null)",
      [crypto.randomUUID(), other],
    );
    const overview = async (page: number) =>
      (
        await db.query<{
          r: {
            available_cents: number;
            credit_count: number;
            credits: { id: string }[];
          };
        }>("select customer_credit_overview($1,$2) r", [customer, page])
      ).rows[0].r;
    const first = await overview(1),
      second = await overview(2);
    assert.equal(first.available_cents, 2600);
    assert.equal(first.credit_count, 26);
    assert.equal(first.credits.length, 25);
    assert.equal(second.credits.length, 1);
    assert.equal(
      new Set([...first.credits, ...second.credits].map((c) => c.id)).size,
      26,
    );
    await assert.rejects(overview(0), /valid credit history/);
    const credit = first.credits[0].id;
    await db.query(
      "select reverse_customer_credit($1,false,'Private correction text')",
      [credit],
    );
    assert.equal((await overview(1)).available_cents, 2500);
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='credit.customer@example.com' where id=$1",
      [outsiderId],
    );
    const { adminId } = await import("./helpers/inventory-database.ts");
    await login(db, adminId);
    await db.query(
      "select grant_customer_portal($1,$2,'credit.customer@example.com','Existing account')",
      [crypto.randomUUID(), customer],
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query<{ r: number }>("select portal_account_credit() r"))
        .rows[0].r,
      2500,
    );
    await assert.rejects(
      db.query("select invoice_credit_public_history($1)", [
        crypto.randomUUID(),
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select admin_invoice_credit_history($1)", [
        crypto.randomUUID(),
      ]),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select reverse_customer_credit($1,false,'Wrong')", [credit]),
      /Administrator/,
    );
    await assert.rejects(
      db.query(
        "insert into customer_credits(id,customer_id,source,credit_on,amount_cents,method,reason,created_by) values($1,$2,'advance','2020-01-01',100,'cash','Fake',$3)",
        [crypto.randomUUID(), customer, outsiderId],
      ),
      /permission denied/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select * from customer_credits"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select portal_account_credit()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("credit validation is atomic, supports partial applications and public invoices reconcile without exposing correction reasons", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Partial credits') returning id",
      )
    ).rows[0].id;
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2020-02-01','2020-02-10',null,null)",
      [invoice, customer],
    );
    await db.query("select add_invoice_line($1,$2,'Training',5000)", [
      crypto.randomUUID(),
      invoice,
    ]);
    await db.query("select finalize_invoice($1)", [invoice]);
    const credit = crypto.randomUUID(),
      app = crypto.randomUUID();
    const record = (amount: number, date = "2020-01-01") =>
      db.query(
        "select record_customer_credit($1,$2,'advance',null,$3,$4,'cash','Future training',null)",
        [credit, customer, amount, date],
      );
    await assert.rejects(record(0), /positive amount/);
    await assert.rejects(record(1000, "2999-01-01"), /actual date/);
    await record(4000);
    const apply = (amount: number, date = "2020-02-02", id = app) =>
      db.query("select apply_customer_credit($1,$2,$3,$4,$5)", [
        id,
        credit,
        invoice,
        amount,
        date,
      ]);
    await assert.rejects(apply(4000, "2020-01-15"), /cannot precede/);
    await assert.rejects(apply(4001), /exceeds/);
    assert.equal(
      (
        await db.query<{ r: number }>(
          "select count(*)::int r from customer_credit_applications",
        )
      ).rows[0].r,
      0,
    );
    await apply(3000);
    await apply(1000, "2020-02-03", crypto.randomUUID());
    await assert.rejects(apply(2999), /already saved/);
    assert.equal(
      (
        await db.query<{ r: number }>(
          "select balance_cents r from invoice_totals where id=$1",
          [invoice],
        )
      ).rows[0].r,
      1000,
    );
    await db.query(
      "select record_invoice_payment($1,$2,1000,'2020-02-04','cash')",
      [crypto.randomUUID(), invoice],
    );
    await db.query(
      "select reverse_customer_credit($1,true,'Private application correction')",
      [app],
    );
    assert.equal(
      (
        await db.query<{ r: number }>(
          "select balance_cents r from invoice_totals where id=$1",
          [invoice],
        )
      ).rows[0].r,
      3000,
    );
    const hist = (
      await db.query<{ r: { amount_cents: number; reversed: boolean }[] }>(
        "select admin_invoice_credit_history($1) r",
        [invoice],
      )
    ).rows[0].r;
    assert.equal(hist.length, 2);
    assert.equal(hist.filter((h) => h.reversed).length, 1);
    assert.equal(JSON.stringify(hist).includes("Private"), false);
    // All business cash remains on actual receipt dates; horse/stay attribution keeps advances unassigned.
    assert.equal(
      (
        await db.query<{ r: number }>(
          "select coalesce(sum(amount_cents),0) r from reporting_receipts where paid_on='2020-01-01' and horse_id is null and stay_id is null",
        )
      ).rows[0].r,
      4000,
    );
    const { cashLedgerCsv } = await import("../src/lib/cash-export.ts");
    const data = (
      await db.query<{
        r: import("../src/lib/cash-export.ts").CashLedgerExport;
      }>("select cash_ledger_export('2020-01-01','2020-02-29') r")
    ).rows[0].r;
    assert.equal(data.totals.received_cents, 5000);
    assert.match(cashLedgerCsv(data), /Customer advance payment/);
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='partial.credit@example.com' where id=$1",
      [outsiderId],
    );
    const { adminId } = await import("./helpers/inventory-database.ts");
    await login(db, adminId);
    await db.query(
      "select grant_customer_portal($1,$2,'partial.credit@example.com','Existing account')",
      [crypto.randomUUID(), customer],
    );
    await login(db, outsiderId);
    const portal = (
      await db.query<{
        r: {
          applied_credit_cents: number;
          paid_cents: number;
          balance_cents: number;
          account_credits: unknown[];
        };
      }>("select portal_invoice($1) r", [invoice])
    ).rows[0].r;
    assert.equal(portal.applied_credit_cents, 1000);
    assert.equal(portal.paid_cents, 2000);
    assert.equal(portal.balance_cents, 3000);
    assert.equal(portal.account_credits.length, 2);
    assert.equal(
      JSON.stringify(portal).includes("Private application correction"),
      false,
    );
  } finally {
    await db.close();
  }
});

test("moving paid-invoice money to credit respects refunds and explicit expense recovery in both directions", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Recovery credits') returning id",
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
          amount_cents: 10000,
          reimbursable: true,
          vendor: "Vet",
        },
        crypto.randomUUID(),
      ])
    ).rows[0].id;
    const invoice = crypto.randomUUID(),
      payment = crypto.randomUUID(),
      assignment = crypto.randomUUID(),
      credit = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2020-01-01','2020-01-10',null,null)",
      [invoice, customer],
    );
    await db.query("select add_expense_chargeback($1,$2,0)", [
      invoice,
      expense,
    ]);
    await db.query("select finalize_invoice($1)", [invoice]);
    await db.query(
      "select record_invoice_payment($1,$2,10000,'2020-01-02','cash')",
      [payment, invoice],
    );
    await db.query(
      "select assign_expense_payment($1,null,$2,$3,7000,'Recovery')",
      [assignment, payment, expense],
    );
    const transfer = (amount: number) =>
      db.query(
        "select record_customer_credit($1,$2,'invoice',$3,$4,'2020-02-01',null,'Reduced charge',null)",
        [credit, customer, payment, amount],
      );
    await assert.rejects(transfer(3001), /retained payment/);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from customer_credits",
        )
      ).rows[0].n,
      0,
    );
    await transfer(2000);
    await assert.rejects(
      db.query("select assign_expense_payment($1,$2,$3,$4,8001,'Overdraw')", [
        crypto.randomUUID(),
        assignment,
        payment,
        expense,
      ]),
      /unassigned/,
    );
    await assert.rejects(
      db.query(
        "select record_invoice_refund($1,$2,1001,'2020-02-02','reduce','cash','Refund')",
        [crypto.randomUUID(), payment],
      ),
      /expense-recovery/,
    );
    await db.query(
      "select record_invoice_refund($1,$2,1000,'2020-02-02','reduce','cash','Refund')",
      [crypto.randomUUID(), payment],
    );
    const recovery = (
      await db.query<{ r: { payments: { available_cents: number }[] } }>(
        "select invoice_expense_recovery($1) r",
        [invoice],
      )
    ).rows[0].r;
    assert.equal(recovery.payments[0].available_cents, 0);
    const overview = (
      await db.query<{ r: { payments: unknown[] } }>(
        "select invoice_refund_overview($1) r",
        [invoice],
      )
    ).rows[0].r;
    assert.equal(overview.payments.length, 0);
    await db.query(
      "select reverse_customer_credit($1,false,'Wrong reduction')",
      [credit],
    );
    const restored = (
      await db.query<{ r: { payments: { available_cents: number }[] } }>(
        "select invoice_expense_recovery($1) r",
        [invoice],
      )
    ).rows[0].r;
    assert.equal(restored.payments[0].available_cents, 2000);
  } finally {
    await db.close();
  }
});
