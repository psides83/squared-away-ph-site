import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  profitReviewValues,
  type BusinessProfitData,
  type ProfitInventoryOptions,
  type ProfitInventorySource,
} from "../src/lib/business-profit.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const product = (
    await db.query<{ id: string }>(
      "select create_inventory_product('Profit feed','feed',(select id from expense_categories where name='Feed')) id",
    )
  ).rows[0].id;
  const unit = (
    await db.query<{ id: string }>(
      "select id from inventory_units where product_id=$1 and label='oz'",
      [product],
    )
  ).rows[0].id;
  const stock = async (
    kind: string,
    qty: number,
    date = "2020-01-05",
    cost: number | null = null,
  ) =>
    (
      await db.query<{ r: { movement_id: string; expense_id: string } }>(
        "select record_stock_movement($1,$2,$3,$4,$5,$6,$7,null,'Recorded inventory','Feed supplier',null) r",
        [crypto.randomUUID(), product, unit, qty, kind, date, cost],
      )
    ).rows[0].r;
  const opening = await stock("opening", 100, "2020-01-01", 1000);
  const report = async (from = "2020-01-01", to = "2020-01-31") =>
    (
      await db.query<{ r: BusinessProfitData }>(
        "select recorded_business_profit($1,$2) r",
        [from, to],
      )
    ).rows[0].r;
  const options = async (kind = "correction", page = 1) =>
    (
      await db.query<{ r: ProfitInventoryOptions }>(
        "select profit_inventory_options($1,$2) r",
        [kind, page],
      )
    ).rows[0].r;
  const save = async (
    s: ProfitInventorySource,
    effect: string,
    date = s.source_date,
    request = crypto.randomUUID(),
    clear = false,
  ) => {
    const cents = clear
      ? s.current!.submitted_cents
      : effect === "none"
        ? 0
        : s.source_kind === "return"
          ? Math.abs(s.cash_cents + s.credit_cents - s.stock_cents)
          : s.stock_cents;
    const params = [
      request,
      s.source_kind,
      s.source_id,
      s.current?.id ?? null,
      clear ? s.current!.source_token : s.source_token,
      effect,
      date,
      cents,
      "Reviewed outcome",
      clear,
    ];
    await db.query(
      "select set_profit_inventory_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      params,
    );
    return params;
  };
  return { db, product, unit, stock, opening, report, options, save };
}
test("waste is cost on its saved date, reversals remove it, and stock purchases do not count twice", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.report()).totals.profit_cents, 0);
    const w = await f.stock("waste", 10);
    let r = await f.report();
    assert.equal(r.totals.waste_cost_cents, 100);
    assert.equal(r.totals.profit_cents, -100);
    assert.equal(
      (await f.report("2020-02-01", "2020-02-28")).totals.waste_cost_cents,
      0,
    );
    await f.db.query(
      "select revalue_inbound_cost($1,$2,1000,2000,'Correct opening cost')",
      [crypto.randomUUID(), f.opening.movement_id],
    );
    assert.equal((await f.report()).totals.waste_cost_cents, 200);
    await f.db.query("select reverse_stock_consumption($1,'Undo waste')", [
      w.movement_id,
    ]);
    await f.stock("purchase", 10, "2020-01-06", 900);
    r = await f.report();
    assert.equal(r.cost_review_count, 0);
    assert.equal(r.totals.cost_cents, 0);
    assert.equal(r.totals.profit_cents, 0);
  } finally {
    await f.db.close();
  }
});
test("corrections require explicit gain/loss or neutral review; stale values and old retries cannot restore superseded reviews", async () => {
  const f = await fixture();
  try {
    await f.stock("adjustment_out", 10);
    let s = (await f.options()).rows[0];
    assert.equal((await f.report()).totals.profit_cents, null);
    await assert.rejects(f.save(s, "gain"), /full displayed/);
    const old = await f.save(s, "cost");
    assert.equal((await f.report()).totals.profit_cents, -100);
    await f.db.query(
      "select set_profit_inventory_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      old,
    );
    await f.db.query("select revalue_inbound_cost($1,$2,1000,2000,'Revalue')", [
      crypto.randomUUID(),
      f.opening.movement_id,
    ]);
    assert.equal((await f.options()).rows[0].valid, false);
    assert.equal((await f.report()).totals.profit_cents, null);
    await assert.rejects(f.save(s, "cost"), /review changed/);
    s = (await f.options()).rows[0];
    await f.save(s, "none");
    assert.equal((await f.report()).totals.profit_cents, 0);
    await f.db.query(
      "select set_profit_inventory_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      old,
    );
    assert.equal((await f.report()).totals.profit_cents, 0);
    s = (await f.options()).rows[0];
    await f.save(
      s,
      s.current!.effect,
      s.current!.recognition_date,
      crypto.randomUUID(),
      true,
    );
    assert.equal((await f.report()).totals.profit_cents, null);
    await f.stock("adjustment_in", 5, "2020-01-07", 150);
    s = (await f.options()).rows.find(
      (x) => x.detail_kind === "adjustment_in",
    )!;
    await f.save(s, "gain");
    assert.equal((await f.report()).totals.inventory_adjustment_cents, 150);
  } finally {
    await f.db.close();
  }
});
test("return settlement uses reviewed date, cash and linked credit minus stock, and new receipts invalidate it", async () => {
  const f = await fixture();
  try {
    const ret = crypto.randomUUID();
    await f.db.query(
      "select record_supplier_return($1,$2,$3,20,'2020-01-05','Feed supplier','Damaged')",
      [ret, f.product, f.unit],
    );
    await f.db.query(
      "select record_supplier_refund($1,$2,100,'2020-02-01','Refund','Partial')",
      [crypto.randomUUID(), ret],
    );
    await f.db.query(
      "select issue_supplier_credit($1,'Feed supplier','2020-02-02',50,'Credit','Returned goods',$2)",
      [crypto.randomUUID(), ret],
    );
    let s = (await f.options("return")).rows[0];
    assert.equal(s.stock_cents, 200);
    assert.equal(s.cash_cents, 100);
    assert.equal(s.credit_cents, 50);
    assert.equal((await f.options("credit")).count, 0);
    await assert.rejects(
      f.save(s, "settlement", "2020-02-01"),
      /actual settlement/,
    );
    assert.equal(
      (await f.report("2020-02-01", "2020-02-28")).totals.profit_cents,
      null,
    );
    await f.save(s, "settlement", "2020-02-03");
    assert.equal((await f.report()).totals.profit_cents, 0);
    assert.equal(
      (await f.report("2020-02-01", "2020-02-28")).totals.profit_cents,
      -50,
    );
    await f.db.query(
      "select record_supplier_refund($1,$2,60,'2020-02-04','Refund','Final')",
      [crypto.randomUUID(), ret],
    );
    s = (await f.options("return")).rows[0];
    assert.equal(s.valid, false);
    assert.equal(
      (await f.report("2020-02-01", "2020-02-03")).totals.profit_cents,
      null,
    );
    await f.save(s, "settlement", "2020-02-04");
    assert.equal(
      (await f.report("2020-02-01", "2020-02-28")).totals.profit_cents,
      10,
    );
  } finally {
    await f.db.close();
  }
});
test("standalone credits require review and applying credit to purchases does not recognize a second gain", async () => {
  const f = await fixture();
  try {
    const credit = crypto.randomUUID();
    await f.db.query(
      "select issue_supplier_credit($1,'Feed supplier','2020-01-03',300,'Credit','Supplier goodwill')",
      [credit],
    );
    assert.equal((await f.report()).totals.profit_cents, null);
    let s = (await f.options("credit")).rows[0];
    await f.save(s, "gain");
    const p = await f.stock("purchase", 10, "2020-01-06", 500);
    await f.db.query(
      "select apply_supplier_credit($1,$2,$3,300,'2020-01-06')",
      [crypto.randomUUID(), credit, p.expense_id],
    );
    assert.equal((await f.report()).totals.profit_cents, 300);
    assert.equal((await f.options("credit")).rows[0].valid, true);
    s = (await f.options("credit")).rows[0];
    await f.save(s, "none");
    assert.equal((await f.report()).totals.profit_cents, 0);
  } finally {
    await f.db.close();
  }
});
test("global missing income dates and expense coverage block final profit; reviewed earned revenue and unpaid costs reconcile", async () => {
  const f = await fixture();
  try {
    const c = (
      await f.db.query<{ id: string }>(
        "insert into customers(name) values('Profit owner') returning id",
      )
    ).rows[0].id;
    const inv = crypto.randomUUID(),
      line = crypto.randomUUID();
    await f.db.query(
      "select create_invoice($1,$2,null,'2020-05-01','2020-05-08',null,null)",
      [inv, c],
    );
    await f.db.query(
      "select add_invoice_line($1,$2,'Other service',1000,'other')",
      [line, inv],
    );
    await f.db.query("select finalize_invoice($1)", [inv]);
    assert.equal((await f.report()).undated_income_count, 1);
    assert.equal((await f.report()).totals.profit_cents, null);
    const token = (
      await f.db.query<{ r: { lines: { source_token: string }[] } }>(
        "select other_income_options($1,1) r",
        [inv],
      )
    ).rows[0].r.lines[0].source_token;
    await f.db.query(
      "select set_other_income_period($1,$2,null,null,null,1000,'2020-01-01','2020-01-01','Reviewed dates',false,$3)",
      [crypto.randomUUID(), line, token],
    );
    const e = (
      await f.db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
        {
          expense_date: "2020-06-01",
          category_id: (
            await f.db.query<{ id: string }>(
              "select id from expense_categories where name='Boarding / facility'",
            )
          ).rows[0].id,
          amount_cents: 300,
          vendor: "Barn",
          reimbursable: false,
        },
        crypto.randomUUID(),
      ])
    ).rows[0].id;
    assert.equal((await f.report()).cost_review_count, 1);
    assert.equal((await f.report()).totals.profit_cents, null);
    await f.db.query(
      "select set_service_cost_allocation($1,$2,null,0,0,300,'2020-01-01','2020-01-01','Service coverage',false)",
      [crypto.randomUUID(), e],
    );
    const r = await f.report();
    assert.equal(r.totals.income_cents, 1000);
    assert.equal(r.totals.cost_cents, 300);
    assert.equal(r.totals.profit_cents, 700);
    assert.equal(r.totals.margin_percent, 70);
  } finally {
    await f.db.close();
  }
});
test("review queues paginate complete counts, and customers cannot access private profit evidence or write reviews", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 27; i++)
      await f.db.query(
        "select issue_supplier_credit($1,'Feed supplier','2020-01-03',1,'Credit','Goodwill')",
        [crypto.randomUUID()],
      );
    assert.equal((await f.options("credit")).rows.length, 25);
    assert.equal((await f.options("credit", 2)).rows.length, 2);
    assert.equal((await f.options("credit")).pending_count, 27);
    assert.equal((await f.report()).inventory_review_counts.credit, 27);
    await assert.rejects(f.options("invalid"), /valid review/);
    await assert.rejects(
      f.db.query("select * from profit_inventory_sources"),
      /permission denied/,
    );
    await f.db
      .query(
        "insert into profit_inventory_reviews(id) values(gen_random_uuid())",
      )
      .then(
        () => assert.fail("Direct write allowed"),
        () => {},
      );
    await login(f.db, outsiderId);
    await assert.rejects(f.report(), /Administrator/);
    await assert.rejects(f.options(), /Administrator/);
    assert.equal(
      (await f.db.query("select * from profit_inventory_reviews")).rows.length,
      0,
    );
    await assert.rejects(
      f.db.query(
        "select set_profit_inventory_review($1,'credit',$2,null,$3,'none','2020-01-03',0,'No',false)",
        [crypto.randomUUID(), crypto.randomUUID(), "a".repeat(32)],
      ),
      /Administrator/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(f.report(), /permission denied/);
  } finally {
    await f.db.close();
  }
});
test("financial review form rejects unsafe cents and missing source evidence", () => {
  const f = new FormData();
  const id = crypto.randomUUID();
  for (const [k, v] of Object.entries({
    request_id: id,
    source_id: id,
    source_kind: "credit",
    source_token: "a".repeat(32),
    effect: "gain",
    recognition_date: "2020-01-01",
    amount_cents: "300",
    reason: "Reviewed",
  }))
    f.set(k, v);
  assert.equal(profitReviewValues(f).p_cents, 300);
  f.set("amount_cents", "9007199254740992");
  assert.throws(() => profitReviewValues(f), /saved financial/);
  f.set("amount_cents", "3.0");
  assert.throws(() => profitReviewValues(f));
  f.set("amount_cents", "0");
  f.set("source_token", "bad");
  assert.throws(() => profitReviewValues(f), /current source/);
});

test("zero-refund settlements require explicit review; expectation changes invalidate and cancellation retains private history only", async () => {
  const f = await fixture();
  try {
    const ret = crypto.randomUUID();
    await f.db.query(
      "select record_supplier_return($1,$2,$3,10,'2020-01-05','Feed supplier','Damaged')",
      [ret, f.product, f.unit],
    );
    assert.equal((await f.options()).count, 0);
    let s = (await f.options("return")).rows[0];
    const old = await f.save(s, "settlement", "2020-01-05");
    assert.equal((await f.report()).totals.profit_cents, -100);
    await f.db.query(
      "select save_supplier_return_expectations($1,null,$2,100,'2020-02-01',0,null,'Revised expectation')",
      [ret, crypto.randomUUID()],
    );
    assert.equal((await f.options("return")).rows[0].valid, false);
    assert.equal((await f.report()).totals.profit_cents, null);
    s = (await f.options("return")).rows[0];
    await f.save(s, "settlement", "2020-01-06");
    await f.db.query("select cancel_supplier_return($1,'Mistaken return')", [
      ret,
    ]);
    assert.equal((await f.options("return")).count, 0);
    assert.equal((await f.report()).totals.profit_cents, 0);
    await f.db.query(
      "select set_profit_inventory_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      old,
    );
    assert.equal((await f.report()).totals.profit_cents, 0);
    assert.equal(
      (await f.db.query("select * from profit_inventory_reviews")).rows.length,
      2,
    );
  } finally {
    await f.db.close();
  }
});
