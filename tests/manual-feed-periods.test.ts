import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  manualFeedPeriodValues,
  type ManualFeedOptions,
} from "../src/lib/manual-feed-periods.ts";
type Comparison = {
  horses: {
    horse_id: string;
    issued_cents: number;
    cost_cents: number;
    draft_cents: number;
    has_unmatched: boolean;
    has_adjustments: boolean;
    invoices: { manual_period: boolean }[];
  }[];
  totals: { issued_cents: number; draft_cents: number };
  unmatched_count: number;
};
async function fixture() {
  const db = await inventoryDatabase();
  const c = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Owner') returning id",
    )
  ).rows[0].id;
  const h = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Horse') returning id",
    )
  ).rows[0].id;
  const second = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Other horse') returning id",
    )
  ).rows[0].id;
  const invoice = crypto.randomUUID(),
    line = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,null,'2026-03-01','2026-03-08',null,null)",
    [invoice, c],
  );
  await db.query("select add_invoice_line($1,$2,'Manual feed',1001,'feed')", [
    line,
    invoice,
  ]);
  await db.query("select set_invoice_reporting_link($1,$2,$3,null,'Horse')", [
    crypto.randomUUID(),
    invoice,
    h,
  ]);
  const report = async (from = "2026-01-30", to = "2026-02-01") =>
    (
      await db.query<{ r: Comparison }>(
        "select feed_charge_comparison($1,$2) r",
        [from, to],
      )
    ).rows[0].r;
  return { db, c, h, second, invoice, line, report };
}
test("manual feed periods use reviewed calendar dates, exact cents and signed manual adjustments without changing billing or stock", async () => {
  const { db, h, invoice, line, report } = await fixture();
  try {
    const request = crypto.randomUUID();
    await db.query(
      "select set_manual_feed_period($1,$2,null,$3,null,1001,'2026-01-30','2026-02-01','Covered feed',false)",
      [request, line, h],
    );
    assert.equal((await report()).totals.draft_cents, 1001);
    assert.equal((await report()).totals.issued_cents, 0);
    await db.query("select finalize_invoice($1)", [invoice]);
    assert.equal((await report()).totals.issued_cents, 1001);
    assert.equal((await report()).horses[0].invoices[0].manual_period, true);
    assert.equal((await report()).unmatched_count, 0);
    assert.equal(
      (await report("2026-01-30", "2026-01-31")).totals.issued_cents,
      668,
    );
    assert.equal(
      (await report("2026-02-01", "2026-02-01")).totals.issued_cents,
      333,
    );
    assert.equal(
      (await report("2026-03-01", "2026-03-31")).totals.issued_cents,
      0,
    );
    const adjustment = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-101,'2026-04-01','Feed reduction')",
      [adjustment, invoice],
    );
    assert.equal((await report()).horses[0].has_adjustments, true);
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,101,0,0,'Feed')",
      [crypto.randomUUID(), adjustment],
    );
    assert.equal((await report()).totals.issued_cents, 900);
    assert.equal((await report()).horses[0].has_adjustments, false);
    assert.equal(
      (await report("2026-01-30", "2026-01-31")).totals.issued_cents,
      600,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::integer n from inventory_movements",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from invoice_lines where id=$1",
          [line],
        )
      ).rows[0].amount_cents,
      1001,
    );
    await db.query("select void_invoice($1,'Correction')", [invoice]);
    assert.equal((await report()).totals.issued_cents, 0);
    const review = (
      await db.query<{ r: ManualFeedOptions }>(
        "select manual_feed_reporting($1,1) r",
        [invoice],
      )
    ).rows[0].r;
    assert.equal(review.lines[0].valid, false);
    assert.equal(review.lines[0].history.length, 1);
  } finally {
    await db.close();
  }
});
test("changed horse assignments invalidate periods; stale and late requests cannot restore old assignments; clearing and draft deletion retain history", async () => {
  const { db, h, second, invoice, line, report } = await fixture();
  try {
    const original = crypto.randomUUID();
    const save = (
      id: string,
      current: string | null,
      horse = h,
      reason = "Reviewed",
      clear = false,
    ) =>
      db.query(
        "select set_manual_feed_period($1,$2,$3,$4,null,1001,'2026-01-30','2026-02-01',$5,$6)",
        [id, line, current, horse, reason, clear],
      );
    await save(original, null);
    await save(original, null);
    await assert.rejects(
      save(original, null, h, "Changed"),
      /different values/,
    );
    await assert.rejects(save(crypto.randomUUID(), null), /changed/);
    await db.query(
      "select set_invoice_reporting_link($1,$2,$3,null,'New horse')",
      [crypto.randomUUID(), invoice, second],
    );
    assert.equal((await report()).totals.draft_cents, 0);
    assert.equal((await report()).unmatched_count, 1);
    await assert.rejects(
      save(crypto.randomUUID(), original),
      /assignment or charge changed/,
    );
    await save(original, null);
    assert.equal((await report()).totals.draft_cents, 0);
    const revised = crypto.randomUUID();
    await save(revised, original, second);
    assert.equal((await report()).totals.draft_cents, 1001);
    const clear = crypto.randomUUID();
    await save(clear, revised, second, "Clear reviewed period", true);
    await save(revised, original, second);
    assert.equal((await report()).totals.draft_cents, 0);
    assert.equal((await report()).unmatched_count, 1);
    await db.query("select remove_invoice_line($1)", [line]);
    await save(clear, revised, second, "Clear reviewed period", true);
    assert.equal(
      (
        await db.query("select id from manual_feed_periods where line_id=$1", [
          line,
        ])
      ).rows.length,
      3,
    );
    assert.equal(
      (await db.query("select id from invoice_lines where id=$1", [line])).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("delete from manual_feed_periods"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from manual_feed_periods")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from valid_manual_feed_periods")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select manual_feed_reporting($1,1)", [invoice]),
      /Administrator/,
    );
    await assert.rejects(save(crypto.randomUUID(), null), /Administrator/);
  } finally {
    await db.close();
  }
});
test("manual feed periods enforce stay bounds, current amounts, nonnegative manual source types and date limits", async () => {
  const { db, c, h, line } = await fixture();
  try {
    await assert.rejects(
      db.query(
        "select set_manual_feed_period($1,$2,null,$3,null,1000,'2026-01-01','2026-01-03','Wrong amount',false)",
        [crypto.randomUUID(), line, h],
      ),
      /assignment or charge changed/,
    );
    const stay = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,feed_monthly_cents) values($1,$2,'2026-01-01','2026-01-31',0,'separate_monthly',3100) returning id",
        [h, c],
      )
    ).rows[0].id;
    const i = crypto.randomUUID(),
      l = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-31')",
      [i, c, stay],
    );
    await db.query("select add_invoice_line($1,$2,'Feed',100,'feed')", [l, i]);
    const set = (from: string, to: string) =>
      db.query(
        "select set_manual_feed_period($1,$2,null,$3,$4,100,$5,$6,'Review',false)",
        [crypto.randomUUID(), l, h, stay, from, to],
      );
    await assert.rejects(set("2025-12-31", "2026-01-03"), /fit the assigned/);
    await assert.rejects(set("2026-01-01", "2026-02-01"), /fit the assigned/);
    await assert.rejects(set("2026-01-03", "2026-01-01"), /covered dates/);
    await assert.rejects(set("1900-01-01", "2026-01-01"), /covered dates/);
    await set("2026-01-01", "2026-01-03");
    await db.query("select add_monthly_service($1,'feed')", [i]);
    const generated = (
      await db.query<{ id: string }>(
        "select id from invoice_lines where invoice_id=$1 and kind='service'",
        [i],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query(
        "select set_manual_feed_period($1,$2,null,$3,$4,3100,'2026-01-01','2026-01-31','Wrong kind',false)",
        [crypto.randomUUID(), generated, h, stay],
      ),
      /manual feed line/,
    );
  } finally {
    await db.close();
  }
});
test("manual feed date inputs retain exact source context and require identifiers and a review reason", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    line_id: crypto.randomUUID(),
    horse_id: crypto.randomUUID(),
    amount_cents: "1001",
    from: "2026-01-30",
    to: "2026-02-01",
    reason: "Review",
  }))
    f.set(k, v);
  assert.equal(manualFeedPeriodValues(f).p_amount, 1001);
  f.set("amount_cents", "10.01");
  assert.throws(() => manualFeedPeriodValues(f));
  f.set("amount_cents", "1001");
  f.set("horse_id", "");
  assert.throws(() => manualFeedPeriodValues(f));
});
test("reusing a deleted draft line identifier on another invoice cannot inherit its old feed period; review pages are complete", async () => {
  const { db, c, h, invoice, line, report } = await fixture();
  try {
    const original = crypto.randomUUID();
    await db.query(
      "select set_manual_feed_period($1,$2,null,$3,null,1001,'2026-01-30','2026-02-01','Original',false)",
      [original, line, h],
    );
    await db.query("select remove_invoice_line($1)", [line]);
    const next = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2026-03-01','2026-03-08',null,null)",
      [next, c],
    );
    await db.query(
      "select add_invoice_line($1,$2,'Another feed charge',1001,'feed')",
      [line, next],
    );
    await db.query("select set_invoice_reporting_link($1,$2,$3,null,'Horse')", [
      crypto.randomUUID(),
      next,
      h,
    ]);
    assert.equal((await report()).totals.draft_cents, 0);
    await db.query(
      "select set_manual_feed_period($1,$2,null,$3,null,1001,'2026-01-30','2026-02-01','Original',false)",
      [original, line, h],
    );
    assert.equal((await report()).totals.draft_cents, 0);
    const revised = crypto.randomUUID();
    await db.query(
      "select set_manual_feed_period($1,$2,$3,$4,null,1001,'2026-01-30','2026-02-01','New invoice review',false)",
      [revised, line, original, h],
    );
    assert.equal((await report()).totals.draft_cents, 1001);
    for (let n = 0; n < 26; n++)
      await db.query(
        "select add_invoice_line($1,$2,'Additional feed',0,'feed')",
        [crypto.randomUUID(), next],
      );
    const page = async (n: number) =>
      (
        await db.query<{ r: ManualFeedOptions }>(
          "select manual_feed_reporting($1,$2) r",
          [next, n],
        )
      ).rows[0].r;
    const first = await page(1),
      second = await page(2);
    assert.equal(first.count, 27);
    assert.equal(first.lines.length, 25);
    assert.equal(second.lines.length, 2);
    assert.equal(
      new Set([...first.lines, ...second.lines].map((l) => l.id)).size,
      27,
    );
    await assert.rejects(page(0), /valid page/);
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select invoice_id id from manual_feed_periods where id=$1",
          [original],
        )
      ).rows[0].id,
      invoice,
    );
  } finally {
    await db.close();
  }
});
