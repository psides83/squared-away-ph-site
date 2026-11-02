import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
  adminId,
} from "./helpers/inventory-database.ts";
import type { ManualServiceOptions } from "../src/lib/manual-service-periods.ts";
import { manualServicePeriodValues } from "../src/lib/manual-service-periods.ts";
import type { ServiceProfitability } from "../src/lib/service-profitability.ts";
import type { EntityMargins } from "../src/lib/service-assignments.ts";
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
  const stay = (
    await db.query<{ id: string }>(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,'2026-01-01','2026-01-31',0) returning id",
      [h, c],
    )
  ).rows[0].id;
  const invoice = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,null,'2026-03-01','2026-03-08',null,null)",
    [invoice, c],
  );
  await db.query(
    "select set_invoice_reporting_link($1,$2,$3,$4,'Horse and stay')",
    [crypto.randomUUID(), invoice, h, stay],
  );
  const line = async (service: string, amount = 1001) => {
    const id = crypto.randomUUID();
    await db.query("select add_invoice_line($1,$2,'Manual service',$3,$4)", [
      id,
      invoice,
      amount,
      service,
    ]);
    return id;
  };
  const options = async (page = 1) =>
    (
      await db.query<{ r: ManualServiceOptions }>(
        "select manual_service_reporting($1,$2) r",
        [invoice, page],
      )
    ).rows[0].r;
  const save = async (
    id: string,
    request = crypto.randomUUID(),
    current: string | null = null,
    from = "2026-01-01",
    to = "2026-01-03",
    clear = false,
    token?: string,
  ) => {
    const l = (await options()).lines.find((x) => x.id === id)!;
    const source = clear ? l.current : l;
    return db.query(
      "select set_manual_service_period($1,$2,$3,$4,$5,$6,$7,$8,'Reviewed source dates',$9,$10)",
      [
        request,
        id,
        current,
        source!.horse_id,
        source!.stay_id,
        source!.amount_cents,
        from,
        to,
        clear,
        token ?? (clear ? l.current!.source_token : l.source_token),
      ],
    );
  };
  const report = async (from = "2026-01-01", to = "2026-01-03") =>
    (
      await db.query<{ r: ServiceProfitability }>(
        "select service_profitability($1,$2) r",
        [from, to],
      )
    ).rows[0].r;
  return { db, c, h, stay, invoice, line, options, save, report };
}
test("manual training follows fully classified worked/rest days, rejects stale editors and invalidates changed classifications without changing bills", async () => {
  const { db, stay, invoice, line, options, save, report } = await fixture();
  try {
    const id = await line("training");
    await assert.rejects(save(id), /Classify every/);
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-01','worked')",
      [stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-02','2026-01-02','rest')",
      [stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-03','2026-01-03','nonbillable')",
      [stay],
    );
    const token = (await options()).lines[0].source_token!;
    const req = crypto.randomUUID();
    await save(id, req);
    await save(id, req);
    assert.equal(
      (await report()).services.find((x) => x.service === "training")
        ?.draft_cents,
      1001,
    );
    await db.query("select finalize_invoice($1)", [invoice]);
    assert.equal(
      (await report("2026-01-01", "2026-01-01")).services.find(
        (x) => x.service === "training",
      )?.gross_cents,
      501,
    );
    assert.equal(
      (await report("2026-01-02", "2026-01-02")).services.find(
        (x) => x.service === "training",
      )?.gross_cents,
      500,
    );
    assert.equal(
      (await report("2026-01-03", "2026-01-03")).services.find(
        (x) => x.service === "training",
      )?.gross_cents,
      0,
    );
    const entity = (
      await db.query<{ r: EntityMargins }>(
        "select service_entity_margins('2026-01-01','2026-01-03','stay') r",
      )
    ).rows[0].r;
    assert.equal(entity.rows[0].stay_id, stay);
    assert.equal(
      entity.rows[0].services.find((x) => x.service === "training")
        ?.gross_cents,
      1001,
    );
    await db.query(
      "select set_training_days($1,'2026-01-02','2026-01-02','nonbillable')",
      [stay],
    );
    assert.equal((await options()).lines[0].valid, false);
    assert.equal((await report()).unsupported_revenue_count, 1);
    await assert.rejects(
      save(
        id,
        crypto.randomUUID(),
        req,
        "2026-01-01",
        "2026-01-03",
        false,
        token,
      ),
      /changed/,
    );
    const next = crypto.randomUUID();
    await save(id, next, req);
    assert.equal(
      (await report("2026-01-01", "2026-01-01")).services.find(
        (x) => x.service === "training",
      )?.gross_cents,
      1001,
    );
    await save(id, req, null, "2026-01-01", "2026-01-03", false, token);
    assert.equal((await options()).lines[0].current?.id, next);
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-01','nonbillable')",
      [stay],
    );
    await assert.rejects(save(id, crypto.randomUUID(), next), /No worked/);
    assert.equal(
      (await db.query("select * from invoice_day_claims")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select issued_total_cents n from invoices where id=$1",
          [invoice],
        )
      ).rows[0].n,
      1001,
    );
  } finally {
    await db.close();
  }
});
test("manual board charges and credits use signed calendar days and reviewed invoice attribution in business, horse, stay and combined reports", async () => {
  const { db, stay, invoice, line, save, report } = await fixture();
  try {
    const a = await line("boarding"),
      b = await line("boarding", -101);
    await save(a);
    await save(b);
    await db.query("select finalize_invoice($1)", [invoice]);
    let r = await report();
    assert.equal(
      r.services.find((x) => x.service === "board")?.gross_cents,
      900,
    );
    for (const d of ["01", "02", "03"])
      assert.equal(
        (await report(`2026-01-${d}`, `2026-01-${d}`)).services.find(
          (x) => x.service === "board",
        )?.gross_cents,
        300,
      );
    const adj = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-51,'2026-03-04','Board credit')",
      [adj, invoice],
    );
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,0,51,0,'Board')",
      [crypto.randomUUID(), adj],
    );
    r = await report();
    assert.equal(
      r.services.find((x) => x.service === "board")?.adjustment_cents,
      -51,
    );
    assert.equal(r.unresolved_adjustment_count, 0);
    for (const scope of ["horse", "stay"]) {
      const e = (
        await db.query<{ r: EntityMargins }>(
          "select service_entity_margins('2026-01-01','2026-01-03',$1) r",
          [scope],
        )
      ).rows[0].r;
      assert.equal(
        e.rows[0].services.find((x) => x.service === "board")?.gross_cents,
        900,
      );
      const combined = (
        await db.query<{ r: { rows: { net_cents: number }[] } }>(
          "select combined_entity_profitability('2026-01-01','2026-01-03',$1) r",
          [scope],
        )
      ).rows[0].r;
      assert.equal(combined.rows[0].net_cents, 849);
    }
    assert.equal(
      (await db.query("select * from invoice_boarding_claims")).rows.length,
      0,
    );
    await db.query(
      "update training_stays set arrival_date='2026-01-02' where id=$1",
      [stay],
    );
    assert.ok((await report()).unsupported_revenue_count > 0);
  } finally {
    await db.close();
  }
});
test("manual service reviews retain clear/delete history, guard source identity and provide complete paging with administrator-only access", async () => {
  const { db, h, invoice, line, options, save } = await fixture();
  try {
    const id = await line("boarding");
    const req = crypto.randomUUID();
    await save(id, req);
    await assert.rejects(
      save(id, req, null, "2026-01-02", "2026-01-03"),
      /different values/,
    );
    const clear = crypto.randomUUID();
    await save(id, clear, req, "2026-01-01", "2026-01-03", true);
    await save(id, req);
    assert.equal((await options()).lines[0].valid, false);
    await db.query("select remove_invoice_line($1)", [id]);
    assert.equal((await options()).count, 0);
    const history = (
      await db.query<{ n: number }>(
        "select count(*)::integer n from manual_service_periods where line_id=$1",
        [id],
      )
    ).rows[0].n;
    assert.equal(history, 2);
    for (let n = 0; n < 27; n++) await line("boarding");
    assert.equal((await options()).count, 27);
    assert.equal((await options()).lines.length, 25);
    assert.equal((await options(2)).lines.length, 2);
    await assert.rejects(options(0), /valid page/);
    await assert.rejects(
      db.query("select * from manual_service_sources"),
      /permission denied/,
    );
    await login(db, outsiderId);
    await assert.rejects(options(), /Administrator/);
    assert.equal(
      (await db.query("select * from manual_service_periods")).rows.length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(options(), /permission denied/);
  } finally {
    await db.close();
  }
});
test("manual service input retains signed cents and an exact source token", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    line_id: crypto.randomUUID(),
    horse_id: crypto.randomUUID(),
    amount_cents: "-101",
    from: "2026-01-01",
    to: "2026-01-03",
    reason: "Review",
    source_token: "a".repeat(32),
  }))
    f.set(k, v);
  assert.equal(manualServicePeriodValues(f).p_amount, -101);
  f.set("source_token", "old");
  assert.throws(() => manualServicePeriodValues(f));
});

test("manual packages reconcile every cent with feed/board on physical days and training only on worked/rest days", async () => {
  const { db, stay, invoice, line, options, report } = await fixture();
  try {
    await db.query(
      "update training_stays set feed_billing='included',boarding_billing='included' where id=$1",
      [stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-01','worked')",
      [stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-02','2026-01-02','rest')",
      [stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-03','2026-01-03','nonbillable')",
      [stay],
    );
    const id = await line("training"),
      req = crypto.randomUUID();
    const l = (await options()).lines[0];
    const token = l.source_token!;
    const save = (
      feed = 201,
      board = 301,
      current: string | null = null,
      request = req,
      clear = false,
    ) =>
      db.query(
        "select set_manual_package_period($1,$2,$3,$4,$5,1001,'2026-01-01','2026-01-03','Actual package portions',$6,$7,$8,$9,true)",
        [
          request,
          id,
          current,
          l.horse_id,
          l.stay_id,
          clear,
          token,
          feed,
          board,
        ],
      );
    await save();
    await save();
    await assert.rejects(
      db.query(
        "select set_manual_service_period($1,$2,$3,$4,$5,1001,'2026-01-01','2026-01-03','Old client',false,$6)",
        [crypto.randomUUID(), id, req, l.horse_id, l.stay_id, token],
      ),
      /current package editor/,
    );
    await assert.rejects(save(202), /different values/);
    assert.equal(
      (await report()).services.find((x) => x.service === "training")
        ?.draft_cents,
      499,
    );
    await db.query("select finalize_invoice($1)", [invoice]);
    const r = await report();
    assert.equal(
      r.services.find((x) => x.service === "training")?.gross_cents,
      499,
    );
    assert.equal(
      r.services.find((x) => x.service === "board")?.gross_cents,
      301,
    );
    for (const [day, training, board] of [
      ["01", 250, 101],
      ["02", 249, 100],
      ["03", 0, 100],
    ] as const) {
      const x = await report(`2026-01-${day}`, `2026-01-${day}`);
      assert.equal(
        x.services.find((s) => s.service === "training")?.gross_cents,
        training,
      );
      assert.equal(
        x.services.find((s) => s.service === "board")?.gross_cents,
        board,
      );
      const feed = (
        await db.query<{
          r: {
            totals: { issued_cents: number };
            horses: { included: boolean; package_cents: number }[];
          };
        }>("select feed_charge_comparison($1,$1) r", [`2026-01-${day}`])
      ).rows[0].r;
      assert.equal(feed.totals.issued_cents, 67);
      assert.equal(feed.horses[0].included, false);
    }
    const stayFeed = (
      await db.query<{
        r: { rows: { package_review: boolean; issued_cents: number }[] };
      }>("select stay_feed_margins('2026-01-01','2026-01-03') r")
    ).rows[0].r;
    assert.equal(stayFeed.rows[0].package_review, false);
    assert.equal(stayFeed.rows[0].issued_cents, 201);
    const combined = (
      await db.query<{ r: { totals: { net_cents: number } } }>(
        "select combined_service_profitability('2026-01-01','2026-01-03') r",
      )
    ).rows[0].r;
    assert.equal(combined.totals.net_cents, 1001);
    const pkg = (
      await db.query<{
        r: {
          totals: {
            feed_cents: number;
            board_cents: number;
            training_cents: number;
          };
        };
      }>("select package_revenue_report('2026-03-01','2026-03-31') r")
    ).rows[0].r;
    assert.deepEqual(pkg.totals, {
      feed_cents: 201,
      board_cents: 301,
      training_cents: 499,
      unallocated_cents: 0,
    });
    assert.equal(
      (await db.query("select * from invoice_day_claims")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from invoice_feed_claims")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select issued_total_cents n from invoices where id=$1",
          [invoice],
        )
      ).rows[0].n,
      1001,
    );
    const adjustment = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-101,'2026-03-04','Discount')",
      [adjustment, invoice],
    );
    await db.query(
      "select set_adjustment_reporting($1,$2,null,51,30,20,0,'Manual categories')",
      [crypto.randomUUID(), adjustment],
    );
    const adjusted = (
      await db.query<{ r: { totals: { net_cents: number } } }>(
        "select combined_service_profitability('2026-01-01','2026-01-03') r",
      )
    ).rows[0].r;
    assert.equal(adjusted.totals.net_cents, 900);
    await save(201, 301, req, crypto.randomUUID(), true);
    await save();
    assert.equal((await options()).lines[0].valid, false);
    const staleFeed = (
      await db.query<{ r: { horses: { has_unmatched: boolean }[] } }>(
        "select feed_charge_comparison('2026-01-01','2026-01-03') r",
      )
    ).rows[0].r;
    assert.equal(staleFeed.horses[0].has_unmatched, true);
  } finally {
    await db.close();
  }
});
test("manual package caps and classification changes reject stale reviews; explicit zero portions remain supported", async () => {
  const { db, stay, invoice, line, options } = await fixture();
  try {
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-03','worked')",
      [stay],
    );
    const id = await line("training");
    let l = (await options()).lines[0];
    const token = l.source_token!;
    const set = (
      request: string,
      current: string | null,
      feed = 0,
      board = 0,
      t = token,
    ) =>
      db.query(
        "select set_manual_package_period($1,$2,$3,$4,$5,1001,'2026-01-01','2026-01-03','Reviewed',$6,$7,$8,$9,true)",
        [request, id, current, l.horse_id, l.stay_id, false, t, feed, board],
      );
    await assert.rejects(set(crypto.randomUUID(), null, 800, 300), /within/);
    const req = crypto.randomUUID();
    await set(req, null);
    await db.query("select finalize_invoice($1)", [invoice]);
    let f = (
      await db.query<{ r: { horses: { included: boolean }[] } }>(
        "select feed_charge_comparison('2026-01-01','2026-01-03') r",
      )
    ).rows[0].r;
    assert.equal(f.horses[0].included, false);
    await db.query(
      "select set_training_days($1,'2026-01-02','2026-01-02','nonbillable')",
      [stay],
    );
    assert.equal((await options()).lines[0].valid, false);
    await assert.rejects(set(crypto.randomUUID(), req), /changed/);
    const feed = (
      await db.query<{ r: { unmatched_count: number } }>(
        "select feed_charge_comparison('2026-01-01','2026-01-03') r",
      )
    ).rows[0].r;
    assert.equal(feed.unmatched_count, 1);
    l = (await options()).lines[0];
    const next = crypto.randomUUID();
    await set(next, req, 0, 0, l.source_token!);
    assert.equal((await options()).lines[0].valid, true);
    await set(req, null);
    assert.equal((await options()).lines[0].current?.id, next);
    await assert.rejects(
      db.query("select * from manual_package_review_queue"),
      /permission denied/,
    );
    await login(db, outsiderId);
    await assert.rejects(set(crypto.randomUUID(), next), /Administrator/);
  } finally {
    await db.close();
  }
});

test("manual package form requires explicit exact portions and caps them at the saved charge", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    line_id: crypto.randomUUID(),
    horse_id: crypto.randomUUID(),
    amount_cents: "1001",
    from: "2026-01-01",
    to: "2026-01-03",
    reason: "Package review",
    source_token: "a".repeat(32),
    package: "yes",
  }))
    f.set(k, v);
  assert.throws(() => manualServicePeriodValues(f));
  f.set("feed", "2.01");
  f.set("board", "3.01");
  assert.equal(manualServicePeriodValues(f).p_feed, 201);
  assert.equal(manualServicePeriodValues(f).p_board, 301);
  assert.equal(manualServicePeriodValues(f).p_package, true);
  f.set("board", "9.00");
  assert.throws(() => manualServicePeriodValues(f), /fit/);
  f.set("board", "0");
  f.set("feed", "0");
  assert.equal(manualServicePeriodValues(f).p_feed, 0);
  f.set("amount_cents", "-1");
  assert.throws(() => manualServicePeriodValues(f), /fit/);
});

test("historical generated training reviews reconstruct dated reporting with original month weights and never create billing reservations", async () => {
  const { db, c, h, stay, report } = await fixture();
  try {
    await db.query(
      "update training_stays set departure_date='2026-02-01',monthly_rate_cents=31000,feed_billing='included',boarding_billing='included' where id=$1",
      [stay],
    );
    await db.query(
      "select set_package_reporting($1,$2,null,6200,9300,'Original terms')",
      [crypto.randomUUID(), stay],
    );
    for (const [day, status] of [
      ["2026-01-30", "worked"],
      ["2026-01-31", "nonbillable"],
      ["2026-02-01", "rest"],
    ])
      await db.query("select set_training_days($1,$2,$2,$3)", [
        stay,
        day,
        status,
      ]);
    const invoice = crypto.randomUUID(),
      line = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-01-30','2026-02-01')",
      [invoice, c, stay],
    );
    // A legacy generated charge can exist without the claim rows required by today's generator.
    await db.exec("reset role");
    await db.query(
      "insert into invoice_lines(id,invoice_id,description,amount_cents,kind,billing_category,source_snapshot) values($1,$2,'Legacy generated training',1001,'training','training','{\"monthly_rate_cents\":31000}')",
      [line, invoice],
    );
    await login(db, adminId);
    const opts = async () =>
      (
        await db.query<{ r: ManualServiceOptions }>(
          "select manual_service_reporting($1) r",
          [invoice],
        )
      ).rows[0].r;
    const l = (await opts()).lines[0];
    assert.equal(l.source_kind, "training");
    assert.equal(l.has_billing_days, false);
    const req = crypto.randomUUID();
    const save = (
      clear = false,
      current: string | null = null,
      request = req,
    ) =>
      db.query(
        "select set_manual_package_period($1,$2,$3,$4,$5,1001,'2026-01-30','2026-02-01','Reconstructed historical dates',$6,$7,201,301,true)",
        [request, line, current, h, stay, clear, l.source_token],
      );
    await assert.rejects(
      db.query(
        "select set_manual_service_period($1,$2,null,$3,$4,1001,'2026-01-30','2026-02-01','Not a split',false,$5)",
        [crypto.randomUUID(), line, h, stay, l.source_token],
      ),
      /explicit feed and board/,
    );
    await save();
    await save();
    assert.equal((await opts()).lines[0].valid, true);
    await db.query("select finalize_invoice($1)", [invoice]);
    for (const [day, training, board, feed] of [
      ["2026-01-30", 237, 143, 95],
      ["2026-01-31", 0, 0, 0],
      ["2026-02-01", 262, 158, 106],
    ] as const) {
      const r = await report(day, day);
      assert.equal(
        r.services.find((s) => s.service === "training")?.gross_cents,
        training,
      );
      assert.equal(
        r.services.find((s) => s.service === "board")?.gross_cents,
        board,
      );
      const f = (
        await db.query<{ r: { totals: { issued_cents: number } } }>(
          "select feed_charge_comparison($1,$1) r",
          [day],
        )
      ).rows[0].r;
      assert.equal(f.totals.issued_cents, feed);
    }
    const full = (
      await db.query<{ r: { totals: { net_cents: number } } }>(
        "select combined_service_profitability('2026-01-30','2026-02-01') r",
      )
    ).rows[0].r;
    assert.equal(full.totals.net_cents, 1001);
    assert.equal(
      (
        await db.query("select * from invoice_day_claims where line_id=$1", [
          line,
        ])
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from invoice_feed_claims where line_id=$1", [
          line,
        ])
      ).rows.length,
      0,
    );
    const before = (
      await db.query<{ n: number }>(
        "select issued_total_cents n from invoices where id=$1",
        [invoice],
      )
    ).rows[0].n;
    assert.equal(before, 1001);
    await save(true, req, crypto.randomUUID());
    await save();
    assert.equal((await opts()).lines[0].valid, false);
    assert.equal(
      (
        await db.query("select * from invoice_day_claims where line_id=$1", [
          line,
        ])
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("historical date reviews go stale on classification changes and can be cleared when real billing claims supersede them", async () => {
  const { db, c, h, stay } = await fixture();
  try {
    await db.query(
      "update training_stays set monthly_rate_cents=31000,proration='calendar_days' where id=$1",
      [stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-03','worked')",
      [stay],
    );
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-01-01','2026-01-03')",
      [invoice, c, stay],
    );
    await db.query("select add_calendar_training($1)", [invoice]);
    const line = (
      await db.query<{ id: string }>(
        "select id from invoice_lines where invoice_id=$1 and kind='training'",
        [invoice],
      )
    ).rows[0].id;
    await db.exec("reset role");
    await db.query("delete from invoice_day_claims where line_id=$1", [line]);
    await login(db, adminId);
    const opts = async () =>
      (
        await db.query<{ r: ManualServiceOptions }>(
          "select manual_service_reporting($1) r",
          [invoice],
        )
      ).rows[0].r;
    const l = (await opts()).lines[0],
      req = crypto.randomUUID();
    const save = (
      request = req,
      current: string | null = null,
      token = l.source_token,
      clear = false,
    ) =>
      db.query(
        "select set_manual_package_period($1,$2,$3,$4,$5,3000,'2026-01-01','2026-01-03','Historical review',$6,$7,0,0,true)",
        [request, line, current, h, stay, clear, token],
      );
    await save();
    await db.query("select finalize_invoice($1)", [invoice]);
    await db.query(
      "select set_training_days($1,'2026-01-02','2026-01-02','nonbillable')",
      [stay],
    );
    assert.equal((await opts()).lines[0].valid, false);
    await assert.rejects(save(crypto.randomUUID(), req), /changed/);
    const next = crypto.randomUUID();
    await save(next, req, (await opts()).lines[0].source_token);
    const current = (await opts()).lines[0].current!;
    await db.exec("reset role");
    await db.query(
      "insert into invoice_day_claims(stay_id,day,line_id) values($1,'2026-01-01',$2)",
      [stay, line],
    );
    await login(db, adminId);
    const superseded = (await opts()).lines[0];
    assert.equal(superseded.has_billing_days, true);
    assert.equal(superseded.valid, false);
    assert.equal(superseded.source_token, null);
    await save(crypto.randomUUID(), next, current.source_token, true);
    assert.equal((await opts()).lines.length, 0);
    assert.equal(
      (
        await db.query("select * from invoice_day_claims where line_id=$1", [
          line,
        ])
      ).rows.length,
      1,
    );
    await save();
    assert.equal(
      (
        await db.query("select * from invoice_day_claims where line_id=$1", [
          line,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
