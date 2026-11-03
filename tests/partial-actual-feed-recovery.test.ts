import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
} from "./helpers/inventory-database.ts";
import type { RecoveryOptions } from "../src/lib/actual-cost-recovery.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const c = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Recovery owner') returning id",
    )
  ).rows[0].id;
  const h = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Recovery horse') returning id",
    )
  ).rows[0].id;
  const stay = (
    await db.query<{ id: string }>(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing) values($1,$2,'2026-01-01','2026-02-28',0,'at_cost','at_cost') returning id",
      [h, c],
    )
  ).rows[0].id;
  const invoice = async () => {
    const id = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-01-31','2026-02-01')",
      [id, c, stay],
    );
    return id;
  };
  const inv = await invoice();
  const p = (
    await db.query<{ id: string }>(
      "select create_inventory_product('Original feed','feed',(select id from expense_categories where name='Feed')) id",
    )
  ).rows[0].id;
  const unit = (
    await db.query<{ id: string }>(
      "select id from inventory_units where product_id=$1 and label='oz'",
      [p],
    )
  ).rows[0].id;
  const opening = (
    await db.query<{ r: { movement_id: string } }>(
      "select record_stock_movement($1,$2,$3,3,'opening','2026-01-01',1000,null,'Stock') r",
      [crypto.randomUUID(), p, unit],
    )
  ).rows[0].r.movement_id;
  const movements: string[] = [];
  for (const date of ["2026-01-31", "2026-02-01"])
    movements.push(
      (
        await db.query<{ r: { movement_id: string } }>(
          "select record_stock_movement($1,$2,$3,1,'feeding',$4,null,$5,'Feeding') r",
          [crypto.randomUUID(), p, unit, date, h],
        )
      ).rows[0].r.movement_id,
    );
  const line = (
    await db.query<{ id: string }>("select add_actual_feed($1) id", [inv])
  ).rows[0].id;
  const lose = async (l = line) => {
    await db.exec("reset role");
    await db.query("delete from invoice_feed_claims where line_id=$1", [l]);
    await db.query("delete from invoice_boarding_claims where line_id=$1", [l]);
    await login(db, adminId);
  };
  const options = async (i = inv, page = 1) =>
    (
      await db.query<{ r: RecoveryOptions }>(
        "select actual_cost_recovery_options($1,$2) r",
        [i, page],
      )
    ).rows[0].r;
  const recover = async (
    l = line,
    req = crypto.randomUUID(),
    token?: string,
  ) => {
    const ctx = (await options()).lines.find((x) => x.id === l)!;
    const params = [
      req,
      l,
      token ?? ctx.source_token,
      "Matched original records",
    ];
    await db.query("select recover_actual_cost_sources($1,$2,$3,$4)", params);
    return params;
  };
  return {
    db,
    c,
    h,
    stay,
    inv,
    invoice,
    p,
    unit,
    opening,
    movements,
    line,
    lose,
    options,
    recover,
  };
}
async function loseOne(f: Awaited<ReturnType<typeof fixture>>) {
  await f.db.exec("reset role");
  await f.db.query("delete from invoice_feed_claims where movement_id=$1", [
    f.movements[1],
  ]);
  await login(f.db, adminId);
}
test("partial original feed links withhold incomplete dated revenue, then restore only the missing source with retained evidence", async () => {
  const f = await fixture();
  try {
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    await loseOne(f);
    const line = (await f.options()).lines[0];
    assert.equal(line.ready, true);
    assert.equal(line.linked_count, 1);
    assert.equal(line.missing_count, 1);
    assert.deepEqual(
      line.sources.map((x) => x.linked),
      [true, false],
    );
    let report = (
      await f.db.query<{
        r: {
          totals: { income_cents: number; profit_cents: number | null };
          undated_income_count: number;
        };
      }>("select recorded_business_profit('2026-01-01','2026-02-28') r")
    ).rows[0].r;
    assert.equal(report.undated_income_count, 1);
    assert.equal(report.totals.income_cents, 0);
    assert.equal(report.totals.profit_cents, null);
    const original = (
      await f.db.query(
        "select * from invoice_feed_claims where movement_id=$1",
        [f.movements[0]],
      )
    ).rows[0];
    const params = await f.recover();
    await f.db.query("select recover_actual_cost_sources($1,$2,$3,$4)", params);
    assert.deepEqual(
      (
        await f.db.query(
          "select * from invoice_feed_claims where movement_id=$1",
          [f.movements[0]],
        )
      ).rows[0],
      original,
    );
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      2,
    );
    assert.equal((await f.options()).count, 0);
    const audit = (
      await f.db.query<{
        captured_source: { linked_count: number; missing_count: number };
      }>("select captured_source from actual_cost_source_recoveries")
    ).rows[0];
    assert.equal(audit.captured_source.linked_count, 1);
    assert.equal(audit.captured_source.missing_count, 1);
    report = (
      await f.db.query<{ r: typeof report }>(
        "select recorded_business_profit('2026-01-01','2026-02-28') r",
      )
    ).rows[0].r;
    assert.equal(report.undated_income_count, 0);
    assert.equal(report.totals.income_cents, 667);
    assert.equal(report.totals.profit_cents, 0);
  } finally {
    await f.db.close();
  }
});
test("partial recovery validates the full original cost and refuses conflicting claims without altering surviving links", async () => {
  const f = await fixture();
  try {
    await loseOne(f);
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1000,1200,'Cost correction')",
      [crypto.randomUUID(), f.opening],
    );
    assert.equal((await f.options()).lines[0].ready, false);
    await assert.rejects(f.recover(), /do not equal/);
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      1,
    );
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1200,1000,'Resolved cost')",
      [crypto.randomUUID(), f.opening],
    );
    const other = await f.invoice();
    await f.db.query("select add_actual_feed($1)", [other]);
    assert.match((await f.options()).lines[0].reason!, /another charge/);
    await assert.rejects(f.recover(), /another charge/);
    assert.equal(
      (
        await f.db.query("select * from invoice_feed_claims where line_id=$1", [
          f.line,
        ])
      ).rows.length,
      1,
    );
  } finally {
    await f.db.close();
  }
});
test("a changed surviving source set invalidates an open recovery even when all original costs still match", async () => {
  const f = await fixture();
  try {
    await loseOne(f);
    const token = (await f.options()).lines[0].source_token!;
    await f.lose();
    await assert.rejects(
      f.recover(f.line, crypto.randomUUID(), token),
      /source records changed/,
    );
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      0,
    );
    await f.recover();
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      2,
    );
  } finally {
    await f.db.close();
  }
});
test("unexpected surviving links are surfaced and blocked rather than deleted or reassigned by recovery", async () => {
  const f = await fixture();
  try {
    await loseOne(f);
    await f.db.exec("reset role");
    await f.db.query(
      "update invoice_lines set source_snapshot=jsonb_set(source_snapshot,'{sources}',jsonb_build_array(source_snapshot->'sources'->1)) where id=$1",
      [f.line],
    );
    await login(f.db, adminId);
    const line = (await f.options()).lines[0];
    assert.equal(line.ready, false);
    assert.match(line.reason!, /do not match the original source set/);
    await assert.rejects(f.recover(), /original source set/);
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      1,
    );
    assert.equal(
      (await f.db.query("select * from actual_cost_source_recoveries")).rows
        .length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
