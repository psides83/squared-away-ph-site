import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  monthlyServicePeriodValues,
  type MonthlyServiceOptions,
} from "../src/lib/monthly-service-periods.ts";
import type { BusinessProfitData } from "../src/lib/business-profit.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const c = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Monthly owner') returning id",
    )
  ).rows[0].id;
  const h = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Monthly horse') returning id",
    )
  ).rows[0].id;
  const stay = (
    await db.query<{ id: string }>(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,'2026-01-01','2026-03-31',0) returning id",
      [h, c],
    )
  ).rows[0].id;
  const inv = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-01-30','2026-02-01')",
    [inv, c, stay],
  );
  const line = async (
    service = "feed",
    amount = 1001,
    basis = "calendar_segments",
    id = crypto.randomUUID(),
  ) => {
    await db.exec("reset role");
    await db.query(
      "insert into invoice_lines(id,invoice_id,description,amount_cents,kind,source_snapshot) values($1,$2,'Historical monthly service',$3,'service',$4)",
      [
        id,
        inv,
        amount,
        { service, basis, monthly_rate_cents: 10000, stay_id: stay },
      ],
    );
    await login(db, adminId);
    return id;
  };
  const options = async (page = 1) =>
    (
      await db.query<{ r: MonthlyServiceOptions }>(
        "select monthly_service_reporting($1,$2) r",
        [inv, page],
      )
    ).rows[0].r;
  const save = async (
    id: string,
    from = "2026-01-30",
    to = "2026-02-01",
    request = crypto.randomUUID(),
    clear = false,
  ) => {
    const l = (await options()).lines.find((x) => x.id === id)!;
    const source = clear ? l.current! : l;
    const params = [
      request,
      id,
      l.current?.id ?? null,
      source.horse_id,
      source.stay_id,
      source.amount_cents,
      from,
      to,
      "Reviewed monthly dates",
      clear,
      source.source_token,
    ];
    await db.query(
      "select set_monthly_service_period($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      params,
    );
    return params;
  };
  const report = async (from = "2026-01-01", to = "2026-01-31") =>
    (
      await db.query<{ r: BusinessProfitData }>(
        "select recorded_business_profit($1,$2) r",
        [from, to],
      )
    ).rows[0].r;
  return { db, c, h, stay, inv, line, options, save, report };
}
test("reviewed monthly feed and board use physical days and month-length weights with exact saved cents, draft separation and no new claims", async () => {
  const f = await fixture();
  try {
    const feed = await f.line(),
      board = await f.line("boarding");
    await f.save(feed);
    await f.save(board);
    const product = (
      await f.db.query<{ id: string }>(
        "select create_inventory_product('Recorded feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await f.db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    await f.db.query(
      "select record_stock_movement($1,$2,$3,2,'opening','2026-01-01',0,null,'Stock')",
      [crypto.randomUUID(), product, unit],
    );
    for (const date of ["2026-01-30", "2026-02-01"])
      await f.db.query(
        "select record_stock_movement($1,$2,$3,1,'feeding',$4,null,$5,'Recorded feeding')",
        [crypto.randomUUID(), product, unit, date, f.h],
      );

    assert.equal((await f.report()).totals.income_cents, 0);
    assert.equal((await f.report()).services.totals.draft_cents, 1288);
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    const jan = await f.report(),
      feb = await f.report("2026-02-01", "2026-02-28");
    assert.equal(jan.totals.income_cents, 1288);
    assert.equal(feb.totals.income_cents, 714);
    assert.equal(jan.totals.profit_cents, 1288);
    assert.equal(jan.undated_income_count, 0);
    const sum = jan.totals.income_cents + feb.totals.income_cents;
    assert.equal(sum, 2002);
    for (const table of [
      "invoice_service_days",
      "invoice_feed_claims",
      "invoice_boarding_claims",
      "invoice_day_claims",
    ])
      assert.equal((await f.db.query(`select * from ${table}`)).rows.length, 0);
    assert.equal(
      (await f.options()).lines.every((x) => x.valid),
      true,
    );
  } finally {
    await f.db.close();
  }
});
test("monthly reviews reject out-of-stay/future dates and stale snapshot changes; exact and late retries never restore cleared dates", async () => {
  const f = await fixture();
  try {
    const id = await f.line();
    await assert.rejects(f.save(id, "2025-12-31"), /physical boarding/);
    await assert.rejects(
      f.save(id, "2026-01-01", "2099-01-01"),
      /elapsed covered/,
    );
    const params = await f.save(id);
    await f.db.query(
      "select set_monthly_service_period($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      params,
    );
    const forged = [...params];
    forged[9] = true;
    await assert.rejects(
      f.db.query(
        "select set_monthly_service_period($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        forged,
      ),
      /different values/,
    );
    await f.db.exec("reset role");
    await f.db.query(
      "update invoice_lines set source_snapshot=source_snapshot||'{\"monthly_rate_cents\":12000}'::jsonb where id=$1",
      [id],
    );
    await login(f.db, adminId);
    assert.equal((await f.options()).lines[0].valid, false);
    const stale = [...params];
    stale[0] = crypto.randomUUID();
    stale[2] = params[0];
    await assert.rejects(
      f.db.query(
        "select set_monthly_service_period($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        stale,
      ),
      /source snapshot/,
    );
    await f.save(id);
    await f.save(id, "2026-01-30", "2026-02-01", crypto.randomUUID(), true);
    await f.db.query(
      "select set_monthly_service_period($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      params,
    );
    assert.equal((await f.options()).lines[0].valid, false);
    assert.equal((await f.options()).lines[0].current!.cleared, true);
  } finally {
    await f.db.close();
  }
});
test("actual-cost and unknown-format charges stay unsupported; returning original sources supersedes historical dates without duplicate revenue", async () => {
  const f = await fixture();
  try {
    await f.line("feed", 400, "consumption");
    await f.line("boarding", 500, "assigned_cost");
    await f.line("feed", 600, "unknown");
    const feed = await f.line();
    await f.save(feed);
    assert.equal((await f.options()).count, 1);
    await f.db.exec("reset role");
    await f.db.query(
      "insert into invoice_service_days(stay_id,service,day,line_id) values($1,'feed','2026-02-02',$2)",
      [f.stay, feed],
    );
    await login(f.db, adminId);
    let opt = (await f.options()).lines[0];
    assert.equal(opt.valid, false);
    assert.equal(opt.missing_sources, false);
    await assert.rejects(f.save(feed), /without saved/);
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    const feb = await f.report("2026-02-01", "2026-02-28");
    assert.equal(feb.services.totals.net_cents, 1001);
    assert.equal(feb.undated_income_count, 3);
    assert.equal(feb.totals.profit_cents, null);
    await f.save(feed, "2026-01-30", "2026-02-01", crypto.randomUUID(), true);
    assert.equal((await f.options()).count, 0);
  } finally {
    await f.db.close();
  }
});
test("deleted/reused source IDs cannot inherit dates, and void invoices stop contributing while evidence stays private", async () => {
  const f = await fixture();
  try {
    const id = await f.line("boarding");
    const old = await f.save(id);
    await f.db.exec("reset role");
    await f.db.query("delete from invoice_lines where id=$1", [id]);
    await login(f.db, adminId);
    await f.line("boarding", 1001, "calendar_segments", id);
    assert.equal((await f.options()).lines[0].valid, false);
    await f.db.query(
      "select set_monthly_service_period($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      old,
    );
    assert.equal((await f.options()).lines[0].valid, false);
    await f.save(id);
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    assert.equal((await f.report()).totals.profit_cents, 644);
    await f.db.exec("reset role");
    await f.db.query("update invoices set status='void' where id=$1", [f.inv]);
    await login(f.db, adminId);
    assert.equal((await f.report()).totals.profit_cents, 0);
    assert.equal((await f.options()).count, 0);
    assert.equal(
      (await f.db.query("select * from monthly_service_periods")).rows.length,
      2,
    );
  } finally {
    await f.db.close();
  }
});
test("complete monthly queue pagination and admin-only private sources, RPCs and immutable audit rows", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 27; i++) await f.line();
    assert.equal((await f.options()).count, 27);
    assert.equal((await f.options()).lines.length, 25);
    assert.equal((await f.options(2)).lines.length, 2);
    await assert.rejects(f.options(0), /valid page/);
    await assert.rejects(
      f.db.query("select * from monthly_service_sources"),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("delete from monthly_service_periods"),
      /permission denied/,
    );
    const id = (await f.options()).lines[0].id;
    await f.save(id);
    const count = (await f.db.query("select * from monthly_service_periods"))
      .rows.length;
    assert.equal(count, 1);
    await login(f.db, outsiderId);
    await assert.rejects(f.options(), /Administrator/);
    assert.equal(
      (await f.db.query("select * from monthly_service_periods")).rows.length,
      0,
    );
    await assert.rejects(
      f.db.query(
        "select set_monthly_service_period($1,$2,null,$3,$4,1001,'2026-01-30','2026-02-01','Denied',false,$5)",
        [crypto.randomUUID(), id, f.h, f.stay, "a".repeat(32)],
      ),
      /Administrator/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(f.options(), /permission denied/);
  } finally {
    await f.db.close();
  }
});
test("monthly input requires nonnegative saved cents, a stay and current source evidence", () => {
  const f = new FormData(),
    id = crypto.randomUUID();
  for (const [k, v] of Object.entries({
    request_id: id,
    line_id: id,
    horse_id: id,
    stay_id: id,
    source_token: "a".repeat(32),
    amount_cents: "1001",
    from: "2026-01-30",
    to: "2026-02-01",
    reason: "Review",
  }))
    f.set(k, v);
  assert.equal(monthlyServicePeriodValues(f).p_amount, 1001);
  f.set("amount_cents", "-1");
  assert.throws(() => monthlyServicePeriodValues(f), /monthly charge/);
  f.set("amount_cents", "1001");
  f.delete("stay_id");
  assert.throws(() => monthlyServicePeriodValues(f), /monthly charge/);
});

test("stay-bound changes invalidate monthly dates and reviewed zero-dollar lines remain supported without inventing income", async () => {
  const f = await fixture();
  try {
    const board = await f.line("boarding", 0);
    await f.save(board);
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    assert.equal((await f.report()).undated_income_count, 0);
    assert.equal((await f.report()).totals.profit_cents, 0);
    await f.db.exec("reset role");
    await f.db.query(
      "update training_stays set arrival_date='2026-01-02' where id=$1",
      [f.stay],
    );
    await login(f.db, adminId);
    assert.equal((await f.options()).lines[0].valid, false);
    assert.equal((await f.report()).undated_income_count, 1);
    assert.equal((await f.report()).totals.profit_cents, null);
    await f.save(board);
    assert.equal((await f.report()).totals.profit_cents, 0);
  } finally {
    await f.db.close();
  }
});

test("physical-day monthly source reviews accept feed and board, reconcile exact cents and enforce a single calendar month", async () => {
  const f = await fixture();
  try {
    const feed = await f.line("feed", 1001, "physical_days"),
      board = await f.line("boarding", 1001, "physical_days");
    assert.equal((await f.options()).count, 2);
    assert.equal(
      (await f.options()).lines.every((x) => x.basis === "physical_days"),
      true,
    );
    await assert.rejects(f.save(feed), /one calendar month/);
    assert.equal(
      (await f.db.query("select * from monthly_service_periods")).rows.length,
      0,
    );
    await f.save(feed, "2026-01-30", "2026-01-31");
    await f.save(board, "2026-01-30", "2026-01-31");
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    assert.equal(
      (await f.report("2026-01-30", "2026-01-30")).totals.income_cents,
      1002,
    );
    assert.equal(
      (await f.report("2026-01-31", "2026-01-31")).totals.income_cents,
      1000,
    );
    assert.equal((await f.report()).totals.income_cents, 2002);
    assert.equal(
      (await f.db.query("select * from invoice_service_days")).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("physical-day original source dates are suggested without replacing a saved review; basis changes invalidate old reviews and unknown formats stay unsupported", async () => {
  const f = await fixture();
  try {
    const line = await f.line("boarding", 1001, "physical_days");
    await f.db.exec("reset role");
    await f.db.query(
      'update invoice_lines set source_snapshot=source_snapshot||\'{"period_from":"2026-01-10","period_to":"2026-01-12"}\'::jsonb where id=$1',
      [line],
    );
    await login(f.db, adminId);
    const row = (await f.options()).lines[0];
    assert.equal(row.original_from, "2026-01-10");
    assert.equal(row.original_to, "2026-01-12");
    assert.equal(row.period_to, "2026-02-01");
    await f.save(line, "2026-01-10", "2026-01-12");
    await f.db.exec("reset role");
    await f.db.query(
      'update invoice_lines set source_snapshot=source_snapshot||\'{"basis":"calendar_segments"}\'::jsonb where id=$1',
      [line],
    );
    await login(f.db, adminId);
    assert.equal((await f.options()).lines[0].valid, false);
    await f.save(line);
    assert.equal((await f.options()).lines[0].valid, true);
    await f.db.exec("reset role");
    await f.db.query(
      'update invoice_lines set source_snapshot=source_snapshot||\'{"basis":"physical_days"}\'::jsonb where id=$1',
      [line],
    );
    await login(f.db, adminId);
    assert.equal((await f.options()).lines[0].valid, false);
    await assert.rejects(f.save(line), /one calendar month/);
    await f.line("feed", 1001, "unrecognized_monthly");
    assert.equal((await f.options()).count, 1);
  } finally {
    await f.db.close();
  }
});
test("native manual monthly-generator snapshots can recover missing dates without changing customer charges or recreating billing reservations", async () => {
  const f = await fixture();
  try {
    await f.db.query(
      "update training_stays set feed_billing='separate_monthly',feed_monthly_cents=31000,boarding_billing='separate_monthly',boarding_monthly_cents=62000 where id=$1",
      [f.stay],
    );
    const invoice = crypto.randomUUID();
    await f.db.query(
      "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-01-30','2026-01-31')",
      [invoice, f.c, f.stay],
    );
    const feed = (
        await f.db.query<{ id: string }>(
          "select add_monthly_service($1,'feed') id",
          [invoice],
        )
      ).rows[0].id,
      board = (
        await f.db.query<{ id: string }>(
          "select add_monthly_service($1,'boarding') id",
          [invoice],
        )
      ).rows[0].id;
    const before = (
      await f.db.query(
        "select id,amount_cents,source_snapshot from invoice_lines where invoice_id=$1 order by id",
        [invoice],
      )
    ).rows;
    await f.db.exec("reset role");
    await f.db.query(
      "delete from invoice_service_days where line_id in ($1,$2)",
      [feed, board],
    );
    await login(f.db, adminId);
    const opts = async () =>
      (
        await f.db.query<{ r: MonthlyServiceOptions }>(
          "select monthly_service_reporting($1) r",
          [invoice],
        )
      ).rows[0].r;
    for (const line of (await opts()).lines) {
      assert.equal(line.basis, "physical_days");
      assert.equal(line.original_from, "2026-01-30");
      await f.db.query(
        "select set_monthly_service_period($1,$2,null,$3,$4,$5,'2026-01-30','2026-01-31','Original monthly source date review',false,$6)",
        [
          crypto.randomUUID(),
          line.id,
          line.horse_id,
          line.stay_id,
          line.amount_cents,
          line.source_token,
        ],
      );
    }
    await f.db.query("select finalize_invoice($1)", [invoice]);
    assert.equal((await f.report()).totals.income_cents, 6000);
    assert.deepEqual(
      (
        await f.db.query(
          "select id,amount_cents,source_snapshot from invoice_lines where invoice_id=$1 order by id",
          [invoice],
        )
      ).rows,
      before,
    );
    assert.equal(
      (await f.db.query("select * from invoice_service_days")).rows.length,
      0,
    );
    // Existing sources take precedence again when recovered separately.
    await f.db.exec("reset role");
    await f.db.query(
      "insert into invoice_service_days(stay_id,service,day,line_id) values($1,'feed','2026-01-30',$2),($1,'feed','2026-01-31',$2)",
      [f.stay, feed],
    );
    await login(f.db, adminId);
    assert.equal((await opts()).lines.find((x) => x.id === feed)!.valid, false);
    assert.equal((await f.report()).totals.income_cents, 6000);
  } finally {
    await f.db.close();
  }
});
