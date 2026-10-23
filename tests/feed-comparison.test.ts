import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
type Row = {
  horse_id: string;
  cost_cents: number;
  issued_cents: number;
  draft_cents: number;
  difference_cents: number;
  margin_percent: number | null;
  unbilled_actual_cents: number;
  feeding_lines: number;
  included: boolean;
  has_adjustments: boolean;
  has_unmatched: boolean;
  invoices: { customer_name: string; cents: number }[];
};
type Report = {
  horses: Row[];
  totals: { cost_cents: number; issued_cents: number; draft_cents: number };
  unmatched_count: number;
  unmatched: { invoice_id: string }[];
  unmatched_issued_cents: number;
};
test("feed comparison matches service dates, separates drafts and cash, and flags unsupported charges", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Billing customer') returning id",
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
    async function horse(
      name: string,
      mode: string,
      rate: number | null = null,
    ) {
      const id = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values($1) returning id",
          [name],
        )
      ).rows[0].id;
      const stay = (
        await db.query<{ id: string }>(
          "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,feed_monthly_cents) values($1,$2,'2026-01-01','2026-01-31',0,$3,$4) returning id",
          [id, customer, mode, rate],
        )
      ).rows[0].id;
      return { id, stay };
    }
    async function invoice(
      stay: string | null,
      from = "2026-01-01",
      to = "2026-01-31",
    ) {
      const id = crypto.randomUUID();
      await db.query(
        "select create_invoice($1,$2,$3,'2026-02-01','2026-02-08',$4,$5)",
        [id, customer, stay, stay ? from : null, stay ? to : null],
      );
      return id;
    }
    async function feed(horse: string, date: string, quantity: number) {
      const request = crypto.randomUUID();
      await db.query(
        "select record_stock_movement($1,$2,$3,$4,'feeding',$5,null,$6)",
        [request, product, oz, quantity, date, horse],
      );
      return (
        await db.query<{ id: string }>(
          "select id from inventory_movements where request_id=$1",
          [request],
        )
      ).rows[0].id;
    }
    async function report(from = "2026-01-01", to = "2026-01-31") {
      return (
        await db.query<{ r: Report }>(
          "select feed_charge_comparison($1,$2) r",
          [from, to],
        )
      ).rows[0].r;
    }
    const monthly = await horse("Monthly", "separate_monthly", 3101),
      actual = await horse("Actual", "at_cost"),
      draft = await horse("Draft", "separate_monthly", 3100),
      included = await horse("Included", "included");
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'opening','2026-01-01',10000)",
      [crypto.randomUUID(), product, oz],
    );
    await feed(monthly.id, "2026-01-10", 10);
    await feed(actual.id, "2026-01-05", 2);
    await feed(included.id, "2026-01-12", 1);
    const bill = await invoice(monthly.stay);
    await db.query("select add_monthly_service($1,'feed')", [bill]);
    await db.query("select finalize_invoice($1)", [bill]);
    const pending = await invoice(draft.stay);
    await db.query("select add_monthly_service($1,'feed')", [pending]);
    let r = await report("2026-01-10", "2026-01-20");
    let row = r.horses.find((h) => h.horse_id === monthly.id)!;
    assert.equal(row.cost_cents, 1000);
    assert.equal(row.issued_cents, 1100);
    assert.equal(row.difference_cents, 100);
    assert.equal(row.margin_percent, 9.09);
    assert.equal(
      r.horses.find((h) => h.horse_id === draft.id)!.issued_cents,
      0,
    );
    assert.equal(
      r.horses.find((h) => h.horse_id === draft.id)!.draft_cents,
      1100,
    );
    assert.equal(
      r.horses.find((h) => h.horse_id === included.id)!.included,
      true,
    );
    await db.query(
      "select record_invoice_payment($1,$2,500,'2026-02-02','cash')",
      [crypto.randomUUID(), bill],
    );
    assert.equal(
      (await report()).horses.find((h) => h.horse_id === monthly.id)!
        .issued_cents,
      3101,
    );
    assert.equal(
      (await report("2026-02-01", "2026-02-28")).totals.issued_cents,
      0,
    );
    let sum = 0;
    for (let day = 1; day <= 31; day++) {
      const d = `2026-01-${String(day).padStart(2, "0")}`;
      sum += (await report(d, d)).horses.find(
        (h) => h.horse_id === monthly.id,
      )!.issued_cents;
    }
    assert.equal(sum, 3101);
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'purchase','2026-01-24',20000,null,null,'Vendor')",
      [crypto.randomUUID(), product, oz],
    );
    await feed(actual.id, "2026-01-25", 2);
    const actualBill = await invoice(actual.stay);
    await db.query("select add_actual_feed($1)", [actualBill]);
    await db.query("select finalize_invoice($1)", [actualBill]);
    const partial = (await report("2026-01-01", "2026-01-20")).horses.find(
      (h) => h.horse_id === actual.id,
    )!;
    assert.equal(partial.cost_cents, 200);
    assert.equal(partial.issued_cents, 200);
    const unbilled = await feed(actual.id, "2026-01-26", 1);
    assert.ok(
      (await report()).horses.find((h) => h.horse_id === actual.id)!
        .unbilled_actual_cents > 0,
    );
    await db.query("select reverse_stock_consumption($1,'Correct feeding')", [
      unbilled,
    ]);
    assert.equal(
      (await report()).horses.find((h) => h.horse_id === actual.id)!
        .unbilled_actual_cents,
      0,
    );
    assert.equal(
      (await report("2026-01-26", "2026-01-26")).horses.find(
        (h) => h.horse_id === actual.id,
      )!.feeding_lines,
      0,
    );
    // Invoice-wide credits flag the gross comparison instead of being guessed as feed credits.
    await db.exec("reset role");
    await db.query(
      "insert into invoice_adjustments(id,invoice_id,adjustment_date,amount_cents,description) values($1,$2,'2026-02-02',-100,'Invoice credit')",
      [crypto.randomUUID(), bill],
    );
    await login(db, adminId);
    row = (await report()).horses.find((h) => h.horse_id === monthly.id)!;
    assert.equal(row.has_adjustments, true);
    assert.equal(row.issued_cents, 3101);
    const manual = await invoice(null);
    await db.query("select add_invoice_line($1,$2,'Manual feed',1234,'feed')", [
      crypto.randomUUID(),
      manual,
    ]);
    await db.query("select finalize_invoice($1)", [manual]);
    const feb = await report("2026-02-01", "2026-02-28");
    assert.equal(feb.unmatched_count, 1);
    assert.equal(feb.unmatched_issued_cents, 1234);
    assert.equal(feb.totals.issued_cents, 0);
    await db.query(
      "select set_invoice_reporting_link($1,$2,$3,null,'Review feed assignment')",
      [crypto.randomUUID(), manual, monthly.id],
    );
    assert.equal(
      (await report("2026-02-01", "2026-02-28")).horses.find(
        (h) => h.horse_id === monthly.id,
      )!.has_unmatched,
      true,
    );
    const manualDraft = await invoice(null);
    for (let i = 0; i < 26; i++)
      await db.query("select add_invoice_line($1,$2,'Manual feed',10,'feed')", [
        crypto.randomUUID(),
        manualDraft,
      ]);
    assert.equal(
      (await report("2026-02-01", "2026-02-28")).unmatched_count,
      27,
    );
    assert.equal(
      (await report("2026-02-01", "2026-02-28")).unmatched.length,
      25,
    );
    await db.query("select void_invoice($1,'Cancel draft')", [pending]);
    assert.equal(
      (await report()).horses.find((h) => h.horse_id === draft.id)!.draft_cents,
      0,
    );
    const newOwner = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('New owner') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into horse_customers(horse_id,customer_id) values($1,$2)",
      [monthly.id, newOwner],
    );
    assert.equal(
      (await report()).horses.find((h) => h.horse_id === monthly.id)!
        .invoices[0].customer_name,
      "Billing customer",
    );
    assert.deepEqual((await report("2025-01-01", "2025-01-01")).horses, []);
    await assert.rejects(
      db.query("select feed_charge_comparison('2026-02-01','2026-01-01')"),
    );
    await assert.rejects(
      db.query("select feed_charge_comparison(null,'2026-01-01')"),
    );
    await assert.rejects(
      db.query("select feed_charge_comparison('2000-01-01','2026-01-01')"),
    );
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select feed_charge_comparison('2026-01-01','2026-01-31')"),
      /Administrator/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select feed_charge_comparison('2026-01-01','2026-01-31')"),
    );
  } finally {
    await db.close();
  }
});
test("cross-month generated feed cents use calendar weights and reconcile across report slices", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec("reset role");
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Customer') returning id",
      )
    ).rows[0].id;
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Cross month') returning id",
      )
    ).rows[0].id;
    const stay = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,feed_monthly_cents) values($1,$2,'2026-01-31','2026-02-01',0,'separate_monthly',3100) returning id",
        [horse, customer],
      )
    ).rows[0].id;
    await login(db, adminId);
    const invoice = crypto.randomUUID();
    await db.query(
      "select create_invoice($1,$2,$3,'2026-02-02','2026-02-02','2026-01-31','2026-02-01')",
      [invoice, customer, stay],
    );
    await db.exec("reset role");
    const line = (
      await db.query<{ id: string }>(
        `insert into invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values($1,'Feed cycle',211,'service','{"service":"feed","basis":"calendar_segments","monthly_rate_cents":3100}') returning id`,
        [invoice],
      )
    ).rows[0].id;
    await db.query(
      "insert into invoice_service_days(stay_id,service,day,line_id) values($1,'feed','2026-01-31',$2),($1,'feed','2026-02-01',$2)",
      [stay, line],
    );
    await login(db, adminId);
    await db.query("select finalize_invoice($1)", [invoice]);
    const amount = async (from: string, to: string) =>
      (
        await db.query<{ r: Report }>(
          "select feed_charge_comparison($1,$2) r",
          [from, to],
        )
      ).rows[0].r.totals.issued_cents;
    assert.equal(await amount("2026-01-31", "2026-02-01"), 211);
    assert.equal(await amount("2026-01-31", "2026-01-31"), 100);
    assert.equal(await amount("2026-02-01", "2026-02-01"), 111);
  } finally {
    await db.close();
  }
});
