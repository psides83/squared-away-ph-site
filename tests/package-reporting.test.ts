import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { packageReportingValues } from "../src/lib/package-reporting.ts";
test("package reporting snapshots exact line cents, rejects stale agreements and leaves prior invoices unchanged", async () => {
  const db = await inventoryDatabase();
  try {
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
    const stay = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,monthly_rate_cents,feed_billing,boarding_billing,proration) values($1,$2,'2026-01-01',100000,'included','included','calendar_days') returning id",
        [h, c],
      )
    ).rows[0].id;
    const request = crypto.randomUUID();
    await db.query(
      "select set_package_reporting($1,$2,null,20000,30000,'Initial')",
      [request, stay],
    );
    await db.query(
      "select set_package_reporting($1,$2,null,20000,30000,'Initial')",
      [request, stay],
    );
    await assert.rejects(
      db.query(
        "select set_package_reporting($1,$2,null,20000,30001,'Initial')",
        [request, stay],
      ),
      /different values/,
    );
    await assert.rejects(
      db.query("select set_package_reporting($1,$2,null,20000,30000,'Stale')", [
        crypto.randomUUID(),
        stay,
      ]),
      /changed/,
    );
    await assert.rejects(
      db.query(
        "select set_package_reporting($1,$2,$3,90000,30000,'Too much')",
        [crypto.randomUUID(), stay, request],
      ),
      /fit within/,
    );
    const inv = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-31')",
      [inv, c, stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-31','worked',null)",
      [stay],
    );
    await db.query("select add_calendar_training($1)", [inv]);
    const line = (
      await db.query<{ id: string }>(
        "select id from invoice_lines where invoice_id=$1",
        [inv],
      )
    ).rows[0].id;
    const snapshot = async () =>
      (
        await db.query<{
          feed_cents: number;
          board_cents: number;
          training_cents: number;
        }>(
          "select feed_cents::integer,board_cents::integer,training_cents::integer from package_line_reporting where line_id=$1",
          [line],
        )
      ).rows[0];
    assert.deepEqual(await snapshot(), {
      feed_cents: 20000,
      board_cents: 30000,
      training_cents: 50000,
    });
    await db.query("select finalize_invoice($1)", [inv]);
    await db.query(
      "select set_package_reporting($1,$2,$3,25000,25000,'New agreement')",
      [crypto.randomUUID(), stay, request],
    );
    assert.deepEqual(await snapshot(), {
      feed_cents: 20000,
      board_cents: 30000,
      training_cents: 50000,
    });
    await db.query(
      "select set_package_reporting($1,$2,null,20000,30000,'Initial')",
      [request, stay],
    );
    assert.equal(
      (
        await db.query<{ id: string }>(
          "select id from package_reporting_agreements where stay_id=$1 and retired_at is null",
          [stay],
        )
      ).rows[0].id === request,
      false,
    );
    const report = (
      await db.query<{
        r: { totals: { feed_cents: number }; lines: unknown[] };
      }>("select package_revenue_report('2026-02-01','2026-02-28') r")
    ).rows[0].r;
    assert.equal(report.totals.feed_cents, 20000);
    assert.equal(report.lines.length, 1);
    assert.equal(
      (
        await db.query<{ r: { lines: unknown[] } }>(
          "select package_revenue_report('2026-01-01','2026-01-31') r",
        )
      ).rows[0].r.lines.length,
      0,
    );
    const adjustment = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-10001,'2026-03-01','Discount')",
      [adjustment, inv],
    );
    const allocation = crypto.randomUUID();
    await assert.rejects(
      db.query(
        "select set_adjustment_reporting($1,$2,null,5000,2000,3000,0,'Review')",
        [allocation, adjustment],
      ),
      /totaling/,
    );
    await db.query(
      "select set_adjustment_reporting($1,$2,null,5001,2000,3000,0,'Review')",
      [allocation, adjustment],
    );
    await db.query(
      "select set_adjustment_reporting($1,$2,null,5001,2000,3000,0,'Review')",
      [allocation, adjustment],
    );
    await assert.rejects(
      db.query(
        "select set_adjustment_reporting($1,$2,null,5001,2000,3000,0,'Changed')",
        [allocation, adjustment],
      ),
      /different values/,
    );
    await assert.rejects(
      db.query(
        "select set_adjustment_reporting($1,$2,null,5001,2000,3000,0,'Stale')",
        [crypto.randomUUID(), adjustment],
      ),
      /changed/,
    );
    const adjusted = (
      await db.query<{
        r: {
          adjustments: {
            amount_cents: number;
            allocation: { feed_cents: number };
          }[];
        };
      }>("select package_revenue_report('2026-02-01','2026-02-28') r")
    ).rows[0].r;
    assert.equal(adjusted.adjustments[0].amount_cents, -10001);
    assert.equal(adjusted.adjustments[0].allocation.feed_cents, 2000);
    // An invoice-date cohort includes later adjustments, without moving cash.
    assert.equal(
      (
        await db.query<{ r: { lines: unknown[] } }>(
          "select package_revenue_report('2026-03-01','2026-03-31') r",
        )
      ).rows[0].r.lines.length,
      0,
    );
    await assert.rejects(
      db.query("delete from package_line_reporting"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update adjustment_reporting_allocations set feed_cents=0"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from package_reporting_agreements")).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("select package_revenue_report('2026-01-01','2026-02-28')"),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select set_package_reporting($1,$2,null,0,0,'Unauthorized')", [
        crypto.randomUUID(),
        stay,
      ]),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});
test("package reporting validates input cents and identifiers", () => {
  const f = new FormData();
  f.set("request_id", crypto.randomUUID());
  f.set("stay_id", crypto.randomUUID());
  f.set("feed", "200.01");
  f.set("board", "300");
  f.set("reason", "Agreement");
  assert.equal(packageReportingValues(f).p_feed, 20001);
  f.set("feed", "-1");
  assert.throws(() => packageReportingValues(f));
});
test("package proration conserves pennies and changed rates require a fresh agreement", async () => {
  const db = await inventoryDatabase();
  try {
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
    const s = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,monthly_rate_cents,feed_billing,boarding_billing,proration) values($1,$2,'2026-01-01',100000,'included','included','calendar_days') returning id",
        [h, c],
      )
    ).rows[0].id;
    await db.query(
      "select set_package_reporting($1,$2,null,20000,30000,'Initial')",
      [crypto.randomUUID(), s],
    );
    async function generate(day: string) {
      const id = crypto.randomUUID();
      await db.query("select create_invoice($1,$2,$3,$4,$4,$4,$4)", [
        id,
        c,
        s,
        day,
      ]);
      await db.query("select set_training_days($1,$2,$2,'worked',null)", [
        s,
        day,
      ]);
      await db.query("select add_calendar_training($1)", [id]);
      return id;
    }
    const first = await generate("2026-01-01");
    const cents = (
      await db.query<{
        amount: number;
        feed: number;
        board: number;
        training: number;
      }>(
        "select l.amount_cents amount,p.feed_cents::integer feed,p.board_cents::integer board,p.training_cents::integer training from invoice_lines l join package_line_reporting p on p.line_id=l.id where invoice_id=$1",
        [first],
      )
    ).rows[0];
    assert.equal(cents.feed + cents.board + cents.training, cents.amount);
    assert.equal(cents.feed, 645);
    assert.equal(cents.board, 967);
    await db.query(
      "update training_stays set monthly_rate_cents=110000 where id=$1",
      [s],
    );
    const second = await generate("2026-01-02");
    assert.equal(
      (
        await db.query(
          "select p.* from package_line_reporting p join invoice_lines l on l.id=p.line_id where l.invoice_id=$1",
          [second],
        )
      ).rows.length,
      0,
    );
    await db.query(
      "select remove_invoice_line(id) from invoice_lines where invoice_id=$1",
      [first],
    );
    assert.equal(
      (await db.query("select * from package_line_reporting")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select package_revenue_report(null,'2026-01-01')"),
      /valid date/,
    );
  } finally {
    await db.close();
  }
});
