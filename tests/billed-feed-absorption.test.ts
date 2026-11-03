import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import type { RecoveryOptions } from "../src/lib/actual-cost-recovery.ts";
import type { AbsorptionReport } from "../src/lib/feed-absorption.ts";
import type { AbsorptionInvoiceReview } from "../src/lib/feed-absorption-invoice-review.ts";
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
async function saveBilled(
  f: Awaited<ReturnType<typeof absorptionFixture>>,
  mode = "partial",
  cents: number | null = 200,
  request = crypto.randomUUID(),
) {
  const r = (await f.report()).rows.find(
    (x) => x.movement_id === f.movements[0],
  )!;
  const args = [
    request,
    r.movement_id,
    r.current?.id ?? null,
    mode === "clear" ? r.current!.source_token : r.source_token,
    mode,
    cents,
    "Owner manually reviews billed change",
    true,
  ];
  await f.db.query("select set_feed_absorption($1,$2,$3,$4,$5,$6,$7,$8)", args);
  return args;
}
async function review(f: Awaited<ReturnType<typeof absorptionFixture>>) {
  return (
    await f.db.query<{ r: AbsorptionInvoiceReview }>(
      "select invoice_feed_absorption_reviews($1) r",
      [f.inv],
    )
  ).rows[0].r;
}
test("corrected draft feed review accepts regenerated net costs and still rejects stale costs and pending absorbed decisions", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    const line = await f.generate();
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1000,1200,'Corrected cost')",
      [crypto.randomUUID(), f.opening],
    );
    const correction = (
      await f.db.query<{ correction_id: string }>(
        "select correction_id from invoice_feed_cost_flags where invoice_id=$1",
        [f.inv],
      )
    ).rows[0].correction_id;
    await assert.rejects(
      f.db.query("select resolve_feed_cost_flag($1,$2,'Checked')", [
        correction,
        f.inv,
      ]),
      /absorbed feed decisions/,
    );
    await f.save(f.movements[0], "review", null);
    await assert.rejects(
      f.db.query("select resolve_feed_cost_flag($1,$2,'Checked')", [
        correction,
        f.inv,
      ]),
      /regenerate/,
    );
    await f.db.query("select remove_invoice_line($1)", [line]);
    const next = await f.generate();
    assert.equal(
      (
        await f.db.query<{ amount_cents: number }>(
          "select amount_cents from invoice_lines where id=$1",
          [next],
        )
      ).rows[0].amount_cents,
      700,
    );
    await f.db.query(
      "select resolve_feed_cost_flag($1,$2,'Regenerated net feed costs after fixed absorption')",
      [correction, f.inv],
    );
    assert.equal(
      (
        await f.db.query(
          "select * from invoice_feed_cost_flags where invoice_id=$1 and resolved_at is null",
          [f.inv],
        )
      ).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("changed billed protection flags the invoice and withholds margins without creating any credit, charge, refund or payment", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    const line = await f.generate();
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    const before = (
      await f.db.query(
        "select amount_cents,source_snapshot from invoice_lines where id=$1",
        [line],
      )
    ).rows[0];
    const args = await saveBilled(f);
    await f.db.query(
      "select set_feed_absorption($1,$2,$3,$4,$5,$6,$7,$8)",
      args,
    );
    assert.equal((await review(f)).pending_count, 1);
    assert.deepEqual(
      (
        await f.db.query(
          "select amount_cents,source_snapshot from invoice_lines where id=$1",
          [line],
        )
      ).rows[0],
      before,
    );
    for (const table of [
      "invoice_adjustments",
      "invoice_refunds",
      "invoice_payments",
    ])
      assert.equal((await f.db.query(`select * from ${table}`)).rows.length, 0);
    let profit = (
      await f.db.query<{ r: { totals: { profit_cents: number | null } } }>(
        "select recorded_business_profit('2026-01-01','2026-02-28') r",
      )
    ).rows[0].r;
    assert.equal(profit.totals.profit_cents, null);
    const snapshot = await review(f);
    await f.db.query(
      "select resolve_feed_absorption_invoice($1,$2,'Reviewed charges; no correction needed after checking agreement')",
      [f.inv, snapshot.source_token],
    );
    assert.equal((await review(f)).pending_count, 0);
    assert.equal((await review(f)).history.length, 1);
    profit = (
      await f.db.query<{ r: typeof profit }>(
        "select recorded_business_profit('2026-01-01','2026-02-28') r",
      )
    ).rows[0].r;
    assert.equal(profit.totals.profit_cents, -100);
    await f.db.query(
      "select resolve_feed_absorption_invoice($1,$2,'Retry without changing history')",
      [f.inv, snapshot.source_token],
    );
    assert.equal(
      (await review(f)).history[0].resolution,
      "Reviewed charges; no correction needed after checking agreement",
    );
  } finally {
    await f.db.close();
  }
});
test("clearing billed protection requires acknowledgement, keeps invoice money unchanged and later events invalidate an open resolution", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    await f.generate();
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    await assert.rejects(
      f.save(f.movements[0], "clear", null),
      /unbilled saved/,
    );
    await saveBilled(f, "clear", null);
    const old = await review(f);
    await saveBilled(f, "partial", 50);
    assert.equal((await review(f)).pending_count, 2);
    await assert.rejects(
      f.db.query("select resolve_feed_absorption_invoice($1,$2,'Stale')", [
        f.inv,
        old.source_token,
      ]),
      /changed/,
    );
    const current = await review(f);
    await f.db.query(
      "select resolve_feed_absorption_invoice($1,$2,'Manual changes reviewed')",
      [f.inv, current.source_token],
    );
    assert.equal((await review(f)).history.length, 2);
    assert.equal(
      (await f.db.query("select * from invoice_adjustments")).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("draft billed changes must be regenerated before resolution and finalization; new net snapshots permit explicit manual resolution", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    const line = await f.generate();
    await saveBilled(f);
    const r = await review(f);
    await assert.rejects(
      f.db.query("select finalize_invoice($1)", [f.inv]),
      /absorbed-feed billing changes/,
    );
    await assert.rejects(
      f.db.query(
        "select resolve_feed_absorption_invoice($1,$2,'Not regenerated')",
        [f.inv, r.source_token],
      ),
      /regenerate/,
    );
    await f.db.query("select remove_invoice_line($1)", [line]);
    const next = await f.generate();
    assert.equal(
      (
        await f.db.query<{ amount_cents: number }>(
          "select amount_cents from invoice_lines where id=$1",
          [next],
        )
      ).rows[0].amount_cents,
      467,
    );
    const current = await review(f);
    await f.db.query(
      "select resolve_feed_absorption_invoice($1,$2,'Removed and regenerated draft source')",
      [f.inv, current.source_token],
    );
    await f.db.query("select finalize_invoice($1)", [f.inv]);
  } finally {
    await f.db.close();
  }
});
test("cost reductions below old protection can be explicitly revised and flagged; unchanged reviews create no new billing event", async () => {
  const f = await absorptionFixture();
  try {
    await f.save(f.movements[0], "full", null);
    await f.generate();
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1000,600,'Corrected lower stock cost')",
      [crypto.randomUUID(), f.opening],
    );
    await saveBilled(f, "full", null);
    assert.equal((await review(f)).pending_count, 1);
    await f.save(f.movements[0], "review", null);
    assert.equal((await review(f)).pending_count, 1);
    assert.equal((await f.report()).totals.review_count, 0);
  } finally {
    await f.db.close();
  }
});
test("billed review evidence and resolution helpers remain administrator-only and immutable through direct writes", async () => {
  const f = await absorptionFixture();
  try {
    await f.generate();
    await saveBilled(f);
    await assert.rejects(
      f.db.query("delete from feed_absorption_invoice_reviews"),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("select feed_absorption_invoice_token($1)", [f.inv]),
      /permission denied/,
    );
    await login(f.db, outsiderId);
    await assert.rejects(review(f), /Administrator/);
    assert.equal(
      (await f.db.query("select * from feed_absorption_invoice_reviews")).rows
        .length,
      0,
    );
    await assert.rejects(
      f.db.query("select resolve_feed_absorption_invoice($1,$2,'Denied')", [
        f.inv,
        "a".repeat(32),
      ]),
      /Administrator/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(review(f), /permission denied/);
  } finally {
    await f.db.close();
  }
});

test("manual invoice adjustments invalidate a pending review token and are never created by resolving the follow-up", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    await f.generate();
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    await saveBilled(f);
    const old = await review(f);
    await f.db.query(
      "select adjust_invoice($1,$2,-100,'2026-03-02','Owner-entered correction')",
      [crypto.randomUUID(), f.inv],
    );
    await assert.rejects(
      f.db.query(
        "select resolve_feed_absorption_invoice($1,$2,'Old preview')",
        [f.inv, old.source_token],
      ),
      /changed/,
    );
    const now = await review(f);
    await f.db.query(
      "select resolve_feed_absorption_invoice($1,$2,'Entered invoice correction manually')",
      [f.inv, now.source_token],
    );
    assert.equal(
      (await f.db.query("select * from invoice_adjustments")).rows.length,
      1,
    );
    assert.equal(
      (await f.db.query("select * from invoice_refunds")).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("all pending decisions are available for one invoice review beyond 25 records; resolved display is bounded while private history is complete", async () => {
  const f = await absorptionFixture();
  try {
    await f.generate();
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    for (let n = 1; n <= 27; n++) await saveBilled(f, "partial", n);
    const r = await review(f);
    assert.equal(r.pending_count, 27);
    assert.equal(r.rows.length, 27);
    await f.db.query(
      "select resolve_feed_absorption_invoice($1,$2,'Checked every pending decision')",
      [f.inv, r.source_token],
    );
    assert.equal((await review(f)).history.length, 10);
    assert.equal(
      (
        await f.db.query(
          "select * from feed_absorption_invoice_reviews where resolved_at is not null",
        )
      ).rows.length,
      27,
    );
  } finally {
    await f.db.close();
  }
});
test("explicitly voiding an invoice closes its pending billing follow-up without deleting decision history", async () => {
  const f = await absorptionFixture();
  try {
    await f.generate();
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    await saveBilled(f);
    await f.db.query(
      "select void_invoice($1,'Owner voided mistaken invoice')",
      [f.inv],
    );
    assert.equal((await review(f)).pending_count, 0);
    assert.equal((await review(f)).history.length, 1);
    assert.match((await review(f)).history[0].resolution!, /voided/);
    assert.equal(
      (await f.db.query("select * from feed_absorptions")).rows.length,
      1,
    );
  } finally {
    await f.db.close();
  }
});

test("removed draft charges and explicitly reversed feeding can be reviewed without reviving the old source or hiding the reversal from an open review", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    const line = await f.generate();
    await saveBilled(f);
    await f.db.query("select remove_invoice_line($1)", [line]);
    const old = await review(f);
    await f.db.query(
      "select reverse_stock_consumption($1,'Incorrect original feeding')",
      [f.movements[0]],
    );
    await assert.rejects(
      f.db.query(
        "select resolve_feed_absorption_invoice($1,$2,'Stale source view')",
        [f.inv, old.source_token],
      ),
      /changed/,
    );
    const r = await review(f);
    await f.db.query(
      "select resolve_feed_absorption_invoice($1,$2,'Draft charge removed and incorrect feeding reversed')",
      [f.inv, r.source_token],
    );
    assert.equal((await review(f)).pending_count, 0);
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("new payment or refund activity invalidates an open manual billing resolution without creating any additional transaction", async () => {
  const f = await absorptionFixture();
  try {
    await f.save();
    await f.generate();
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    await saveBilled(f);
    const before = await review(f);
    const payment = crypto.randomUUID();
    await f.db.query(
      "select record_invoice_payment($1,$2,10,'2026-03-02','cash')",
      [payment, f.inv],
    );
    await assert.rejects(
      f.db.query(
        "select resolve_feed_absorption_invoice($1,$2,'Old financial context')",
        [f.inv, before.source_token],
      ),
      /changed/,
    );
    const paid = await review(f);
    await f.db.query(
      "select record_invoice_refund($1,$2,1,'2026-03-03','reopen','cash','Owner-entered return')",
      [crypto.randomUUID(), payment],
    );
    await assert.rejects(
      f.db.query(
        "select resolve_feed_absorption_invoice($1,$2,'Old refund context')",
        [f.inv, paid.source_token],
      ),
      /changed/,
    );
    const now = await review(f);
    await f.db.query(
      "select resolve_feed_absorption_invoice($1,$2,'Manually entered payment/refund reviewed')",
      [f.inv, now.source_token],
    );
    assert.equal(
      (await f.db.query("select * from invoice_payments")).rows.length,
      1,
    );
    assert.equal(
      (await f.db.query("select * from invoice_refunds")).rows.length,
      1,
    );
  } finally {
    await f.db.close();
  }
});
