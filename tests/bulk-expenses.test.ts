import { test } from "node:test";
import assert from "node:assert/strict";
import { bulkExpenseValues } from "../src/lib/bulk-expenses.ts";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
const category = "30000000-0000-4000-8000-000000000001";
function draftForm() {
  const form = new FormData();
  const id = crypto.randomUUID();
  form.append("row_id", id);
  for (const [key, value] of Object.entries({
    expense_date: "2020-01-01",
    category_id: category,
    amount: "12.34",
    vendor: " Store ",
  }))
    form.set(`row.${id}.${key}`, value);
  return { form, id };
}
test("bulk expense input reuses money/date/horse validation and preserves row identity", () => {
  const { form, id } = draftForm();
  const rows = bulkExpenseValues(form);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].amount_cents, 1234);
  assert.equal(rows[0].vendor, "Store");
  assert.equal(rows[0].paid_on, null);
  form.set(`row.${id}.reimbursable`, "on");
  assert.throws(() => bulkExpenseValues(form), /Entry 1: Select a horse/);
  form.delete(`row.${id}.reimbursable`);
  form.set(`row.${id}.amount`, "1.234");
  assert.throws(() => bulkExpenseValues(form), /Entry 1:.*decimal/);
  form.set(`row.${id}.amount`, "12");
  form.append("row_id", id);
  assert.throws(() => bulkExpenseValues(form), /Entry 2:.*twice/);
  assert.throws(() => bulkExpenseValues(new FormData()), /between 1 and 20/);
  const tooMany = new FormData();
  for (let i = 0; i < 21; i++) tooMany.append("row_id", crypto.randomUUID());
  assert.throws(() => bulkExpenseValues(tooMany), /between 1 and 20/);
});
test("bulk expense recording is atomic, retry-safe, private and never changes stock or invoices", async () => {
  const db = await inventoryDatabase();
  try {
    const categoryId = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const row = (amount = 1000) => ({
      id: crypto.randomUUID(),
      expense_date: "2020-01-01",
      paid_on: null as string | null,
      category_id: categoryId,
      horse_id: null as string | null,
      vendor: "Store",
      amount_cents: amount,
      reimbursable: false,
      notes: null as string | null,
    });
    const save = (request: string, rows: unknown) =>
      db.query<{ ids: string[] }>(
        "select record_expense_batch($1,$2::jsonb) ids",
        [request, JSON.stringify(rows)],
      );
    const first = row(1200),
      second = { ...row(2400), paid_on: "2020-01-02" };
    const request = crypto.randomUUID();
    assert.deepEqual((await save(request, [first, second])).rows[0].ids, [
      first.id,
      second.id,
    ]);
    await save(request, [first, second]);
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from expenses"))
        .rows[0].n,
      2,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from expense_entry_batches",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from inventory_movements",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from invoices"))
        .rows[0].n,
      0,
    );
    const report = (
      await db.query<{ r: { spent_cents: number } }>(
        "select cash_report('2020-01-01','2020-01-31') r",
      )
    ).rows[0].r;
    assert.equal(report.spent_cents, 2400);
    await assert.rejects(
      save(request, [{ ...first, amount_cents: 1300 }, second]),
      /already saved/,
    );
    // A failure on a later row must roll the earlier insert back too.
    const attempt = row();
    await assert.rejects(
      save(crypto.randomUUID(), [
        attempt,
        { ...row(), category_id: crypto.randomUUID() },
      ]),
      /entry 2/,
    );
    assert.equal(
      (await db.query("select id from expenses where id=$1", [attempt.id])).rows
        .length,
      0,
    );
    await assert.rejects(
      save(crypto.randomUUID(), [row(), first]),
      /already recorded/,
    );
    await assert.rejects(
      save(crypto.randomUUID(), [
        row(),
        { ...row(), horse_id: crypto.randomUUID() },
      ]),
      /entry 2/,
    );
    await assert.rejects(
      save(crypto.randomUUID(), [{ ...row(), reimbursable: true }]),
      /horse assignment/,
    );
    await assert.rejects(
      save(crypto.randomUUID(), [{ ...row(), amount_cents: -1 }]),
      /amount/,
    );
    await assert.rejects(save(crypto.randomUUID(), [first, first]), /entry 2/);
    await assert.rejects(save(crypto.randomUUID(), []), /between 1 and 20/);
    await assert.rejects(
      save(
        crypto.randomUUID(),
        Array.from({ length: 21 }, () => row()),
      ),
      /between 1 and 20/,
    );
    // Later edits/voids must never be overwritten or resurrected by an exact old retry.
    await db.query("select save_expense($1,$2::jsonb)", [
      first.id,
      JSON.stringify({ ...first, amount_cents: 777, notes: "Later edit" }),
    ]);
    await db.query("select set_expense_status($1,null,true)", [first.id]);
    await save(request, [first, second]);
    const after = (
      await db.query<{
        amount_cents: number;
        notes: string;
        voided_at: string | null;
      }>("select amount_cents,notes,voided_at from expenses where id=$1", [
        first.id,
      ])
    ).rows[0];
    assert.equal(after.amount_cents, 777);
    assert.equal(after.notes, "Later edit");
    assert.ok(after.voided_at);
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from expenses"))
        .rows[0].n,
      2,
    );
    await login(db, outsiderId);
    await assert.rejects(save(crypto.randomUUID(), [row()]), /Administrator/);
    assert.equal(
      (await db.query("select * from expense_entry_batches")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
