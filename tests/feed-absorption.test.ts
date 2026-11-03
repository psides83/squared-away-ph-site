import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import type { RecoveryOptions } from "../src/lib/actual-cost-recovery.ts";
import {
  feedAbsorptionValues,
  type AbsorptionReport,
} from "../src/lib/feed-absorption.ts";
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
async function absorptionFixture(remove = true) {
  const f = await fixture();
  if (remove) await f.db.query("select remove_invoice_line($1)", [f.line]);
  const report = async (page = 1) =>
    (
      await f.db.query<{ r: AbsorptionReport }>(
        "select feed_absorption_report('2026-01-01','2026-02-28',null,$1) r",
        [page],
      )
    ).rows[0].r;
  const save = async (
    m = f.movements[0],
    mode = "partial",
    cents: number | null = 100,
    req = crypto.randomUUID(),
  ) => {
    const row = (await report()).rows.find((x) => x.movement_id === m)!;
    const params = [
      req,
      m,
      row.current?.id ?? null,
      mode === "clear" ? row.current!.source_token : row.source_token,
      mode,
      cents,
      "Reviewed absorbed feed",
    ];
    await f.db.query(
      "select set_feed_absorption($1,$2,$3,$4,$5,$6,$7)",
      params,
    );
    return params;
  };
  const generate = async () =>
    (await f.db.query<{ id: string }>("select add_actual_feed($1) id", [f.inv]))
      .rows[0].id;
  return { ...f, report, save, generate };
}
test("partial and full fixed absorption reduce actual-cost charges without reducing full recorded costs, with net service-date weights and protected claims", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    await f.save(f.movements[1], "full", null);
    let r = await f.report();
    assert.equal(r.totals.cost_cents, 667);
    assert.equal(r.totals.absorbed_cents, 433);
    assert.equal(r.totals.supported_unbilled_cents, 233);
    const line = await f.generate();
    const saved = (
      await f.db.query<{
        amount_cents: number;
        source_snapshot: {
          sources: { cost_cents: number; absorbed_cost_cents: number }[];
        };
      }>("select amount_cents,source_snapshot from invoice_lines where id=$1", [
        line,
      ])
    ).rows[0];
    assert.equal(saved.amount_cents, 233);
    assert.equal(saved.source_snapshot.sources[1].cost_cents, 0);
    assert.equal(saved.source_snapshot.sources[0].absorbed_cost_cents, 100);
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    const profit = (
      await f.db.query<{
        r: {
          totals: {
            income_cents: number;
            cost_cents: number;
            profit_cents: number;
          };
        };
      }>("select recorded_business_profit('2026-01-01','2026-02-28') r")
    ).rows[0].r;
    assert.equal(profit.totals.income_cents, 233);
    assert.equal(profit.totals.cost_cents, 667);
    assert.equal(profit.totals.profit_cents, -434);
    const jan = (
      await f.db.query<{
        r: {
          totals: {
            issued_cents: number;
            absorbed_cents: number;
            unbilled_actual_cents: number;
          };
        };
      }>("select feed_charge_comparison('2026-01-01','2026-01-31') r")
    ).rows[0].r;
    assert.equal(jan.totals.issued_cents, 233);
    assert.equal(jan.totals.absorbed_cents, 100);
    assert.equal(jan.totals.unbilled_actual_cents, 0);
    r = await f.report();
    assert.equal(
      r.rows.every((x) => x.claimed),
      true,
    );
    await assert.rejects(
      f.save(f.movements[0], "clear", null),
      /unbilled saved/,
    );
    await assert.rejects(
      f.save(f.movements[0], "partial", 50),
      /Already-billed/,
    );
    assert.equal(
      (await f.db.query("select * from inventory_movements")).rows.length,
      3,
    );
    await f.lose(line);
    assert.equal(
      (await f.options()).lines.find((x) => x.id === line)!.ready,
      true,
    );
    await f.recover(line);
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      2,
    );
  } finally {
    await f.db.close();
  }
});
test("a corrected cost makes unbilled absorption pending, invalidates ready status and blocks billing until the owner reviews the fixed decision", async () => {
  const f = await absorptionFixture();
  try {
    await f.db.query(
      "select set_invoice_cost_ready($1,'feed',true,'Records checked')",
      [f.inv],
    );
    await f.save();
    const ready = (
      await f.db.query<{ r: { service: string; ready: boolean }[] }>(
        "select invoice_cost_readiness($1) r",
        [f.inv],
      )
    ).rows[0].r;
    assert.equal(ready.find((x) => x.service === "feed")!.ready, false);
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1000,1200,'Repriced stock')",
      [crypto.randomUUID(), f.opening],
    );
    assert.equal((await f.report()).totals.review_count, 1);
    await assert.rejects(f.generate(), /Review changed absorbed/);
    await f.save(f.movements[0], "review", null);
    assert.equal(
      (await f.report()).rows.find((x) => x.movement_id === f.movements[0])!
        .absorbed_cents,
      100,
    );
    assert.equal((await f.report()).totals.review_count, 0);
    const line = await f.generate();
    assert.equal(
      (
        await f.db.query<{ amount_cents: number }>(
          "select amount_cents from invoice_lines where id=$1",
          [line],
        )
      ).rows[0].amount_cents,
      700,
    );
  } finally {
    await f.db.close();
  }
});
test("full absorption retains exact fractional cost, generates a zero-dollar protected source line and cannot be charged a second time", async () => {
  const f = await absorptionFixture();
  try {
    await f.save(f.movements[0], "full", null);
    await f.save(f.movements[1], "full", null);
    const line = await f.generate();
    assert.equal(
      (
        await f.db.query<{ amount_cents: number }>(
          "select amount_cents from invoice_lines where id=$1",
          [line],
        )
      ).rows[0].amount_cents,
      0,
    );
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      2,
    );
    await assert.rejects(f.generate(), /No unbilled/);
    const amounts = (
      await f.db.query<{ exact: boolean }>(
        "select a.amount_cents=-m.value_delta_cents as exact from feed_absorptions a join inventory_movements m on m.id=a.movement_id",
      )
    ).rows;
    assert.equal(
      amounts.every((x) => x.exact),
      true,
    );
  } finally {
    await f.db.close();
  }
});
test("stale editors, oversized/zero amounts and old retries cannot replace a cleared decision; reversal removes operational totals and retains private history", async () => {
  const f = await absorptionFixture();
  try {
    await assert.rejects(f.save(f.movements[0], "partial", 334), /exceeds/);
    await assert.rejects(
      f.save(f.movements[0], "partial", 0),
      /current feeding/,
    );
    const old = await f.save();
    await f.db.query("select set_feed_absorption($1,$2,$3,$4,$5,$6,$7)", old);
    await f.save(f.movements[0], "clear", null);
    await f.db.query("select set_feed_absorption($1,$2,$3,$4,$5,$6,$7)", old);
    assert.equal((await f.report()).totals.absorbed_cents, 0);
    const stale = [...old];
    stale[0] = crypto.randomUUID();
    await assert.rejects(
      f.db.query("select set_feed_absorption($1,$2,$3,$4,$5,$6,$7)", stale),
      /absorbed amount changed/,
    );
    await f.save();
    await f.db.query("select reverse_stock_consumption($1,'Wrong feeding')", [
      f.movements[0],
    ]);
    assert.equal((await f.report()).count, 1);
    assert.equal(
      (await f.db.query("select * from feed_absorptions")).rows.length,
      3,
    );
  } finally {
    await f.db.close();
  }
});
test("original-source recovery and direct source inserts cannot bypass absorbed feed protection", async () => {
  const f = await absorptionFixture(false);
  try {
    await f.lose();
    await f.save();
    const o = await f.options();
    assert.equal(o.lines[0].ready, false);
    assert.match(o.lines[0].reason!, /protected absorbed/);
    await assert.rejects(f.recover(), /protected absorbed/);
    await f.db.exec("reset role");
    await assert.rejects(
      f.db.query(
        "insert into invoice_feed_claims(movement_id,stay_id,line_id) values($1,$2,$3)",
        [f.movements[0], f.stay, f.line],
      ),
      /protected absorbed/,
    );
    await login(f.db, adminId);
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("already-billed cost increases allow review of the same fixed amount without repricing the invoice; decreased costs cannot silently resize a saved full amount", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    const line = await f.generate();
    const oldAmount = (
      await f.db.query<{ amount_cents: number }>(
        "select amount_cents from invoice_lines where id=$1",
        [line],
      )
    ).rows[0].amount_cents;
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1000,1200,'Repriced stock')",
      [crypto.randomUUID(), f.opening],
    );
    await f.save(f.movements[0], "review", null);
    assert.equal((await f.report()).totals.review_count, 0);
    assert.equal(
      (
        await f.db.query<{ amount_cents: number }>(
          "select amount_cents from invoice_lines where id=$1",
          [line],
        )
      ).rows[0].amount_cents,
      oldAmount,
    );
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1200,100,'Lower corrected stock')",
      [crypto.randomUUID(), f.opening],
    );
    await assert.rejects(
      f.save(f.movements[0], "review", null),
      /exceeds the current/,
    );
  } finally {
    await f.db.close();
  }
});
test("absorption reports have complete paginated totals and cannot expose or mutate private decisions to customers or anonymous callers", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    await assert.rejects(
      f.db.query("delete from feed_absorptions"),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("select feed_absorbed($1)", [f.movements[0]]),
      /permission denied/,
    );
    await f.db.query(
      "select record_stock_movement($1,$2,$3,30,'adjustment_in','2026-02-01',3000,null,'Extra stock')",
      [crypto.randomUUID(), f.p, f.unit],
    );
    for (let n = 0; n < 25; n++)
      await f.db.query(
        "select record_stock_movement($1,$2,$3,1,'feeding','2026-02-01',null,$4,'More feeding')",
        [crypto.randomUUID(), f.p, f.unit, f.h],
      );
    assert.equal((await f.report()).count, 27);
    assert.equal((await f.report()).rows.length, 25);
    assert.equal((await f.report(2)).rows.length, 2);
    assert.deepEqual((await f.report()).totals, (await f.report(2)).totals);
    await login(f.db, outsiderId);
    await assert.rejects(f.report(), /Administrator/);
    assert.equal(
      (await f.db.query("select * from feed_absorptions")).rows.length,
      0,
    );
    await assert.rejects(
      f.db.query(
        "select set_feed_absorption($1,$2,null,$3,'full',null,'Denied')",
        [crypto.randomUUID(), f.movements[0], "a".repeat(32)],
      ),
      /Administrator/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(f.report(), /permission denied/);
  } finally {
    await f.db.close();
  }
});
test("feed absorption forms validate source evidence and fixed partial amounts", () => {
  const f = new FormData(),
    id = crypto.randomUUID();
  for (const [k, v] of Object.entries({
    request_id: id,
    movement_id: id,
    source_token: "a".repeat(32),
    mode: "partial",
    amount: "1.25",
    reason: "Absorb",
  }))
    f.set(k, v);
  assert.equal(feedAbsorptionValues(f).p_cents, 125);
  f.set("amount", "0");
  assert.throws(() => feedAbsorptionValues(f), /positive partial/);
  f.set("mode", "full");
  assert.equal(feedAbsorptionValues(f).p_cents, null);
  f.set("source_token", "invalid");
  assert.throws(() => feedAbsorptionValues(f), /feeding-cost review/);
});

test("at-cost remainder excludes included agreements while full recorded and absorbed costs remain visible", async () => {
  const f = await absorptionFixture();
  try {
    assert.equal((await f.report()).totals.supported_unbilled_cents, 667);
    await f.db.query(
      "update training_stays set feed_billing='included' where id=$1",
      [f.stay],
    );
    await f.save();
    let r = await f.report();
    assert.equal(r.totals.supported_unbilled_cents, 0);
    assert.equal(r.totals.cost_cents, 667);
    assert.equal(r.totals.absorbed_cents, 100);
    await assert.rejects(f.generate(), /actual-cost feed agreement/);
    await f.db.query(
      "update training_stays set feed_billing='at_cost' where id=$1",
      [f.stay],
    );
    r = await f.report();
    assert.equal(r.totals.supported_unbilled_cents, 567);
  } finally {
    await f.db.close();
  }
});
