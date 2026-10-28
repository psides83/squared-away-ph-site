import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  allocateReceiptCents,
  suggestReceiptAllocations,
  receiptPurchaseValues,
  type ReceiptItemDraft,
} from "../src/lib/receipt-purchase.ts";
const draft = (subtotal: string): ReceiptItemDraft => ({
  id: crypto.randomUUID(),
  kind: "expense",
  description: "Supplies",
  product_id: "",
  unit_id: "",
  quantity: "",
  subtotal,
  discount: "0.00",
  tax: "0.00",
  discountEligible: true,
  taxEligible: false,
});
test("receipt allocations reconcile pennies deterministically, respect eligibility and use post-discount taxable costs", () => {
  assert.deepEqual(allocateReceiptCents(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(
    allocateReceiptCents(100000000, [100000000, 99999999]),
    [50000000, 50000000],
  );
  assert.throws(() => allocateReceiptCents(1, [0, 0]), /eligible/);
  assert.throws(() => allocateReceiptCents(-1, [1]));
  const items = [
    draft("100.00"),
    draft("30.00"),
    { ...draft("20.00"), taxEligible: true },
  ];
  const result = suggestReceiptAllocations(items, 1500, 800);
  assert.deepEqual(
    result.map((i) => i.discount),
    ["10.00", "3.00", "2.00"],
  );
  assert.deepEqual(
    result.map((i) => i.tax),
    ["0.00", "0.00", "8.00"],
  );
  assert.equal(items[0].discount, "0.00");
  assert.throws(() => suggestReceiptAllocations(items, 15001, 0), /exceeds/);
  const excluded = suggestReceiptAllocations(
    [
      { ...draft("1.00"), discountEligible: false, taxEligible: false },
      { ...draft("2.00"), taxEligible: true },
    ],
    100,
    10,
  );
  assert.deepEqual(
    excluded.map((i) => [i.discount, i.tax]),
    [
      ["0.00", "0.00"],
      ["1.00", "0.10"],
    ],
  );
});
test("receipt form input requires review, valid item details and exact receipt/header allocations", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    expense_date: "2020-01-10",
    vendor: "Feed store",
    category_id: crypto.randomUUID(),
    discount: "0.00",
    tax: "0.00",
    total: "20.00",
    items: JSON.stringify([draft("20.00")]),
  }))
    f.set(k, v);
  assert.throws(() => receiptPurchaseValues(f), /Review/);
  f.set("reviewed", "on");
  assert.equal(receiptPurchaseValues(f).p_header.total_cents, 2000);
  f.set("total", "20.01");
  assert.throws(() => receiptPurchaseValues(f), /exactly/);
  f.set("total", "20.00");
  f.set("items", JSON.stringify([{ ...draft("20.00"), kind: "inventory" }]));
  assert.throws(() => receiptPurchaseValues(f), /product/);
  const row = draft("10.00");
  f.set("items", JSON.stringify([row, row]));
  assert.throws(() => receiptPurchaseValues(f), /unique/);
});
async function fixture() {
  const db = await inventoryDatabase();
  const category = (
    await db.query<{ id: string }>(
      "select id from expense_categories where name='Other'",
    )
  ).rows[0].id;
  const product = async (name: string) =>
    (
      await db.query<{ id: string }>(
        "select create_inventory_product($1,'feed',$2) id",
        [name, category],
      )
    ).rows[0].id;
  const p1 = await product("Receipt feed"),
    p2 = await product("Receipt supplement");
  const unit = async (p: string, label: string) =>
    (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label=$2",
        [p, label],
      )
    ).rows[0].id;
  const u1 = await unit(p1, "lb"),
    u2 = await unit(p2, "g");
  const header = {
    expense_date: "2020-01-10",
    paid_on: "2020-01-10",
    vendor: "Feed store",
    category_id: category,
    notes: null,
    total_cents: 14300,
    discount_cents: 1500,
    tax_cents: 800,
  };
  const lines = [
    {
      id: crypto.randomUUID(),
      kind: "inventory",
      description: "Feed bags",
      product_id: p1,
      unit_id: u1,
      quantity: "10",
      subtotal_cents: 10000,
      discount_cents: 1000,
      tax_cents: 0,
    },
    {
      id: crypto.randomUUID(),
      kind: "inventory",
      description: "Supplement",
      product_id: p2,
      unit_id: u2,
      quantity: "1000",
      subtotal_cents: 3000,
      discount_cents: 300,
      tax_cents: 0,
    },
    {
      id: crypto.randomUUID(),
      kind: "expense",
      description: "Barn supplies",
      product_id: null,
      unit_id: null,
      quantity: null,
      subtotal_cents: 2000,
      discount_cents: 200,
      tax_cents: 800,
    },
  ];
  const request = crypto.randomUUID();
  const save = (id = request, h: unknown = header, l: unknown = lines) =>
    db.query("select record_receipt_purchase($1,$2,$3)", [id, h, l]);
  const balances = async () =>
    (
      await db.query<{
        product_id: string;
        quantity_oz: string;
        value_cents: string;
      }>("select * from inventory_balances order by product_id")
    ).rows;
  return {
    db,
    category,
    p1,
    p2,
    u1,
    u2,
    header,
    lines,
    request,
    save,
    balances,
  };
}
test("one receipt adds multiple products at allocated costs, retains metric/unit snapshots and counts cash once", async () => {
  const f = await fixture();
  try {
    const { db, request, save, balances } = f;
    await save();
    await save();
    assert.equal((await db.query("select * from expenses")).rows.length, 1);
    assert.equal(
      (await db.query("select * from inventory_movements")).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from inventory_receipt_lines")).rows.length,
      3,
    );
    const rows = await balances();
    assert.equal(
      Number(rows.find((r) => r.product_id === f.p1)?.quantity_oz),
      160,
    );
    assert.equal(
      Number(rows.find((r) => r.product_id === f.p1)?.value_cents),
      9000,
    );
    assert.ok(
      Math.abs(
        Number(rows.find((r) => r.product_id === f.p2)?.quantity_oz) -
          1000 / 28.349523125,
      ) < 1e-9,
    );
    const report = (
      await db.query<{ r: any }>(
        "select cash_report('2020-01-01','2020-01-31') r",
      )
    ).rows[0].r;
    assert.equal(report.spent_cents, 14300);
    await db.query(
      "update inventory_units set label='measured bag',ounces_per_unit=32 where id=$1",
      [f.u1],
    );
    const line = (
      await db.query<{ unit_label: string; ounces_per_unit: string }>(
        "select * from inventory_receipt_lines where id=$1",
        [f.lines[0].id],
      )
    ).rows[0];
    assert.equal(line.unit_label, "lb");
    assert.equal(Number(line.ounces_per_unit), 16);
    // Feed using an unchanged reference oz unit: half of the original 10-lb purchase costs exactly half its allocated value.
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Receipt horse') returning id",
      )
    ).rows[0].id;
    const oz = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [f.p1],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,80,'feeding','2020-01-11',null,$4)",
      [crypto.randomUUID(), f.p1, oz, horse],
    );
    assert.equal(
      Number(
        (await balances()).find((r) => r.product_id === f.p1)?.value_cents,
      ),
      4500,
    );
    await assert.rejects(
      db.query("select cancel_receipt_purchase($1,'Mistake')", [request]),
      /Stock activity/,
    );
    await assert.rejects(
      save(request, { ...f.header, total_cents: 14301 }),
      /already used/,
    );
    await db.query("select set_expense_status($1,null,false)", [request]);
    await save();
    assert.equal(
      (
        await db.query<{ paid_on: null }>(
          "select paid_on from expenses where id=$1",
          [request],
        )
      ).rows[0].paid_on,
      null,
    );
  } finally {
    await f.db.close();
  }
});
test("later-item failure, total mismatch, duplicate IDs and future dates roll back all stock, expense and header writes", async () => {
  const f = await fixture();
  try {
    const before = await f.balances();
    const bad = [f.lines[0], { ...f.lines[1], unit_id: f.u1 }, f.lines[2]];
    await assert.rejects(f.save(undefined, undefined, bad), /unit/);
    assert.deepEqual(await f.balances(), before);
    assert.equal((await f.db.query("select * from expenses")).rows.length, 0);
    assert.equal(
      (await f.db.query("select * from inventory_receipt_purchases")).rows
        .length,
      0,
    );
    await assert.rejects(
      f.save(undefined, { ...f.header, total_cents: 1 }),
      /reconcile/,
    );
    await assert.rejects(
      f.save(undefined, undefined, [f.lines[0], f.lines[0]]),
      /unique/,
    );
    await assert.rejects(
      f.save(undefined, { ...f.header, expense_date: "2999-01-01" }),
      /actual/,
    );
    await assert.rejects(
      f.save(undefined, { ...f.header, tax_cents: null }),
      /reconcile/,
    );
    assert.equal(
      (await f.db.query("select * from inventory_movements")).rows.length,
      0,
    );
    await f.save();
    await assert.rejects(
      f.save(crypto.randomUUID()),
      /identifier was already used/,
    );
    assert.equal((await f.db.query("select * from expenses")).rows.length, 1);
  } finally {
    await f.db.close();
  }
});
test("untouched whole cancellation restores stock, retains history and never re-adds stock on late save/cancel retries", async () => {
  const f = await fixture();
  try {
    f.lines[1] = {
      ...f.lines[1],
      product_id: f.p1,
      unit_id: f.u1,
      quantity: "2",
    };
    await f.save();
    await f.db.query(
      "select cancel_receipt_purchase($1,'Wrong receipt entered')",
      [f.request],
    );
    await f.db.query("select cancel_receipt_purchase($1,'Repeated click')", [
      f.request,
    ]);
    await f.save();
    assert.ok(
      (await f.balances()).every(
        (r) => Number(r.quantity_oz) === 0 && Number(r.value_cents) === 0,
      ),
    );
    assert.equal(
      (
        await f.db.query(
          "select * from inventory_movements where kind='reversal'",
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (await f.db.query("select * from inventory_receipt_lines")).rows.length,
      3,
    );
    const receipt = (
      await f.db.query<{ cancel_reason: string }>(
        "select cancel_reason from inventory_receipt_purchases where id=$1",
        [f.request],
      )
    ).rows[0];
    assert.equal(receipt.cancel_reason, "Wrong receipt entered");
    assert.ok(
      (
        await f.db.query<{ voided_at: string }>(
          "select voided_at from expenses where id=$1",
          [f.request],
        )
      ).rows[0].voided_at,
    );
    assert.equal(
      (
        await f.db.query<{ r: any }>(
          "select cash_report('2020-01-01','2020-01-31') r",
        )
      ).rows[0].r.spent_cents,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("single-source corrections and direct writes cannot change receipt values or reveal items to customers", async () => {
  const f = await fixture();
  try {
    await f.save();
    const m = (
      await f.db.query<{ id: string }>(
        "select id from inventory_movements where request_id=$1",
        [f.lines[0].id],
      )
    ).rows[0].id;
    const before = await f.balances();
    await assert.rejects(
      f.db.query("select revalue_purchase_cost($1,$2,9000,8000,'Correction')", [
        crypto.randomUUID(),
        m,
      ]),
      /purchase expense|Multi-item|Receipt totals/,
    );
    await f.db.exec("reset role");
    await assert.rejects(
      f.db.query(
        "update inventory_movements set entered_quantity=9 where id=$1",
        [m],
      ),
      /Multi-item/,
    );
    await assert.rejects(
      f.db.query("update expenses set amount_cents=9000 where id=$1", [
        f.request,
      ]),
      /Receipt totals/,
    );
    await assert.rejects(
      f.db.query("update expenses set voided_at=now() where id=$1", [
        f.request,
      ]),
      /whole-receipt|Receipt totals/,
    );
    assert.deepEqual(await f.balances(), before);
    await login(f.db, "20000000-0000-4000-8000-000000000001");
    await assert.rejects(
      f.db.query("delete from inventory_receipt_lines where receipt_id=$1", [
        f.request,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query(
        "update inventory_receipt_purchases set cancelled_at=now() where id=$1",
        [f.request],
      ),
      /permission denied/,
    );
    await login(f.db, outsiderId);
    assert.equal(
      (await f.db.query("select * from inventory_receipt_lines")).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("select * from inventory_receipt_purchases")).rows
        .length,
      0,
    );
    await assert.rejects(f.save(), /Administrator/);
    await assert.rejects(
      f.db.query("select cancel_receipt_purchase($1,'No')", [f.request]),
      /Administrator/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(f.save(), /permission denied/);
  } finally {
    await f.db.close();
  }
});
test("expense-only receipts create no stock and cancellation still retains their item history", async () => {
  const f = await fixture();
  try {
    await f.save(
      undefined,
      { ...f.header, total_cents: 2600, discount_cents: 200, tax_cents: 800 },
      [f.lines[2]],
    );
    assert.equal(
      (await f.db.query("select * from inventory_movements")).rows.length,
      0,
    );
    await f.db.query(
      "select cancel_receipt_purchase($1,'Duplicate supplies entry')",
      [f.request],
    );
    await f.save(
      undefined,
      { ...f.header, total_cents: 2600, discount_cents: 200, tax_cents: 800 },
      [f.lines[2]],
    );
    assert.equal(
      (await f.db.query("select * from inventory_receipt_lines")).rows.length,
      1,
    );
  } finally {
    await f.db.close();
  }
});

test("supplier credit is applied once to the receipt total and blocked cancellation rolls back status and stock", async () => {
  const f = await fixture();
  try {
    await f.save();
    const credit = crypto.randomUUID(),
      application = crypto.randomUUID();
    await f.db.query(
      "select issue_supplier_credit($1,'Feed store','2020-01-01',5000,null,'Prior return')",
      [credit],
    );
    await f.db.query(
      "select apply_supplier_credit($1,$2,$3,5000,'2020-01-10')",
      [application, credit, f.request],
    );
    assert.equal(
      (
        await f.db.query<{ r: any }>(
          "select cash_report('2020-01-01','2020-01-31') r",
        )
      ).rows[0].r.spent_cents,
      9300,
    );
    const before = await f.balances();
    await assert.rejects(
      f.db.query("select cancel_receipt_purchase($1,'Wrong entry')", [
        f.request,
      ]),
      /supplier-credit/,
    );
    assert.deepEqual(await f.balances(), before);
    assert.equal(
      (
        await f.db.query<{ cancelled_at: null }>(
          "select cancelled_at from inventory_receipt_purchases where id=$1",
          [f.request],
        )
      ).rows[0].cancelled_at,
      null,
    );
    await f.db.query(
      "select reverse_supplier_credit_application($1,'Correct receipt first')",
      [application],
    );
    await f.db.query("select cancel_receipt_purchase($1,'Wrong entry')", [
      f.request,
    ]);
    assert.ok((await f.balances()).every((r) => Number(r.quantity_oz) === 0));
  } finally {
    await f.db.close();
  }
});
