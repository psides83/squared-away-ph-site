import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cashLedgerCsv,
  csvText,
  validCashExportPeriod,
  type CashLedgerExport,
} from "../src/lib/cash-export.ts";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("cash CSV quotes text, neutralizes formulas, preserves exact cents and rejects mismatched totals", () => {
  assert.equal(validCashExportPeriod("2020-02-29", "2020-03-01"), true);
  for (const [from, to] of [
    ["2021-02-29", "2021-03-01"],
    ["2020-02-02", "2020-01-01"],
    ["0000-01-01", "0000-02-01"],
    ["2020-01-01", "2040-01-01"],
    ["bad", "bad"],
  ])
    assert.equal(validCashExportPeriod(from, to), false);
  assert.equal(csvText('Feed, "Premium"\nHay'), '"Feed, ""Premium""\nHay"');
  for (const text of [
    "=SUM(1,2)",
    " +CMD",
    "\t@SUM(A1)",
    "\r-1+2",
    "\u0001=1",
    "\uFEFF=1",
  ])
    assert.ok(csvText(text).startsWith("\"'"));
  const data: CashLedgerExport = {
    from: "2020-01-01",
    to: "2020-01-31",
    currency: "USD",
    generated_at: "2020-02-01T00:00:00Z",
    row_count: 1,
    rows: [
      {
        cash_date: "2020-01-02",
        kind: "expense",
        party: 'Feed, "Premium"',
        category: "Feed",
        invoice_number: null,
        method: null,
        reference: "=1+1",
        source_id: crypto.randomUUID(),
        related_id: null,
        cash_in_cents: 0,
        cash_out_cents: 1999,
        gross_expense_cents: 2999,
        credit_cents: 1000,
      },
    ],
    totals: {
      received_cents: 0,
      spent_cents: 1999,
      supplier_refunds_cents: 0,
      customer_refunds_cents: 0,
      supplier_credit_used_cents: 1000,
      net_cents: -1999,
    },
  };
  const csv = cashLedgerCsv(data);
  assert.ok(csv.startsWith('\uFEFF"Cash date"'));
  assert.ok(csv.includes('"Feed, ""Premium"""'));
  assert.ok(csv.includes("0.00,19.99,-19.99,29.99,10.00"));
  assert.ok(csv.endsWith("\r\n"));
  assert.throws(
    () => cashLedgerCsv({ ...data, totals: { ...data.totals, net_cents: 0 } }),
    /reconcile/,
  );
  assert.throws(() => cashLedgerCsv({ ...data, row_count: 2 }), /verified/);
  assert.throws(
    () =>
      cashLedgerCsv({
        ...data,
        rows: [{ ...data.rows[0], cash_out_cents: 1.5 }],
      }),
    /amount/,
  );
  const empty = cashLedgerCsv({
    ...data,
    row_count: 0,
    rows: [],
    totals: {
      received_cents: 0,
      spent_cents: 0,
      supplier_refunds_cents: 0,
      customer_refunds_cents: 0,
      supplier_credit_used_cents: 0,
      net_cents: 0,
    },
  });
  assert.equal(empty.split("\r\n").length, 2);
});
test("cash ledger reconciles payments, cross-month refunds and store-credit purchases without duplicating stock or invoice adjustments", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Saved customer') returning id",
      )
    ).rows[0].id;
    const invoice = crypto.randomUUID(),
      payment = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2020-01-01','2020-01-10',null,null)",
      [invoice, customer],
    );
    await db.query("select add_invoice_line($1,$2,'Training',10000)", [
      crypto.randomUUID(),
      invoice,
    ]);
    await db.query("select finalize_invoice($1)", [invoice]);
    await db.query(
      "select record_invoice_payment($1,$2,10000,'2020-01-02','cash')",
      [payment, invoice],
    );
    await db.query(
      "select record_invoice_refund($1,$2,2000,'2020-02-02','reduce','cash','Unused service','Refund reference','Private notes excluded')",
      [crypto.randomUUID(), payment],
    );
    await db.query("update customers set name='Renamed customer' where id=$1", [
      customer,
    ]);
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Export feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const buy = async (amount: number, paid: string | null) =>
      (
        await db.query<{ r: { expense_id: string } }>(
          "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-03',$4,null,'Private purchase notes','Store',$5) r",
          [crypto.randomUUID(), product, unit, amount, paid],
        )
      ).rows[0].r.expense_id;
    const partial = await buy(5000, "2020-01-03"),
      full = await buy(1000, "2020-01-03");
    await buy(7000, null);
    const credit = crypto.randomUUID();
    await db.query(
      "select issue_supplier_credit($1,'Store','2020-01-01',3000,'Credit','Supplier credit')",
      [credit],
    );
    const application = crypto.randomUUID();
    await db.query("select apply_supplier_credit($1,$2,$3,2000,'2020-01-03')", [
      application,
      credit,
      partial,
    ]);
    await db.query("select apply_supplier_credit($1,$2,$3,1000,'2020-01-03')", [
      crypto.randomUUID(),
      credit,
      full,
    ]);
    const ret = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,10,'2020-01-04','Store','Return')",
      [ret, product, unit],
    );
    const reversedInvoice = crypto.randomUUID(),
      reversedPayment = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2020-01-01','2020-01-10',null,null)",
      [reversedInvoice, customer],
    );
    await db.query("select add_invoice_line($1,$2,'Correction test',1000)", [
      crypto.randomUUID(),
      reversedInvoice,
    ]);
    await db.query("select finalize_invoice($1)", [reversedInvoice]);
    await db.query(
      "select record_invoice_payment($1,$2,1000,'2020-01-02','cash')",
      [reversedPayment, reversedInvoice],
    );
    await db.query("select reverse_invoice_payment($1,'Wrong payment')", [
      reversedPayment,
    ]);
    await db.exec("reset role");
    await db.query(
      "insert into expenses(expense_date,paid_on,category_id,amount_cents,voided_at) values('2020-01-03','2020-01-03',(select id from expense_categories where name='Other'),9000,now())",
    );
    await login(db, adminId);
    const supplierRefund = crypto.randomUUID();
    await db.query(
      "select record_supplier_refund($1,$2,500,'2020-02-03','Refund ref','Private supplier notes')",
      [supplierRefund, ret],
    );
    const query = async (from: string, to: string) =>
      (
        await db.query<{ r: CashLedgerExport }>(
          "select cash_ledger_export($1,$2) r",
          [from, to],
        )
      ).rows[0].r;
    const ledger = await query("2020-01-01", "2020-02-29");
    assert.equal(ledger.row_count, 5);
    assert.equal(
      ledger.rows.find((row) => row.kind === "payment")?.party,
      "Saved customer",
    );
    assert.equal(
      ledger.rows.find((row) => row.source_id === full)?.cash_out_cents,
      0,
    );
    assert.equal(
      ledger.rows.find((row) => row.source_id === partial)?.cash_out_cents,
      3000,
    );
    assert.deepEqual(ledger.totals, {
      received_cents: 10000,
      spent_cents: 3000,
      supplier_refunds_cents: 500,
      customer_refunds_cents: 2000,
      supplier_credit_used_cents: 3000,
      net_cents: 5500,
    });
    assert.doesNotThrow(() => cashLedgerCsv(ledger));
    assert.ok(!JSON.stringify(ledger).includes("Private"));
    for (const [from, to] of [
      ["2020-01-01", "2020-01-31"],
      ["2020-02-01", "2020-02-29"],
    ]) {
      const exported = await query(from, to);
      const report = (
        await db.query<{ r: CashLedgerExport["totals"] }>(
          "select cash_report($1,$2) r",
          [from, to],
        )
      ).rows[0].r;
      for (const [key, value] of Object.entries(exported.totals))
        assert.equal(value, report[key as keyof typeof report]);
    }
    await db.query("select reverse_supplier_refund($1,'Wrong refund')", [
      supplierRefund,
    ]);
    assert.equal(
      (await query("2020-02-01", "2020-02-29")).totals.supplier_refunds_cents,
      0,
    );
    await db.query(
      "select reverse_supplier_credit_application($1,'Wrong application')",
      [application],
    );
    const corrected = await query("2020-01-01", "2020-02-29");
    assert.equal(corrected.totals.spent_cents, 5000);
    assert.equal(corrected.totals.supplier_credit_used_cents, 1000);
    assert.equal(corrected.totals.net_cents, 3000);
    assert.doesNotThrow(() => cashLedgerCsv(corrected));
  } finally {
    await db.close();
  }
});
test("cash export denies customers and anonymous access and refuses incomplete oversized downloads", async () => {
  const db = await inventoryDatabase();
  try {
    await assert.rejects(
      db.query("select cash_ledger_export('2020-02-02','2020-01-01')"),
      /valid reporting period/,
    );
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select cash_ledger_export('2020-01-01','2020-01-31')"),
      /Administrator/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select cash_ledger_export('2020-01-01','2020-01-31')"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query(
      "insert into expenses(expense_date,paid_on,category_id,amount_cents) select '2020-01-01','2020-01-02',(select id from expense_categories where name='Other'),0 from generate_series(1,10001)",
    );
    await login(db, adminId);
    await assert.rejects(
      db.query("select cash_ledger_export('2020-01-01','2020-01-31')"),
      /10,000/,
    );
    await db.exec("reset role");
    await db.query(
      "delete from expenses where id=(select id from expenses limit 1)",
    );
    await login(db, adminId);
    const result = (
      await db.query<{ r: CashLedgerExport }>(
        "select cash_ledger_export('2020-01-01','2020-01-31') r",
      )
    ).rows[0].r;
    assert.equal(result.row_count, 10000);
    assert.doesNotThrow(() => cashLedgerCsv(result));
  } finally {
    await db.close();
  }
});
