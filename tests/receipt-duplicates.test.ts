import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { receiptDuplicateApproval } from "../src/lib/receipt-duplicates.ts";
const digest = "d".repeat(64);
test("duplicate approval requires an explicit acknowledgement, current review token and private reason", () => {
  const f = new FormData();
  assert.equal(receiptDuplicateApproval(f), null);
  f.set("duplicate_ack", "on");
  f.set("duplicate_review_token", "b".repeat(32));
  assert.throws(() => receiptDuplicateApproval(f), /duplicate reason/);
  f.set(
    "duplicate_reason",
    "Separate supplies purchase; retained receipt reused deliberately",
  );
  assert.equal(
    receiptDuplicateApproval(f)?.duplicate_reason,
    f.get("duplicate_reason"),
  );
  f.set("duplicate_review_token", "bad");
  assert.throws(() => receiptDuplicateApproval(f), /matches again/);
});
async function fixture() {
  const db = await inventoryDatabase();
  const category = (
    await db.query<{ id: string }>(
      "select id from expense_categories where name='Other'",
    )
  ).rows[0].id;
  const header = {
    expense_date: "2020-01-10",
    paid_on: "2020-01-10",
    vendor: "Feed store",
    category_id: category,
    total_cents: 1000,
    discount_cents: 0,
    tax_cents: 0,
    receipt_sha256: digest,
  };
  const lines = () => [
    {
      id: crypto.randomUUID(),
      kind: "expense",
      description: "Supplies",
      subtotal_cents: 1000,
      discount_cents: 0,
      tax_cents: 0,
    },
  ];
  const save = (id: string, h: unknown = header, items: unknown = lines()) =>
    db.query("select record_receipt_purchase($1,$2,$3)", [id, h, items]);
  const review = async (exclude: string | null = null, hash = digest) =>
    (
      await db.query<{
        r: {
          count: number;
          token: string;
          matches: {
            id: string;
            vendor: string;
            expense_date: string;
            amount_cents: number;
          }[];
        };
      }>("select review_receipt_photo($1,$2) r", [hash, exclude])
    ).rows[0].r;
  return { db, category, header, lines, save, review };
}
test("same-file purchases require reviewed override while ordinary retries stay unchanged and cash is counted once", async () => {
  const f = await fixture();
  try {
    const first = crypto.randomUUID(),
      items = f.lines();
    await f.save(first, undefined, items);
    const review = await f.review();
    assert.equal(review.count, 1);
    assert.equal(review.matches[0].id, first);
    await f.save(first, undefined, items);
    assert.equal((await f.db.query("select * from expenses")).rows.length, 1);
    assert.equal((await f.review(first)).count, 0);
    const second = crypto.randomUUID();
    await assert.rejects(f.save(second), /matches existing/);
    assert.equal(
      (await f.db.query("select * from inventory_receipt_purchases")).rows
        .length,
      1,
    );
    const approval = {
      ...f.header,
      duplicate_review_token: review.token,
      duplicate_reason: "Separate purchase documented with the same file",
    };
    const secondItems = f.lines();
    await f.save(second, approval, secondItems);
    assert.equal((await f.review()).count, 2);
    const history = (
      await f.db.query<{ reason: string; matching_records: any[] }>(
        "select * from receipt_duplicate_overrides where receipt_id=$1",
        [second],
      )
    ).rows[0];
    assert.equal(history.matching_records.length, 1);
    assert.equal(history.matching_records[0].id, first);
    // A new match does not invalidate retrying an already committed request.
    await f.save(second, approval, secondItems);
    assert.equal(
      (await f.db.query("select * from receipt_duplicate_overrides")).rows
        .length,
      1,
    );
    await f.db.query(
      "select cancel_receipt_purchase($1,'Duplicate entry corrected')",
      [second],
    );
    await f.save(second, approval, secondItems);
    assert.equal((await f.review()).count, 1);
    assert.equal(
      (
        await f.db.query<{ r: any }>(
          "select cash_report('2020-01-01','2020-01-31') r",
        )
      ).rows[0].r.spent_cents,
      1000,
    );
  } finally {
    await f.db.close();
  }
});
test("legacy attachment hashes are matched, duplicate sources merge once, and voided expenses are excluded", async () => {
  const f = await fixture();
  try {
    const old = crypto.randomUUID();
    await f.db.query("select save_expense(null,$1,$2)", [
      {
        expense_date: "2020-01-10",
        category_id: f.category,
        amount_cents: 1000,
        vendor: "Legacy supplier",
        reimbursable: false,
      },
      old,
    ]);
    await f.db.query(
      "insert into expense_receipts(expense_id,object_path,file_name,content_type,size_bytes) values($1,$2,'receipt.jpg','image/jpeg',100),($1,$3,'receipt.pdf','application/pdf',100)",
      [old, `${old}/${digest}.jpg`, `${old}/${digest}.pdf`],
    );
    const result = await f.review();
    assert.equal(result.count, 1);
    assert.equal(result.matches[0].id, old);
    assert.equal((await f.review(null, "e".repeat(64))).count, 0);
    await assert.rejects(f.save(crypto.randomUUID()), /matches existing/);
    await f.db.query("select set_expense_status($1,null,true)", [old]);
    assert.equal((await f.review()).count, 0);
    await f.save(crypto.randomUUID());
    assert.equal((await f.review()).count, 1);
  } finally {
    await f.db.close();
  }
});
test("stale match snapshots and invalid reasons cannot bypass review or create partial records", async () => {
  const f = await fixture();
  try {
    const first = crypto.randomUUID();
    await f.save(first);
    const review = await f.review();
    await f.db.exec("reset role");
    await assert.rejects(
      f.db.query("update expenses set vendor='Changed supplier' where id=$1", [
        first,
      ]),
      /Receipt totals/,
    );
    // Receipt details are immutable; use a separately attached legacy expense to change the match set.
    await login(f.db, "20000000-0000-4000-8000-000000000001");
    const extra = crypto.randomUUID();
    await f.db.query("select save_expense(null,$1,$2)", [
      {
        expense_date: "2020-01-11",
        category_id: f.category,
        amount_cents: 2000,
        vendor: "Other expense",
        reimbursable: false,
      },
      extra,
    ]);
    await f.db.query(
      "insert into expense_receipts(expense_id,object_path,file_name,content_type,size_bytes) values($1,$2,'receipt.jpg','image/jpeg',100)",
      [extra, `${extra}/${digest}.jpg`],
    );
    await assert.rejects(
      f.save(crypto.randomUUID(), {
        ...f.header,
        duplicate_review_token: review.token,
        duplicate_reason: "Reviewed old matches",
      }),
      /Review the matches/,
    );
    const current = await f.review();
    assert.notEqual(current.token, review.token);
    await assert.rejects(
      f.save(crypto.randomUUID(), {
        ...f.header,
        duplicate_review_token: current.token,
        duplicate_reason: " ",
      }),
      /Review the matches/,
    );
    assert.equal(
      (await f.db.query("select * from inventory_receipt_purchases")).rows
        .length,
      1,
    );
    assert.equal(
      (await f.db.query("select * from receipt_duplicate_overrides")).rows
        .length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("all matching expenses are available for paged review and fingerprint/override helpers stay admin-only", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 12; i++) {
      const id = crypto.randomUUID();
      await f.db.query("select save_expense(null,$1,$2)", [
        {
          expense_date: "2020-01-10",
          category_id: f.category,
          amount_cents: 1000,
          vendor: `Supplier ${i}`,
          reimbursable: false,
        },
        id,
      ]);
      await f.db.query(
        "insert into expense_receipts(expense_id,object_path,file_name,content_type,size_bytes) values($1,$2,'receipt.jpg','image/jpeg',100)",
        [id, `${id}/${digest}.jpg`],
      );
    }
    const result = await f.review();
    assert.equal(result.count, 12);
    assert.equal(result.matches.length, 12);
    await assert.rejects(
      f.db.query("select receipt_duplicate_snapshot($1,null)", [digest]),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("select record_receipt_purchase_with_ocr($1,$2,$3)", [
        crypto.randomUUID(),
        f.header,
        f.lines(),
      ]),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query(
        "insert into receipt_duplicate_overrides(receipt_id,reason,review_token,matching_records,created_by) values(gen_random_uuid(),'Bypass','bad','[]',auth.uid())",
      ),
      /permission denied/,
    );
    await login(f.db, outsiderId);
    await assert.rejects(f.review(), /Administrator/);
    assert.equal(
      (await f.db.query("select * from receipt_duplicate_overrides")).rows
        .length,
      0,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(f.review(), /permission denied/);
  } finally {
    await f.db.close();
  }
});

test("duplicate protection runs before stock changes, including purchases whose receipt attachment has not saved yet", async () => {
  const f = await fixture();
  try {
    const product = (
      await f.db.query<{ id: string }>(
        "select create_inventory_product('Duplicate protected feed','feed',$1) id",
        [f.category],
      )
    ).rows[0].id;
    const unit = (
      await f.db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const items = () => [
      {
        ...f.lines()[0],
        kind: "inventory",
        product_id: product,
        unit_id: unit,
        quantity: "10",
      },
    ];
    await f.save(crypto.randomUUID(), undefined, items());
    assert.equal(
      (await f.db.query("select * from expense_receipts")).rows.length,
      0,
    );
    const before = (await f.db.query("select * from inventory_balances")).rows;
    await assert.rejects(
      f.save(crypto.randomUUID(), undefined, items()),
      /matches existing/,
    );
    assert.deepEqual(
      (await f.db.query("select * from inventory_balances")).rows,
      before,
    );
    assert.equal(
      (await f.db.query("select * from inventory_movements")).rows.length,
      1,
    );
    assert.equal((await f.db.query("select * from expenses")).rows.length, 1);
  } finally {
    await f.db.close();
  }
});
