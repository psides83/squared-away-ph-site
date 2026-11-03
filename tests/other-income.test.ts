import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
  adminId,
} from "./helpers/inventory-database.ts";
import {
  otherIncomePeriodValues,
  type OtherIncomeOptions,
  type OtherIncomeReportData,
} from "../src/lib/other-income.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const c = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Owner') returning id",
    )
  ).rows[0].id;
  const h = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Rio') returning id",
    )
  ).rows[0].id;
  const invoice = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,null,'2026-03-01','2026-03-08',null,null)",
    [invoice, c],
  );
  const line = async (amount = 1001) => {
    const id = crypto.randomUUID();
    await db.query("select add_invoice_line($1,$2,'Other income',$3,'other')", [
      id,
      invoice,
      amount,
    ]);
    return id;
  };
  const options = async (page = 1) =>
    (
      await db.query<{ r: OtherIncomeOptions }>(
        "select other_income_options($1,$2) r",
        [invoice, page],
      )
    ).rows[0].r;
  const save = async (
    id: string,
    request = crypto.randomUUID(),
    current: string | null = null,
    from = "2026-01-30",
    to = "2026-02-01",
    clear = false,
    oldToken?: string,
  ) => {
    const firstPage = await options();
    let l = firstPage.lines.find((x) => x.id === id);
    for (let page = 2; !l && page <= Math.ceil(firstPage.count / 25); page++)
      l = (await options(page)).lines.find((x) => x.id === id);
    assert.ok(l, "The income source must be present in the paginated editor");
    const ctx = clear ? l.current! : l;
    return db.query(
      "select set_other_income_period($1,$2,$3,$4,$5,$6,$7,$8,'Covered service dates',$9,$10)",
      [
        request,
        id,
        current,
        ctx.horse_id,
        ctx.stay_id,
        ctx.amount_cents,
        from,
        to,
        clear,
        oldToken ?? ctx.source_token,
      ],
    );
  };
  const report = async (from = "2026-01-30", to = "2026-02-02", page = 1) =>
    (
      await db.query<{ r: OtherIncomeReportData }>(
        "select other_income_report($1,$2,$3) r",
        [from, to, page],
      )
    ).rows[0].r;
  return { db, c, h, invoice, line, options, save, report };
}
test("reimbursement income includes its fee once on the original expense date, separate from invoice and cash dates", async () => {
  const { db, c, h, report } = await fixture();
  try {
    const stay = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,'2026-01-01','2026-01-31',0) returning id",
        [h, c],
      )
    ).rows[0].id;
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Vet'",
      )
    ).rows[0].id;
    const expense = (
      await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
        {
          expense_date: "2026-01-15",
          paid_on: "2026-02-01",
          category_id: category,
          horse_id: h,
          amount_cents: 10000,
          vendor: "Vet",
          reimbursable: true,
        },
        crypto.randomUUID(),
      ])
    ).rows[0].id;
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-01-01','2026-01-31')",
      [invoice, c, stay],
    );
    await db.query("select add_expense_chargeback($1,$2,501)", [
      invoice,
      expense,
    ]);
    let r = await report("2026-01-15", "2026-01-15");
    assert.equal(r.totals.draft_cents, 10501);
    assert.equal(r.totals.reimbursement_cents, 0);
    await db.query("select finalize_invoice($1)", [invoice]);
    r = await report("2026-01-15", "2026-01-15");
    assert.equal(r.totals.reimbursement_cents, 10501);
    assert.equal(r.totals.net_cents, 10501);
    assert.equal(r.rows[0].expense_id, expense);
    assert.equal(
      (await report("2026-03-01", "2026-03-31")).totals.net_cents,
      0,
    );
    await db.query(
      "select record_invoice_payment($1,$2,10501,'2026-05-01','cash')",
      [crypto.randomUUID(), invoice],
    );
    assert.equal(
      (await report("2026-01-15", "2026-01-15")).totals.net_cents,
      10501,
    );
    assert.equal(
      (await report("2026-05-01", "2026-05-31")).totals.net_cents,
      0,
    );
    await db.exec("reset role");
    await db.query(
      "update invoice_lines set source_snapshot=jsonb_set(source_snapshot,'{expense_date}','\"2026-01-16\"') where invoice_id=$1",
      [invoice],
    );
    await login(db, adminId);
    r = await report("2026-01-15", "2026-01-15");
    assert.equal(r.totals.net_cents, 0);
    assert.equal(r.unmatched_issued_count, 1);
    assert.equal(r.unmatched[0].source_kind, "expense");
  } finally {
    await db.close();
  }
});
test("signed manual Other income uses reviewed service dates and positive-gross adjustment weights without requiring a horse", async () => {
  const { db, h, invoice, line, options, save, report } = await fixture();
  try {
    const a = await line(),
      b = await line(-101);
    const req = crypto.randomUUID();
    await save(a, req);
    await save(a, req);
    await save(b, crypto.randomUUID(), null, "2026-01-31", "2026-02-02");
    let r = await report();
    assert.equal(r.totals.draft_cents, 900);
    assert.equal(r.totals.net_cents, 0);
    assert.equal((await options()).lines[0].horse_id, null);
    await db.query("select finalize_invoice($1)", [invoice]);
    for (const [day, n] of [
      ["2026-01-30", 334],
      ["2026-01-31", 300],
      ["2026-02-01", 299],
      ["2026-02-02", -33],
    ] as const)
      assert.equal((await report(day, day)).totals.net_cents, n);
    const adj = crypto.randomUUID();
    await db.query("select adjust_invoice($1,$2,101,'2026-04-01','Fee')", [
      adj,
      invoice,
    ]);
    assert.equal((await report()).unresolved_adjustment_count, 1);
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,0,0,101,'Other income')",
      [crypto.randomUUID(), adj],
    );
    r = await report();
    assert.equal(r.totals.net_cents, 1001);
    assert.equal(r.totals.adjustment_cents, 101);
    assert.equal(
      (await report("2026-02-02", "2026-02-02")).totals.net_cents,
      -33,
    );
    const token = (await options()).lines.find(
      (x) => x.id === a,
    )!.source_token!;
    await db.query(
      "select set_invoice_reporting_link($1,$2,$3,null,'Horse reporting')",
      [crypto.randomUUID(), invoice, h],
    );
    r = await report();
    assert.equal(r.unmatched_issued_count, 2);
    assert.equal(r.totals.net_cents, 0);
    assert.equal(r.unresolved_adjustment_count, 1);
    await assert.rejects(
      save(
        a,
        crypto.randomUUID(),
        req,
        "2026-01-30",
        "2026-02-01",
        false,
        token,
      ),
      /changed/,
    );
    await db.query(
      "select set_other_income_period($1,$2,null,null,null,1001,'2026-01-30','2026-02-01','Covered service dates',false,$3)",
      [req, a, token],
    );
    assert.equal((await options()).lines.find((x) => x.id === a)!.valid, false);
    await save(a, crypto.randomUUID(), req);
    const partial = await report();
    assert.equal(partial.totals.manual_cents, 1001);
    assert.equal(partial.totals.adjustment_cents, 0);
    assert.equal(partial.unmatched_issued_count, 1);
    assert.equal(partial.unresolved_adjustment_count, 1);

    assert.equal(
      (
        await db.query<{ n: number }>(
          "select issued_total_cents n from invoices where id=$1",
          [invoice],
        )
      ).rows[0].n,
      900,
    );
  } finally {
    await db.close();
  }
});
test("other-income clearing and deleted-line reuse preserve audit history without inheriting dates or resurrecting old reviews", async () => {
  const { db, c, invoice, line, save, options } = await fixture();
  try {
    const id = await line(),
      req = crypto.randomUUID();
    await save(id, req);
    const token = (await options()).lines[0].source_token!;
    await save(id, crypto.randomUUID(), req, "2026-01-30", "2026-02-01", true);
    await save(id, req);
    assert.equal((await options()).lines[0].valid, false);
    await db.query("select remove_invoice_line($1)", [id]);
    assert.equal((await options()).count, 0);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::integer n from other_income_periods where line_id=$1",
          [id],
        )
      ).rows[0].n,
      2,
    );
    const next = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2026-04-01','2026-04-08',null,null)",
      [next, c],
    );
    await db.query("select add_invoice_line($1,$2,'Reused ID',1001,'other')", [
      id,
      next,
    ]);
    await db.query(
      "select set_other_income_period($1,$2,null,null,null,1001,'2026-01-30','2026-02-01','Covered service dates',false,$3)",
      [req, id, token],
    );
    const r = (
      await db.query<{ r: OtherIncomeOptions }>(
        "select other_income_options($1) r",
        [next],
      )
    ).rows[0].r;
    assert.equal(r.lines[0].valid, false);
  } finally {
    await db.close();
  }
});
test("other-income pagination keeps complete totals and review counts; private helpers and mutations remain administrator-only", async () => {
  const { db, line, save, options, report } = await fixture();
  try {
    for (let n = 0; n < 30; n++) {
      const id = await line(1);
      await save(id, crypto.randomUUID(), null, "2026-01-01", "2026-01-01");
    }
    const a = await report("2026-01-01", "2026-01-01"),
      b = await report("2026-01-01", "2026-01-01", 2);
    assert.equal(a.count, 30);
    assert.equal(a.rows.length, 25);
    assert.equal(b.rows.length, 5);
    assert.deepEqual(a.totals, b.totals);
    assert.equal(a.totals.draft_cents, 30);
    assert.equal(
      new Set([...a.rows, ...b.rows].map((x) => x.line_id)).size,
      30,
    );
    for (let n = 0; n < 30; n++) await line(1);
    const pending = await report("2026-01-01", "2026-01-01");
    assert.equal(pending.unmatched_count, 30);
    assert.equal(pending.unmatched.length, 25);
    assert.equal((await options()).count, 60);
    await assert.rejects(report("2026-02-01", "2026-01-01"), /valid report/);
    await assert.rejects(report("2026-01-01", "2026-01-01", 0), /valid report/);
    await assert.rejects(options(0), /valid page/);
    await assert.rejects(
      db.query("select * from dated_other_income"),
      /permission denied/,
    );
    await login(db, outsiderId);
    await assert.rejects(report(), /Administrator/);
    await assert.rejects(options(), /Administrator/);
    assert.equal(
      (await db.query("select * from other_income_periods")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "select set_other_income_period($1,$2,null,null,null,1,'2026-01-01','2026-01-01','Denied',false,$3)",
        [crypto.randomUUID(), crypto.randomUUID(), "a".repeat(32)],
      ),
      /Administrator/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(report(), /permission denied/);
  } finally {
    await db.close();
  }
});
test("other-income period inputs permit optional attribution but require signed whole cents, a current token and reviewed dates", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    line_id: crypto.randomUUID(),
    amount_cents: "-101",
    from: "2026-01-01",
    to: "2026-01-03",
    reason: "Review",
    source_token: "a".repeat(32),
  }))
    f.set(k, v);
  const p = otherIncomePeriodValues(f);
  assert.equal(p.p_horse, null);
  assert.equal(p.p_stay, null);
  assert.equal(p.p_amount, -101);
  f.set("amount_cents", "1.5");
  assert.throws(() => otherIncomePeriodValues(f));
  f.set("amount_cents", "1");
  f.set("source_token", "old");
  assert.throws(() => otherIncomePeriodValues(f));
});
