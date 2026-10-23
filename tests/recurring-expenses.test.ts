import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("recurring expense dates preserve anchors across short months, leap years, quarters and weeks", async () => {
  const db = await inventoryDatabase();
  try {
    for (const [start, cadence, index, expected] of [
      ["2024-01-31", "monthly", 1, "2024-02-29"],
      ["2024-01-31", "monthly", 2, "2024-03-31"],
      ["2025-01-31", "monthly", 1, "2025-02-28"],
      ["2024-02-29", "yearly", 1, "2025-02-28"],
      ["2024-02-29", "yearly", 4, "2028-02-29"],
      ["2025-11-30", "quarterly", 1, "2026-02-28"],
      ["2025-11-30", "quarterly", 2, "2026-05-30"],
      ["2025-12-29", "weekly", 1, "2026-01-05"],
    ]) {
      assert.equal(
        (
          await db.query<{ d: string }>(
            "select recurring_expense_date($1,$2,$3)::text d",
            [start, cadence, index],
          )
        ).rows[0].d,
        expected,
      );
    }
    await assert.rejects(
      db.query("select recurring_expense_date('2026-01-01','monthly',-1)"),
    );
    await assert.rejects(
      db.query("select recurring_expense_date('2026-01-01','other',1)"),
    );
  } finally {
    await db.close();
  }
});
test("recurring expenses create unpaid bills once, retain history, skip deliberately and protect cash and stock", async () => {
  const db = await inventoryDatabase();
  try {
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Boarding / facility'",
      )
    ).rows[0].id;
    const id = crypto.randomUUID();
    let revision = 1;
    const data = {
      name: "Facility rent",
      vendor: "Landlord",
      category_id: category,
      amount_cents: 120000,
      cadence: "monthly",
      starts_on: "2020-01-31",
      ends_on: "2020-04-30",
      active: true,
    };
    await db.query("select save_recurring_expense($1,0,$2)", [id, data]);
    async function overview() {
      return (
        await db.query<{
          r: {
            id: string;
            next_date: string;
            revision: number;
            history: unknown[];
          }[];
        }>("select recurring_expense_overview() r")
      ).rows[0].r;
    }
    assert.equal((await overview())[0].next_date, "2020-01-31");
    const request = crypto.randomUUID();
    async function prepare(
      req: string,
      date: string,
      reason: string | null = null,
    ) {
      return (
        await db.query<{ id: string | null }>(
          "select prepare_recurring_expense($1,$2,$3,$4,$5) id",
          [req, id, revision, date, reason],
        )
      ).rows[0].id;
    }
    const expense = await prepare(request, "2020-01-31");
    assert.ok(expense);
    assert.equal(await prepare(request, "2020-01-31"), expense);
    await assert.rejects(prepare(crypto.randomUUID(), "2020-01-31"), /changed/);
    const saved = (
      await db.query<{ paid_on: null; amount_cents: number }>(
        "select * from expenses where id=$1",
        [expense],
      )
    ).rows[0];
    assert.equal(saved.paid_on, null);
    assert.equal(saved.amount_cents, 120000);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from inventory_movements",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ r: { business: { spent_cents: number } } }>(
          "select financial_report_bundle('2020-01-01','2020-12-31') r",
        )
      ).rows[0].r.business.spent_cents,
      0,
    );
    assert.equal((await overview())[0].next_date, "2020-02-29");
    revision = 2;
    await assert.rejects(
      prepare(crypto.randomUUID(), "2020-02-29", "  "),
      /reason/,
    );
    const skip = crypto.randomUUID();
    assert.equal(
      await prepare(skip, "2020-02-29", "Not charged this month"),
      null,
    );
    assert.equal(
      await prepare(skip, "2020-02-29", "Not charged this month"),
      null,
    );
    assert.equal((await overview())[0].next_date, "2020-03-31");
    revision = 3;
    await assert.rejects(
      db.query("select save_recurring_expense($1,$2,$3)", [
        id,
        revision,
        { ...data, cadence: "yearly" },
      ]),
      /retained/,
    );
    await db.query("select save_recurring_expense($1,$2,$3)", [
      id,
      revision,
      { ...data, amount_cents: 125000, active: false },
    ]);
    revision = 4;
    await assert.rejects(prepare(crypto.randomUUID(), "2020-03-31"), /paused/);
    await db.query("select save_recurring_expense($1,$2,$3)", [
      id,
      revision,
      { ...data, amount_cents: 125000 },
    ]);
    revision = 5;
    const march = await prepare(crypto.randomUUID(), "2020-03-31");
    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from expenses where id=$1",
          [march],
        )
      ).rows[0].amount_cents,
      125000,
    );
    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from expenses where id=$1",
          [expense],
        )
      ).rows[0].amount_cents,
      120000,
    );
    await db.query("select set_expense_status($1,null,true)", [march]);
    assert.equal((await overview())[0].next_date, "2020-04-30");
    revision = 6;
    await prepare(crypto.randomUUID(), "2020-04-30");
    revision = 7;
    await assert.rejects(prepare(crypto.randomUUID(), "2020-05-31"), /no due/);
    assert.equal((await overview())[0].history.length, 4);
    const future = crypto.randomUUID();
    await db.query("select save_recurring_expense($1,0,$2)", [
      future,
      { ...data, starts_on: "2099-01-01", ends_on: null },
    ]);
    await assert.rejects(
      db.query("select prepare_recurring_expense($1,$2,1,'2099-01-01')", [
        crypto.randomUUID(),
        future,
      ]),
      /no due/,
    );
    await assert.rejects(
      db.query("select save_recurring_expense($1,0,$2)", [
        crypto.randomUUID(),
        { ...data, reimbursable: true },
      ]),
      /check constraint/,
    );
    await db.query("select set_expense_status($1,'2020-02-01',false)", [
      expense,
    ]);
    assert.equal(
      (
        await db.query<{ r: { business: { spent_cents: number } } }>(
          "select financial_report_bundle('2020-01-01','2020-12-31') r",
        )
      ).rows[0].r.business.spent_cents,
      120000,
    );
    await assert.rejects(
      db.query("update recurring_expenses set amount_cents=0"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from recurring_expenses")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from recurring_expense_occurrences")).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query("select recurring_expense_overview()"),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select prepare_recurring_expense($1,$2,7,'2020-05-31')", [
        crypto.randomUUID(),
        id,
      ]),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select save_recurring_expense($1,0,$2)", [
        crypto.randomUUID(),
        data,
      ]),
      /Administrator/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select recurring_expense_overview()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
