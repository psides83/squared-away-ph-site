import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  actualRecoveryValues,
  type RecoveryOptions,
} from "../src/lib/actual-cost-recovery.ts";
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
test("exact original feeding matches restore issued reporting and duplicate-billing protection without changing invoice or stock; retries retain one audit", async () => {
  const f = await fixture();
  try {
    await f.db.query("select finalize_invoice($1)", [f.inv]);
    const before = (
      await f.db.query(
        "select amount_cents,source_snapshot from invoice_lines where id=$1",
        [f.line],
      )
    ).rows[0];
    await f.lose();
    assert.equal((await f.options()).lines[0].ready, true);
    assert.equal((await f.options()).lines[0].source_cost_cents, 667);
    const params = await f.recover();
    await f.db.query("select recover_actual_cost_sources($1,$2,$3,$4)", params);
    assert.equal((await f.options()).count, 0);
    assert.equal((await f.options()).history.length, 1);
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      2,
    );
    assert.deepEqual(
      (
        await f.db.query(
          "select amount_cents,source_snapshot from invoice_lines where id=$1",
          [f.line],
        )
      ).rows[0],
      before,
    );
    const r = (
      await f.db.query<{ r: { totals: { issued_cents: number } } }>(
        "select feed_charge_comparison('2026-01-01','2026-02-28') r",
      )
    ).rows[0].r;
    assert.equal(r.totals.issued_cents, 667);
    await assert.rejects(
      f.db.query(
        "select reverse_stock_consumption($1,'Cannot reverse billed')",
        [f.movements[0]],
      ),
      /reserved/,
    );
    const other = await f.invoice();
    await assert.rejects(
      f.db.query("select add_actual_feed($1)", [other]),
      /No unbilled/,
    );
    assert.equal(
      (await f.db.query("select * from inventory_movements")).rows.length,
      3,
    );
    await f.db.query("select void_invoice($1,'Mistaken invoice')", [f.inv]);
    await f.db.query("select recover_actual_cost_sources($1,$2,$3,$4)", params);
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("missing, reversed, duplicate, wrong-horse and malformed original records block recovery atomically", async () => {
  const f = await fixture();
  try {
    await f.lose();
    const token = (await f.options()).lines[0].source_token!;
    const snapshot = (
      await f.db.query<{ source_snapshot: Record<string, unknown> }>(
        "select source_snapshot from invoice_lines where id=$1",
        [f.line],
      )
    ).rows[0].source_snapshot;
    for (const sources of [
      [{ movement_id: f.movements[0] }, { movement_id: f.movements[0] }],
      [{ movement_id: crypto.randomUUID() }],
    ]) {
      await f.db.exec("reset role");
      await f.db.query(
        "update invoice_lines set source_snapshot=$2 where id=$1",
        [f.line, { ...snapshot, sources }],
      );
      await login(f.db, adminId);
      assert.equal((await f.options()).lines[0].ready, false);
    }
    await f.db.exec("reset role");
    await f.db.query(
      "update invoice_lines set source_snapshot=$2 where id=$1",
      [f.line, snapshot],
    );
    await f.db.query(
      "update inventory_movements set horse_id=null where id=$1",
      [f.movements[0]],
    );
    await login(f.db, adminId);
    assert.match((await f.options()).lines[0].reason!, /match this horse/);
    await f.db.exec("reset role");
    await f.db.query("update inventory_movements set horse_id=$2 where id=$1", [
      f.movements[0],
      f.h,
    ]);
    await login(f.db, adminId);
    await f.db.query(
      "select reverse_stock_consumption($1,'Incorrect feeding')",
      [f.movements[0]],
    );
    assert.equal((await f.options()).lines[0].ready, false);
    await assert.rejects(
      f.recover(f.line, crypto.randomUUID(), token),
      /unreversed/,
    );
    await f.db.exec("reset role");
    await f.db.query(
      'update invoice_lines set source_snapshot=source_snapshot||\'{"sources":[{"movement_id":"bad"}]}\'::jsonb where id=$1',
      [f.line],
    );
    await login(f.db, adminId);
    assert.match((await f.options()).lines[0].reason!, /invalid/);
    assert.equal(
      (await f.db.query("select * from actual_cost_source_recoveries")).rows
        .length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("cost mismatch and stale source snapshots stop recovery; resolved costs can be restored without replaying old requests", async () => {
  const f = await fixture();
  try {
    await f.lose();
    const token = (await f.options()).lines[0].source_token!;
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1000,1200,'Correct cost')",
      [crypto.randomUUID(), f.opening],
    );
    assert.match((await f.options()).lines[0].reason!, /do not equal/);
    await assert.rejects(
      f.recover(f.line, crypto.randomUUID(), token),
      /do not equal/,
    );
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1200,1000,'Restore correct cost')",
      [crypto.randomUUID(), f.opening],
    );
    const params = await f.recover();
    await f.db.query("select remove_invoice_line($1)", [f.line]);
    await f.db.query("select recover_actual_cost_sources($1,$2,$3,$4)", params);
    assert.equal(
      (await f.db.query("select * from invoice_feed_claims")).rows.length,
      0,
    );
    const bad = [...params];
    bad[3] = "Changed reason";
    await assert.rejects(
      f.db.query("select recover_actual_cost_sources($1,$2,$3,$4)", bad),
      /different values/,
    );
  } finally {
    await f.db.close();
  }
});
test("original boarding expense and stay assignment restore covered dates and protect the source from duplicate chargebacks", async () => {
  const f = await fixture();
  try {
    const expense = (
      await f.db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
        {
          horse_id: f.h,
          expense_date: "2026-01-31",
          category_id: (
            await f.db.query<{ id: string }>(
              "select id from expense_categories where name='Boarding / facility'",
            )
          ).rows[0].id,
          amount_cents: 5000,
          vendor: "Barn",
          reimbursable: true,
        },
        crypto.randomUUID(),
      ])
    ).rows[0].id;
    const split = crypto.randomUUID();
    await f.db.query(
      "select save_cost_stay_split($1,$2,null,$3,$4::jsonb,'Reviewed boarding')",
      [
        split,
        expense,
        f.h,
        JSON.stringify([{ stay_id: f.stay, amount_cents: 5000 }]),
      ],
    );
    const board = (
      await f.db.query<{ id: string }>("select add_actual_boarding($1,$2) id", [
        f.inv,
        split,
      ])
    ).rows[0].id;
    await f.lose(board);
    let ctx = (await f.options()).lines.find((x) => x.id === board)!;
    assert.equal(ctx.ready, true);
    assert.equal(ctx.source_cost_cents, 5000);
    await f.recover(board);
    assert.equal(
      (
        await f.db.query(
          "select * from invoice_boarding_claims where line_id=$1",
          [board],
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      f.db.query(
        "select clear_cost_stay_split($1,$2,$3,'Cannot change billed cost')",
        [expense, null, f.h],
      ),
      /reserved/,
    );
    assert.equal((await f.options()).history.length, 1);
  } finally {
    await f.db.close();
  }
});
test("conflicting claims, changed identity and customer/anonymous access cannot bypass recovery guards or private evidence", async () => {
  const f = await fixture();
  try {
    await f.lose();
    const other = await f.invoice();
    await f.db.query("select add_actual_feed($1)", [other]);
    assert.match((await f.options()).lines[0].reason!, /another charge/);
    await assert.rejects(f.recover(), /another charge/);
    await assert.rejects(
      f.db.query("select actual_cost_recovery_context($1)", [f.line]),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("delete from actual_cost_source_recoveries"),
      /permission denied/,
    );
    await login(f.db, outsiderId);
    await assert.rejects(f.options(), /Administrator/);
    assert.equal(
      (await f.db.query("select * from actual_cost_source_recoveries")).rows
        .length,
      0,
    );
    await assert.rejects(
      f.db.query("select recover_actual_cost_sources($1,$2,$3,'Denied')", [
        crypto.randomUUID(),
        f.line,
        "a".repeat(32),
      ]),
      /Administrator/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(f.options(), /permission denied/);
  } finally {
    await f.db.close();
  }
});
test("recovery form requires original source identity and current evidence", () => {
  const f = new FormData(),
    id = crypto.randomUUID();
  for (const [k, v] of Object.entries({
    request_id: id,
    line_id: id,
    source_token: "a".repeat(32),
    reason: "Review",
  }))
    f.set(k, v);
  assert.equal(actualRecoveryValues(f).p_line, id);
  f.set("source_token", "invalid");
  assert.throws(() => actualRecoveryValues(f), /original-source/);
});

test("recovery queue retains complete counts beyond 25 and malformed original identifiers fail safely", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    for (let n = 0; n < 27; n++)
      await f.db.query(
        "insert into invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values($1,'Missing original IDs',10,'service',$2)",
        [
          f.inv,
          {
            service: "feed",
            basis: "consumption",
            stay_id: f.stay,
            period_from: "2026-01-31",
            period_to: "2026-02-01",
            sources: [{ movement_id: "bad" }],
          },
        ],
      );
    await login(f.db, adminId);
    assert.equal((await f.options()).count, 27);
    assert.equal((await f.options()).lines.length, 25);
    assert.equal((await f.options(f.inv, 2)).lines.length, 2);
    assert.equal(
      (await f.options()).lines.every((x) => !x.ready),
      true,
    );
    await assert.rejects(f.options(f.inv, 0), /valid page/);
  } finally {
    await f.db.close();
  }
});
