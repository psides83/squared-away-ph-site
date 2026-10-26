import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { creditRefundValues } from "../src/lib/credit-refunds.ts";
import {
  cashLedgerCsv,
  type CashLedgerExport,
} from "../src/lib/cash-export.ts";
test("credit refund inputs require positive money, actual method and bounded public and private fields", () => {
  const f = new FormData();
  for (const [key, value] of Object.entries({
    request: crypto.randomUUID(),
    credit_id: crypto.randomUUID(),
    amount: "12.34",
    refunded_on: "2020-03-01",
    method: "cash",
    reason: "Unused credit",
    notes: "Private",
  }))
    f.set(key, value);
  assert.equal(creditRefundValues(f).p_amount, 1234);
  f.set("amount", "0");
  assert.throws(() => creditRefundValues(f), /positive/);
  f.set("amount", "12.345");
  assert.throws(() => creditRefundValues(f), /decimal/);
  f.set("amount", "12");
  f.set("method", "automatic");
  assert.throws(() => creditRefundValues(f), /method/);
  f.set("method", "cash");
  f.set("reason", "");
  assert.throws(() => creditRefundValues(f), /reason/);
  f.set("reason", "Unused");
  f.set("notes", "x".repeat(2001));
  assert.throws(() => creditRefundValues(f), /too long/);
});
async function fixture() {
  const db = await inventoryDatabase();
  const customer = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Credit refund customer') returning id",
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
  const advance = crypto.randomUUID();
  await db.query(
    "select record_customer_credit($1,$2,'advance',null,10000,'2020-01-20','cash','Future training',null)",
    [advance, customer],
  );
  const refund = (
    id: string,
    amount = 2000,
    credit = advance,
    date = "2020-03-01",
  ) =>
    db.query(
      "select record_customer_credit_refund($1,$2,$3,$4,'cash','Unused credit','Reference','Private refund notes')",
      [id, credit, amount, date],
    );
  const available = async () =>
    (
      await db.query<{
        r: {
          available_cents: number;
          available: { id: string; available_cents: number }[];
          credits: { id: string; available_cents: number }[];
        };
      }>("select customer_credit_overview($1) r", [customer])
    ).rows[0].r;
  const refunds = async (page = 1) =>
    (
      await db.query<{
        r: {
          count: number;
          refunded_cents: number;
          rows: { id: string; reversed_at: string | null }[];
        };
      }>("select customer_credit_refund_overview($1,$2) r", [customer, page])
    ).rows[0].r;
  const report = async (from = "2020-03-01", to = "2020-03-31") =>
    (
      await db.query<{
        r: {
          received_cents: number;
          customer_refunds_cents: number;
          credit_refunds_cents: number;
          net_cents: number;
          months: { customer_refunds_cents: number; net_cents: number }[];
        };
      }>("select cash_report($1,$2) r", [from, to])
    ).rows[0].r;
  return { db, customer, invoice, advance, refund, available, refunds, report };
}
test("unused credit refunds and invoice applications share one balance without changing invoices or double-counting cash", async () => {
  const f = await fixture();
  try {
    const app = crypto.randomUUID(),
      refund = crypto.randomUUID();
    await f.db.query(
      "select apply_customer_credit($1,$2,$3,6000,'2020-02-01')",
      [app, f.advance, f.invoice],
    );
    await f.refund(refund);
    await f.refund(refund);
    assert.equal((await f.available()).available_cents, 2000);
    assert.equal((await f.available()).available[0].available_cents, 2000);
    assert.equal((await f.available()).credits[0].available_cents, 2000);
    await assert.rejects(f.refund(refund, 2001), /already saved/);
    await assert.rejects(f.refund(crypto.randomUUID(), 2001), /exceeds unused/);
    await assert.rejects(
      f.db.query("select apply_customer_credit($1,$2,$3,2001,'2020-03-02')", [
        crypto.randomUUID(),
        f.advance,
        f.invoice,
      ]),
      /exceeds/,
    );
    const totals = (
      await f.db.query<{
        paid_cents: number;
        total_cents: number;
        balance_cents: number;
      }>(
        "select paid_cents,total_cents,balance_cents from invoice_totals where id=$1",
        [f.invoice],
      )
    ).rows[0];
    assert.deepEqual(totals, {
      paid_cents: 6000,
      total_cents: 10000,
      balance_cents: 4000,
    });
    const r = await f.report();
    assert.equal(r.received_cents, 0);
    assert.equal(r.customer_refunds_cents, 2000);
    assert.equal(r.credit_refunds_cents, 2000);
    assert.equal(r.net_cents, -2000);
    assert.equal(r.months[0].customer_refunds_cents, 2000);
    assert.equal(r.months[0].net_cents, -2000);
    const all = await f.report("2020-01-01", "2020-03-31");
    assert.equal(all.received_cents, 10000);
    assert.equal(all.net_cents, 8000);
    const csv = (
      await f.db.query<{ r: CashLedgerExport }>(
        "select cash_ledger_export('2020-01-01','2020-03-31') r",
      )
    ).rows[0].r;
    assert.equal(csv.totals.net_cents, 8000);
    assert.equal(csv.totals.customer_refunds_cents, 2000);
    assert.match(cashLedgerCsv(csv), /Unused customer credit refund/);
    assert.equal(JSON.stringify(csv).includes("Private refund notes"), false);
    await f.refund(crypto.randomUUID(), 2000);
    assert.equal((await f.available()).available_cents, 0);
    assert.equal((await f.available()).available.length, 0);
  } finally {
    await f.db.close();
  }
});
test("correcting mistaken credit refunds restores credit and the original cash period; late retries never resurrect them", async () => {
  const f = await fixture();
  try {
    const id = crypto.randomUUID();
    await assert.rejects(f.refund(id, 0), /positive/);
    await assert.rejects(
      f.refund(id, 1, f.advance, "2020-01-19"),
      /cannot precede/,
    );
    await assert.rejects(
      f.refund(id, 1, f.advance, "2999-01-01"),
      /actual date/,
    );
    assert.equal((await f.refunds()).count, 0);
    await f.refund(id);
    await assert.rejects(
      f.db.query("select reverse_customer_credit($1,false,'Wrong advance')", [
        f.advance,
      ]),
      /active account-credit refund/,
    );
    await f.db.query(
      "select reverse_customer_credit_refund($1,'Mistaken refund')",
      [id],
    );
    await f.db.query(
      "select reverse_customer_credit_refund($1,'Repeated click')",
      [id],
    );
    await f.refund(id);
    assert.equal((await f.available()).available_cents, 10000);
    assert.equal((await f.report()).net_cents, 0);
    assert.equal((await f.refunds()).count, 1);
    assert.equal((await f.refunds()).refunded_cents, 0);
    assert.ok((await f.refunds()).rows[0].reversed_at);
    await f.db.query(
      "select reverse_customer_credit($1,false,'Wrong advance')",
      [f.advance],
    );
    await assert.rejects(
      f.refund(crypto.randomUUID(), 1),
      /active customer credit/,
    );
  } finally {
    await f.db.close();
  }
});
test("refunds from paid-invoice credits preserve source invoice balances and follow source horse cash attribution", async () => {
  const f = await fixture();
  try {
    const horse = (
      await f.db.query<{ id: string }>(
        "insert into horses(barn_name) values('Credit refund horse') returning id",
      )
    ).rows[0].id;
    await f.db.query(
      "insert into horse_customers(horse_id,customer_id) values($1,$2)",
      [horse, f.customer],
    );
    await f.db.query(
      "select set_invoice_reporting_link($1,$2,$3,null,'Manual horse')",
      [crypto.randomUUID(), f.invoice, horse],
    );
    const payment = crypto.randomUUID(),
      credit = crypto.randomUUID(),
      refund = crypto.randomUUID();
    await f.db.query(
      "select record_invoice_payment($1,$2,10000,'2020-01-02','cash')",
      [payment, f.invoice],
    );
    await f.db.query(
      "select record_customer_credit($1,$2,'invoice',$3,4000,'2020-02-01',null,'Unused days',null)",
      [credit, f.customer, payment],
    );
    await f.refund(refund, 2500, credit);
    const before = (
      await f.db.query<{ n: number }>(
        "select count(*)::int n from invoice_adjustments",
      )
    ).rows[0].n;
    await assert.rejects(
      f.db.query("select reverse_customer_credit($1,false,'Wrong source')", [
        credit,
      ]),
      /active account-credit refund/,
    );
    assert.equal(
      (
        await f.db.query<{ n: number }>(
          "select count(*)::int n from invoice_adjustments",
        )
      ).rows[0].n,
      before,
    );
    assert.equal(
      (
        await f.db.query<{ balance_cents: number }>(
          "select balance_cents from invoice_totals where id=$1",
          [f.invoice],
        )
      ).rows[0].balance_cents,
      0,
    );
    await assert.rejects(
      f.db.query(
        "select record_invoice_refund($1,$2,6001,'2020-03-02','reopen','cash','Too much')",
        [crypto.randomUUID(), payment],
      ),
      /retained/,
    );
    const horseReport = (
      await f.db.query<{
        r: {
          horses: { horse_id: string; received_cents: number }[];
          unassigned_received_cents: number;
        };
      }>("select horse_cash_report('2020-03-01','2020-03-31') r")
    ).rows[0].r;
    assert.equal(
      horseReport.horses.find((h) => h.horse_id === horse)?.received_cents,
      -2500,
    );
    assert.equal(horseReport.unassigned_received_cents, 0);
    await f.refund(crypto.randomUUID(), 1000);
    const rows = (
      await f.db.query<{ horse_id: string | null; amount_cents: number }>(
        "select horse_id,amount_cents from reporting_receipts where paid_on='2020-03-01' order by amount_cents",
      )
    ).rows;
    assert.deepEqual(rows, [
      { horse_id: horse, amount_cents: -2500 },
      { horse_id: null, amount_cents: -1000 },
    ]);
    // Invoice-payment refunds and account-credit refunds share the cash-report refund bucket, not source capacity.
    await f.db.query(
      "select record_invoice_refund($1,$2,500,'2020-03-02','reduce','cash','Direct refund')",
      [crypto.randomUUID(), payment],
    );
    assert.equal((await f.report()).customer_refunds_cents, 4000);
    assert.equal((await f.report()).net_cents, -4000);
    const csv = (
      await f.db.query<{ r: CashLedgerExport }>(
        "select cash_ledger_export('2020-03-01','2020-03-31') r",
      )
    ).rows[0].r;
    assert.match(cashLedgerCsv(csv), /Customer refund/);
    assert.equal(csv.totals.customer_refunds_cents, 4000);
  } finally {
    await f.db.close();
  }
});

test("credit refund histories page with complete totals and customer projections omit private details and other accounts", async () => {
  const f = await fixture();
  try {
    const ids: string[] = [];
    for (let n = 0; n < 27; n++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await f.refund(id, 50);
    }
    const first = await f.refunds(),
      second = await f.refunds(2);
    assert.equal(first.count, 27);
    assert.equal(first.refunded_cents, 1350);
    assert.equal(first.rows.length, 25);
    assert.equal(second.rows.length, 2);
    assert.equal(
      new Set([...first.rows, ...second.rows].map((r) => r.id)).size,
      27,
    );
    await assert.rejects(f.refunds(0), /valid refund history/);
    await f.db.query(
      "select reverse_customer_credit_refund($1,'Private correction reason')",
      [ids[0]],
    );
    assert.equal((await f.refunds()).refunded_cents, 1300);
    const other = (
        await f.db.query<{ id: string }>(
          "insert into customers(name) values('Other private customer') returning id",
        )
      ).rows[0].id,
      otherCredit = crypto.randomUUID();
    await f.db.query(
      "select record_customer_credit($1,$2,'advance',null,50000,'2020-01-01','cash','Private other credit',null)",
      [otherCredit, other],
    );
    await f.refund(crypto.randomUUID(), 12000, otherCredit);
    await assert.rejects(
      f.db.query(
        "insert into customer_credit_refunds(id,credit_id,refunded_on,amount_cents,method,reason,created_by) values($1,$2,'2020-03-01',1,'cash','Fake',$3)",
        [crypto.randomUUID(), f.advance, adminId],
      ),
      /permission denied/,
    );
    await f.db.exec("reset role");
    await f.db.query(
      "update auth.users set email='credit.refund@example.com' where id=$1",
      [outsiderId],
    );
    await login(f.db, adminId);
    await f.db.query(
      "select grant_customer_portal($1,$2,'credit.refund@example.com','Existing account')",
      [crypto.randomUUID(), f.customer],
    );
    await login(f.db, outsiderId);
    const portal = async (page = 1) =>
      (
        await f.db.query<{
          r: {
            count: number;
            refunded_cents: number;
            rows: { id: string; reversed: boolean }[];
          };
        }>("select portal_credit_refunds($1) r", [page])
      ).rows[0].r;
    const own = await portal(),
      older = await portal(2);
    assert.equal(own.count, 27);
    assert.equal(own.refunded_cents, 1300);
    assert.equal(own.rows.length, 25);
    assert.equal(older.rows.length, 2);
    assert.equal(
      [...own.rows, ...older.rows].filter((r) => r.reversed).length,
      1,
    );
    const json = JSON.stringify([own, older]);
    for (const privateValue of [
      "Private refund notes",
      "Private correction reason",
      "credit_id",
      "created_by",
      "Private other customer",
      "12000",
    ])
      assert.equal(json.includes(privateValue), false);
    assert.equal(
      (await f.db.query<{ r: number }>("select portal_account_credit() r"))
        .rows[0].r,
      8700,
    );
    assert.equal(
      (await f.db.query("select * from customer_credit_refunds")).rows.length,
      0,
    );
    await assert.rejects(f.refund(crypto.randomUUID(), 1), /Administrator/);
    await assert.rejects(f.refunds(), /Administrator/);
    await assert.rejects(
      f.db.query("select reverse_customer_credit_refund($1,'Wrong')", [ids[0]]),
      /Administrator/,
    );
    await assert.rejects(
      f.db.query("select credit_refunded($1)", [f.advance]),
      /permission denied/,
    );
    await assert.rejects(portal(0), /valid refund history/);
    await f.db.exec("reset role;set role anon");
    await assert.rejects(
      f.db.query("select * from customer_credit_refunds"),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("select portal_credit_refunds(1)"),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});
