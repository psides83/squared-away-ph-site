import type { CombinedEntityReportData } from "../src/components/combined-entity-report.tsx";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import type { CombinedServiceReportData } from "../src/components/combined-service-report.tsx";
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
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing,proration) values($1,$2,'2026-01-30','2026-02-01',31000,'included','included','calendar_days') returning id",
      [h, c],
    )
  ).rows[0].id;
  const category = (
    await db.query<{ id: string }>(
      "select id from expense_categories where name='Feed'",
    )
  ).rows[0].id;
  const product = (
    await db.query<{ id: string }>(
      "select create_inventory_product('Feed','feed',$1) id",
      [category],
    )
  ).rows[0].id;
  const oz = (
    await db.query<{ id: string }>(
      "select id from inventory_units where product_id=$1 and label='oz'",
      [product],
    )
  ).rows[0].id;
  const purchase = (
    await db.query<{ r: { movement_id: string } }>(
      "select record_stock_movement($1,$2,$3,100,'purchase','2026-01-01',1000,null,null,'Vendor') r",
      [crypto.randomUUID(), product, oz],
    )
  ).rows[0].r.movement_id;
  for (const day of ["2026-01-30", "2026-01-31", "2026-02-01"])
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'feeding',$4,null,$5)",
      [crypto.randomUUID(), product, oz, day, h],
    );
  const facility = (
    await db.query<{ id: string }>(
      "select id from expense_categories where name='Boarding / facility'",
    )
  ).rows[0].id;
  const expense = (
    await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
      {
        expense_date: "2026-03-01",
        category_id: facility,
        amount_cents: 1001,
        vendor: "Barn",
        reimbursable: false,
      },
      crypto.randomUUID(),
    ])
  ).rows[0].id;
  await db.query(
    "select set_service_cost_allocation($1,$2,null,400,500,101,'2026-01-30','2026-02-01','Covered dates',false)",
    [crypto.randomUUID(), expense],
  );
  await db.query(
    "select set_package_reporting($1,$2,null,10000,5000,'Package')",
    [crypto.randomUUID(), stay],
  );
  const invoice = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-01-30','2026-01-31')",
    [invoice, c, stay],
  );
  await db.query(
    "select set_training_days($1,'2026-01-30','2026-02-01','worked',null)",
    [stay],
  );
  await db.query("select add_calendar_training($1)", [invoice]);
  const report = async (from = "2026-01-30", to = "2026-02-01") =>
    (
      await db.query<{ r: CombinedServiceReportData }>(
        "select combined_service_profitability($1,$2) r",
        [from, to],
      )
    ).rows[0].r;
  return { db, c, h, stay, invoice, expense, purchase, product, oz, report };
}
test("combined service results reconcile saved package revenue and dated costs once, with drafts, other costs and cash outside the margin", async () => {
  const { db, invoice, report } = await fixture();
  try {
    let r = await report();
    assert.equal(r.totals.net_cents, 0);
    assert.ok(r.totals.draft_cents > 0);
    assert.equal(r.totals.cost_cents, 930);
    assert.equal(r.other_cost_cents, 101);
    assert.equal(r.review.needs_review, false);
    const draft = r.totals.draft_cents;
    await db.query("select finalize_invoice($1)", [invoice]);
    r = await report();
    assert.equal(r.totals.net_cents, draft);
    assert.equal(r.totals.draft_cents, 0);
    assert.equal(r.totals.difference_cents, draft - 930);
    const original = (
      await db.query<{ n: number }>(
        "select amount_cents n from invoice_lines where invoice_id=$1",
        [invoice],
      )
    ).rows[0].n;
    assert.equal(r.totals.net_cents, original);
    for (const service of r.services) {
      const raw =
        service.service === "feed"
          ? (
              await db.query<{
                r: { totals: { issued_cents: number; cost_cents: number } };
              }>("select feed_charge_comparison('2026-01-30','2026-02-01') r")
            ).rows[0].r.totals
          : null;
      if (raw) {
        assert.equal(
          service.gross_cents + service.adjustment_cents,
          raw.issued_cents,
        );
        assert.equal(service.cost_cents, raw.cost_cents);
      }
    }
    const january = await report("2026-01-30", "2026-01-31"),
      february = await report("2026-02-01", "2026-02-01");
    assert.equal(
      january.totals.net_cents + february.totals.net_cents,
      r.totals.net_cents,
    );
    assert.equal(january.totals.cost_cents + february.totals.cost_cents, 930);
    const adj = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-101,'2026-03-04','Discount')",
      [adj, invoice],
    );
    assert.equal((await report()).totals.difference_cents, null);
    await db.query(
      "select set_adjustment_reporting($1,$2,null,51,30,20,0,'Manual split')",
      [crypto.randomUUID(), adj],
    );
    r = await report();
    assert.equal(r.totals.adjustment_cents, -101);
    assert.equal(r.totals.net_cents, original - 101);
    assert.equal(r.totals.difference_cents, original - 101 - 930);
    const outside = await report("2026-03-01", "2026-03-31");
    assert.equal(outside.totals.net_cents, 0);
    assert.equal(outside.totals.cost_cents, 0);
    assert.equal(outside.other_cost_cents, 0);
    assert.equal(
      (await db.query("select * from invoice_payments")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("missing service reviews and corrected feed costs withhold combined margins, while unassigned consumption is included exactly once", async () => {
  const { db, c, h, stay, invoice, expense, purchase, product, oz, report } =
    await fixture();
  try {
    await db.query("select finalize_invoice($1)", [invoice]);
    const legacy = (
      await db.query<{ id: string }>(
        "select record_stock_movement($1,$2,$3,1,'feeding','2026-01-30',null,$4)->>'movement_id' id",
        [crypto.randomUUID(), product, oz, h],
      )
    ).rows[0].id;
    // Legacy unassigned consumption cannot be created through the current entry form.
    await db.exec("reset role");
    await db.query("update inventory_movements set horse_id=null where id=$1", [
      legacy,
    ]);
    let r = await report();
    assert.equal(r.unassigned_feed_cost_cents, 10);
    assert.equal(r.totals.cost_cents, 940);
    assert.equal(r.review.needs_review, false);
    await db.query(
      "update training_stays set feed_billing='at_cost' where id=$1",
      [stay],
    );
    const actual = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08','2026-02-01','2026-02-01')",
      [actual, c, stay],
    );
    await db.query("select add_actual_feed($1)", [actual]);
    await db.query("select finalize_invoice($1)", [actual]);
    await db.query(
      "select revalue_purchase_cost($1,$2,1000,2000,'Actual cost')",
      [crypto.randomUUID(), purchase],
    );
    // Preserve every invoice flagged by the existing cost-correction workflow.
    r = await report();
    assert.equal(r.totals.cost_cents, 980);
    assert.equal(r.review.feed_correction_count, 2);
    assert.equal(r.totals.difference_cents, null);
    await db.query("reset role");
    await db.query("update expenses set amount_cents=1002 where id=$1", [
      expense,
    ]);
    r = await report();
    assert.equal(r.review.unallocated_cost_count, 1);
    assert.equal(r.unallocated_cost_cents, 1002);
    assert.equal(r.totals.difference_cents, null);
    assert.equal(r.totals.margin_percent, null);
    assert.equal(r.totals.cost_cents, 80);
  } finally {
    await db.close();
  }
});
test("unassigned unsupported feed beyond detail limits blocks totals; report guards dates, empty periods and administrator access", async () => {
  const { db, c, report } = await fixture();
  try {
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2026-04-01','2026-04-08',null,null)",
      [invoice, c],
    );
    for (let n = 0; n < 30; n++)
      await db.query("select add_invoice_line($1,$2,'Manual feed',1,'feed')", [
        crypto.randomUUID(),
        invoice,
      ]);
    await db.query("select finalize_invoice($1)", [invoice]);
    const r = await report("2026-04-01", "2026-04-30");
    assert.equal(r.review.unsupported_feed_count, 30);
    assert.equal(r.totals.difference_cents, null);
    const empty = await report("2025-01-01", "2025-01-31");
    assert.equal(empty.review.needs_review, false);
    assert.equal(empty.totals.difference_cents, 0);
    assert.equal(empty.totals.margin_percent, null);
    await assert.rejects(report("2026-02-01", "2026-01-01"), /valid dates/);
    await assert.rejects(report("2000-01-01", "2026-01-01"), /valid dates/);
    const volatility = (
      await db.query<{ v: string }>(
        "select provolatile v from pg_proc where oid='public.feed_charge_comparison(date,date)'::regprocedure",
      )
    ).rows[0].v;
    assert.equal(volatility, "s");
    await login(db, outsiderId);
    await assert.rejects(report(), /Administrator/);
    await db.exec("reset role;set role anon");
    await assert.rejects(report(), /permission denied/);
  } finally {
    await db.close();
  }
});

async function entities(
  db: Awaited<ReturnType<typeof inventoryDatabase>>,
  scope = "stay",
  page = 1,
  from = "2026-01-30",
  to = "2026-02-01",
) {
  return (
    await db.query<{ r: CombinedEntityReportData }>(
      "select combined_entity_profitability($1,$2,$3,$4) r",
      [from, to, scope, page],
    )
  ).rows[0].r;
}
function reconciles(r: CombinedEntityReportData) {
  for (const b of r.business.services) {
    const a = r.assigned_totals.find((x) => x.service === b.service),
      u = r.unassigned.find((x) => x.service === b.service);
    assert.equal(
      (a?.gross_cents ?? 0) +
        (a?.adjustment_cents ?? 0) +
        (u?.gross_cents ?? 0) +
        (u?.adjustment_cents ?? 0),
      b.gross_cents + b.adjustment_cents,
    );
    assert.equal((a?.cost_cents ?? 0) + (u?.cost_cents ?? 0), b.cost_cents);
    assert.equal((a?.draft_cents ?? 0) + (u?.draft_cents ?? 0), b.draft_cents);
  }
}
test("combined horse/stay results reconcile business sources, explicit dated portions, package splits and signed adjustments", async () => {
  const { db, h, stay, invoice, expense } = await fixture();
  try {
    await db.query("select finalize_invoice($1)", [invoice]);
    let r = await entities(db);
    reconciles(r);
    assert.equal(r.rows[0].cost_cents, 30);
    assert.equal(r.rows[0].needs_review, false);
    assert.equal(
      r.unassigned.find((x) => x.service === "board")?.cost_cents,
      500,
    );
    const parent = (
      await db.query<{ id: string }>(
        "select id from service_cost_allocations where expense_id=$1 and retired_at is null",
        [expense],
      )
    ).rows[0].id;
    await db.query(
      "select set_service_assignments($1,$2,$3,null,$4,'Assigned',false)",
      [
        crypto.randomUUID(),
        expense,
        parent,
        [
          {
            service: "training",
            horse_id: h,
            stay_id: stay,
            amount_cents: 400,
            covered_from: "2026-01-30",
            covered_to: "2026-02-01",
          },
          {
            service: "board",
            horse_id: h,
            stay_id: stay,
            amount_cents: 500,
            covered_from: "2026-01-30",
            covered_to: "2026-02-01",
          },
        ],
      ],
    );
    r = await entities(db);
    reconciles(r);
    assert.equal(r.rows[0].cost_cents, 930);
    assert.equal(
      r.rows[0].difference_cents,
      r.business.totals.difference_cents,
    );
    const horse = await entities(db, "horse");
    reconciles(horse);
    assert.equal(horse.rows[0].horse_id, h);
    assert.equal(horse.rows[0].cost_cents, 930);
    const adjustment = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-101,'2026-03-04','Discount')",
      [adjustment, invoice],
    );
    assert.equal((await entities(db)).rows[0].difference_cents, null);
    await db.query(
      "select set_adjustment_reporting($1,$2,null,51,30,20,0,'Manual split')",
      [crypto.randomUUID(), adjustment],
    );
    r = await entities(db);
    reconciles(r);
    assert.equal(r.rows[0].net_cents, r.business.totals.net_cents);
    assert.equal(r.rows[0].needs_review, false);
    const jan = await entities(db, "stay", 1, "2026-01-30", "2026-01-31"),
      feb = await entities(db, "stay", 1, "2026-02-01", "2026-02-01");
    reconciles(jan);
    reconciles(feb);
    assert.equal(
      jan.rows[0].net_cents + feb.rows[0].net_cents,
      r.rows[0].net_cents,
    );
    assert.equal(jan.rows[0].cost_cents + feb.rows[0].cost_cents, 930);
  } finally {
    await db.close();
  }
});
test("combined stay view preserves horse-only revenue and outside-stay feeding, exact fractional totals and no-feeding/package review states", async () => {
  const { db, c, h, stay, invoice, product, oz, purchase } = await fixture();
  try {
    await db.query("select finalize_invoice($1)", [invoice]);
    await db.query(
      "select record_stock_movement($1,$2,$3,1,'feeding','2026-01-01',null,$4)",
      [crypto.randomUUID(), product, oz, h],
    );
    const manual = crypto.randomUUID(),
      line = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,null,'2026-03-01','2026-03-08',null,null)",
      [manual, c],
    );
    await db.query(
      "select add_invoice_line($1,$2,'Reviewed feed',1001,'feed')",
      [line, manual],
    );
    await db.query(
      "select set_invoice_reporting_link($1,$2,$3,null,'Horse only')",
      [crypto.randomUUID(), manual, h],
    );
    await db.query(
      "select set_manual_feed_period($1,$2,null,$3,null,1001,'2026-01-30','2026-02-01','Covered days',false)",
      [crypto.randomUUID(), line, h],
    );
    await db.query("select finalize_invoice($1)", [manual]);
    let r = await entities(db, "stay", 1, "2026-01-01", "2026-02-01");
    reconciles(r);
    assert.equal(
      r.unassigned.find((x) => x.service === "feed")?.gross_cents,
      1001,
    );
    assert.equal(
      r.unassigned.find((x) => x.service === "feed")?.cost_cents,
      10,
    );
    const hr = await entities(db, "horse", 1, "2026-01-01", "2026-02-01");
    reconciles(hr);
    assert.equal(hr.rows[0].net_cents, r.rows[0].net_cents + 1001);
    await db.query(
      "select revalue_purchase_cost($1,$2,1000,51,'Value correction')",
      [crypto.randomUUID(), purchase],
    );
    r = await entities(db, "stay", 1, "2026-01-01", "2026-02-01");
    reconciles(r);
    assert.equal(
      (r.assigned_totals.find((x) => x.service === "feed")?.cost_cents ?? 0) +
        (r.unassigned.find((x) => x.service === "feed")?.cost_cents ?? 0),
      2,
    );
    // A later visit has no saved package or feeding records; it must not inherit the first visit's margin.
    await db.query(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing) values($1,$2,'2026-04-01','2026-04-03',31000,'included')",
      [h, c],
    );
    r = await entities(db, "stay", 1, "2026-04-01", "2026-04-03");
    assert.equal(r.rows.length, 1);
    assert.notEqual(r.rows[0].stay_id, stay);
    assert.equal(r.rows[0].package_review, true);
    assert.equal(r.rows[0].feeding_lines, 0);
    assert.equal(r.rows[0].difference_cents, null);
  } finally {
    await db.close();
  }
});
test("combined entity pagination has complete totals with disjoint pages and rejects invalid or unauthorized reads", async () => {
  const { db, c } = await fixture();
  try {
    for (let n = 0; n < 28; n++) {
      const h = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values($1) returning id",
          [`Horse ${n}`],
        )
      ).rows[0].id;
      await db.query(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,'2026-01-30','2026-01-31',0)",
        [h, c],
      );
    }
    const a = await entities(db),
      b = await entities(db, "stay", 2);
    assert.equal(a.count, 29);
    assert.equal(a.rows.length, 25);
    assert.equal(b.rows.length, 4);
    assert.deepEqual(a.assigned_totals, b.assigned_totals);
    assert.deepEqual(a.business, b.business);
    reconciles(a);
    assert.equal(
      new Set([...a.rows, ...b.rows].map((x) => x.entity_id)).size,
      29,
    );
    await assert.rejects(entities(db, "other"), /valid scope/);
    await assert.rejects(entities(db, "horse", 0), /valid scope/);
    await assert.rejects(
      entities(db, "horse", 1, "2026-02-01", "2026-01-01"),
      /valid dates/,
    );
    await login(db, outsiderId);
    await assert.rejects(entities(db), /Administrator/);
    await db.exec("reset role;set role anon");
    await assert.rejects(entities(db), /permission denied/);
  } finally {
    await db.close();
  }
});
