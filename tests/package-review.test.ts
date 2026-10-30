import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  packageReviewValues,
  type PackageReviewOptions,
} from "../src/lib/package-review.ts";
async function fixture(original = false) {
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
  const stay = (
    await db.query<{ id: string }>(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing,proration) values($1,$2,'2026-01-01','2026-01-03',100000,'included','included','calendar_days') returning id",
      [h, c],
    )
  ).rows[0].id;
  if (original)
    await db.query(
      "select set_package_reporting($1,$2,null,20000,30000,'Original plan')",
      [crypto.randomUUID(), stay],
    );
  const invoice = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08','2026-01-01','2026-01-03')",
    [invoice, c, stay],
  );
  await db.query(
    "select set_training_days($1,'2026-01-01','2026-01-03','worked',null)",
    [stay],
  );
  await db.query("select add_calendar_training($1)", [invoice]);
  const line = (
    await db.query<{ id: string }>(
      "select id from invoice_lines where invoice_id=$1",
      [invoice],
    )
  ).rows[0].id;
  const options = async () =>
    (
      await db.query<{ r: PackageReviewOptions }>(
        "select package_review_options($1,1) r",
        [invoice],
      )
    ).rows[0].r;
  const set = (
    request: string,
    current: string | null,
    feed = 1000,
    board = 2000,
    clear = false,
    reason = "Reviewed",
  ) =>
    db.query(
      "select set_package_reporting_review($1,$2,$3,$4,$5,9677,$6,$7,true,true,$8,$9)",
      [request, line, current, h, stay, feed, board, reason, clear],
    );
  return { db, h, c, stay, invoice, line, options, set };
}
test("historical package reviews supply all three reports without changing invoices, agreements or generated snapshots", async () => {
  const { db, h, invoice, line, options, set } = await fixture();
  try {
    await db.query("select finalize_invoice($1)", [invoice]);
    assert.equal((await options()).lines[0].original, null);
    assert.equal((await options()).lines[0].day_count, 3);
    const id = crypto.randomUUID();
    await set(id, null);
    await set(id, null);
    const effective = (await options()).lines[0];
    assert.equal(effective.original, null);
    assert.equal(effective.effective!.feed_cents, 1000);
    assert.equal(effective.effective!.board_cents, 2000);
    assert.equal(effective.effective!.training_cents, 6677);
    const cohort = (
      await db.query<{
        r: {
          totals: {
            feed_cents: number;
            board_cents: number;
            training_cents: number;
            unallocated_cents: number;
          };
        };
      }>("select package_revenue_report('2026-02-01','2026-02-28') r")
    ).rows[0].r;
    assert.deepEqual(cohort.totals, {
      feed_cents: 1000,
      board_cents: 2000,
      training_cents: 6677,
      unallocated_cents: 0,
    });
    const feed = (
      await db.query<{
        r: {
          totals: { issued_cents: number };
          horses: { horse_id: string; included: boolean }[];
        };
      }>("select feed_charge_comparison('2026-01-01','2026-01-03') r")
    ).rows[0].r;
    assert.equal(feed.totals.issued_cents, 1000);
    assert.equal(feed.horses.find((x) => x.horse_id === h)!.included, false);
    const services = (
      await db.query<{
        r: {
          services: { gross_cents: number }[];
          unsupported_revenue_count: number;
        };
      }>("select service_profitability('2026-01-01','2026-01-03') r")
    ).rows[0].r;
    assert.deepEqual(
      services.services.map((x) => x.gross_cents),
      [6677, 2000],
    );
    assert.equal(services.unsupported_revenue_count, 0);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::integer n from package_line_reporting where line_id=$1",
          [line],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::integer n from package_reporting_agreements",
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
      9677,
    );
    const clear = crypto.randomUUID();
    await set(clear, id, 1000, 2000, true, "Clear");
    await set(id, null);
    assert.equal((await options()).lines[0].effective, null);
    assert.equal((await options()).lines[0].history.length, 2);
  } finally {
    await db.close();
  }
});
test("reviewed overrides preserve originals, reject stale contexts and restore only through an explicit clear", async () => {
  const { db, h, stay, line, options, set } = await fixture(true);
  try {
    const original = (await options()).lines[0].original!;
    assert.equal(original.feed_cents, 1935);
    const id = crypto.randomUUID();
    await set(id, null);
    await assert.rejects(set(crypto.randomUUID(), null), /changed/);
    await assert.rejects(set(id, null, 1001), /different values/);
    await assert.rejects(
      set(crypto.randomUUID(), id, 9000, 1000),
      /within the saved/,
    );
    await assert.rejects(
      db.query(
        "select set_package_reporting_review($1,$2,$3,$4,$5,9676,1000,2000,true,true,'Wrong amount',false)",
        [crypto.randomUUID(), line, id, h, stay],
      ),
      /unchanged generated/,
    );
    const clear = crypto.randomUUID();
    await set(clear, id, 1000, 2000, true, "Return to original");
    await set(id, null);
    assert.equal((await options()).lines[0].effective!.feed_cents, 1935);
    assert.equal((await options()).lines[0].original!.feed_cents, 1935);
    await db.query("select remove_invoice_line($1)", [line]);
    await set(clear, id, 1000, 2000, true, "Return to original");
    assert.equal(
      (
        await db.query(
          "select id from package_reporting_reviews where line_id=$1",
          [line],
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select id from invoice_lines where id=$1", [line])).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("update package_reporting_reviews set feed_cents=0"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from package_reporting_reviews")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from effective_package_reporting")).rows.length,
      0,
    );
    await assert.rejects(options(), /Administrator/);
    await assert.rejects(set(crypto.randomUUID(), null), /Administrator/);
  } finally {
    await db.close();
  }
});
test("explicit zero-value service choices support reviewed adjustments without inventing included services", async () => {
  const { db, h, stay, line, invoice, options } = await fixture();
  try {
    await db.query(
      "select set_package_reporting_review($1,$2,null,$3,$4,9677,0,0,false,true,'Training and zero-value board',false)",
      [crypto.randomUUID(), line, h, stay],
    );
    await db.query("select finalize_invoice($1)", [invoice]);
    const adj = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,3,'2026-03-01','Board increase')",
      [adj, invoice],
    );
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,0,3,0,'Board')",
      [crypto.randomUUID(), adj],
    );
    const r = (
      await db.query<{
        r: {
          services: { adjustment_cents: number }[];
          unresolved_adjustment_count: number;
        };
      }>("select service_profitability('2026-01-01','2026-01-03') r")
    ).rows[0].r;
    assert.equal(r.services[1].adjustment_cents, 3);
    assert.equal(r.unresolved_adjustment_count, 0);
    const f = (
      await db.query<{ r: { horses: { included: boolean }[] } }>(
        "select feed_charge_comparison('2026-01-01','2026-01-03') r",
      )
    ).rows[0].r;
    assert.equal(f.horses[0].included, false);
    assert.equal((await options()).lines[0].effective!.feed_included, false);
  } finally {
    await db.close();
  }
});
test("review form validates exact cents and preserves explicit zero service choices", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    line_id: crypto.randomUUID(),
    horse_id: crypto.randomUUID(),
    stay_id: crypto.randomUUID(),
    amount_cents: "9677",
    feed: "10.01",
    board: "0",
    reason: "Review",
  }))
    f.set(k, v);
  const values = packageReviewValues(f);
  assert.equal(values.p_feed, 1001);
  assert.equal(values.p_feed_included, true);
  assert.equal(values.p_board_included, false);
  f.set("board_included", "on");
  assert.equal(packageReviewValues(f).p_board_included, true);
  f.set("feed", "1.001");
  assert.throws(() => packageReviewValues(f));
});
test("reviews require real saved training sources and cannot turn manual charges or voided invoices into package revenue", async () => {
  const { db, h, stay, invoice, line, set, options } = await fixture();
  try {
    const manual = crypto.randomUUID();
    await db.query(
      "select add_invoice_line($1,$2,'Manual training',100,'training')",
      [manual, invoice],
    );
    await assert.rejects(
      db.query(
        "select set_package_reporting_review($1,$2,null,$3,$4,100,0,0,false,false,'Wrong kind',false)",
        [crypto.randomUUID(), manual, h, stay],
      ),
      /generated training/,
    );
    await db.exec("reset role");
    await db.query("delete from invoice_day_claims where line_id=$1", [line]);
    const { adminId } = await import("./helpers/inventory-database.ts");
    await login(db, adminId);
    await assert.rejects(set(crypto.randomUUID(), null), /Saved training days/);
    assert.equal((await options()).lines[0].day_count, 0);
    await db.query("select void_invoice($1,'Void source')", [invoice]);
    await assert.rejects(set(crypto.randomUUID(), null), /generated training/);
    assert.equal(
      (await db.query("select * from package_reporting_reviews")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
