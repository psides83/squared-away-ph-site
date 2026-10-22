import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
  adminId,
} from "./helpers/inventory-database.ts";
import {
  expenseValues,
  stockValues,
  receiptType,
  receiptLimit,
} from "../src/lib/inventory.ts";

test("inventory and receipt inputs reject unsafe or ambiguous quantities and files", () => {
  const f = new FormData();
  f.set("quantity", "1e3");
  f.set("kind", "feeding");
  assert.throws(() => stockValues(f));
  assert.throws(() =>
    receiptType(new TextEncoder().encode("<script>bad</script>")),
  );
  assert.throws(() => receiptType(new Uint8Array(receiptLimit + 1)));
  assert.equal(
    receiptType(new TextEncoder().encode("%PDF-1.7 test")).mime,
    "application/pdf",
  );
  assert.equal(
    receiptType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])).mime,
    "image/png",
  );
  f.set("reimbursable", "on");
  assert.throws(() => expenseValues(f), /horse/);
});

test("expenses, weighted inventory, feeding, corrections, and private receipts", async (t) => {
  const db = await inventoryDatabase();
  try {
    const category = (
      await db.query<{ id: string }>(
        "select id from public.expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const horse = (
      await db.query<{ id: string }>(
        "insert into public.horses(barn_name) values('Barn horse') returning id",
      )
    ).rows[0].id;
    async function product(name: string) {
      return (
        await db.query<{ id: string }>(
          "select public.create_inventory_product($1,'feed',$2) as id",
          [name, category],
        )
      ).rows[0].id;
    }
    async function unit(productId: string, label = "oz") {
      return (
        await db.query<{ id: string }>(
          "select id from public.inventory_units where product_id=$1 and label=$2",
          [productId, label],
        )
      ).rows[0].id;
    }
    async function balance(id: string) {
      const row = (
        await db.query<{ quantity_oz: string; value_cents: string }>(
          "select * from public.inventory_balances where product_id=$1",
          [id],
        )
      ).rows[0];
      return {
        quantity: Number(row.quantity_oz),
        value: Number(row.value_cents),
      };
    }
    async function move(
      productId: string,
      unitId: string,
      qty: number,
      kind: string,
      cost: number | null = null,
      request = crypto.randomUUID(),
      horseId: string | null = null,
    ) {
      return (
        await db.query<{
          result: { movement_id: string; expense_id: string | null };
        }>(
          "select public.record_stock_movement($1,$2,$3,$4,$5,'2026-01-01',$6,$7,null,'Supplier','2026-01-01') as result",
          [request, productId, unitId, qty, kind, cost, horseId],
        )
      ).rows[0].result;
    }
    const feed = await product("Feed");
    const oz = await unit(feed);
    let purchaseExpense = "";
    let consumed = "";
    await t.test(
      "opening stock is not a cash expense; purchases and balances use weighted average cost",
      async () => {
        await move(feed, oz, 1000, "opening", 10000);
        assert.equal(
          (await db.query("select id from public.expenses")).rows.length,
          0,
        );
        const request = crypto.randomUUID();
        const purchase = await move(feed, oz, 1000, "purchase", 20000, request);
        purchaseExpense = purchase.expense_id!;
        assert.deepEqual(
          await move(feed, oz, 1000, "purchase", 20000, request),
          purchase,
        );
        await assert.rejects(
          move(feed, oz, 999, "purchase", 20000, request),
          /already used/,
        );
        assert.deepEqual(await balance(feed), { quantity: 2000, value: 30000 });
        assert.equal(
          (await db.query("select id from public.expenses")).rows.length,
          1,
        );
        consumed = (
          await move(feed, oz, 100, "feeding", null, crypto.randomUUID(), horse)
        ).movement_id;
        assert.deepEqual(await balance(feed), { quantity: 1900, value: 28500 });
        await assert.rejects(
          move(feed, oz, 1, "opening", 10),
          /first movement/,
        );
        await assert.rejects(move(feed, oz, 2000, "waste"), /Not enough stock/);
        await assert.rejects(
          db.exec("update public.inventory_balances set value_cents=1"),
          /permission denied/,
        );
      },
    );
    await t.test(
      "changing serving conversions or purchase prices never reprices past feedings",
      async () => {
        const scoop = (
          await db.query<{ id: string }>(
            "insert into public.inventory_units(product_id,label,ounces_per_unit) values($1,'scoop',10) returning id",
            [feed],
          )
        ).rows[0].id;
        const prior = await move(
          feed,
          scoop,
          2,
          "feeding",
          null,
          crypto.randomUUID(),
          horse,
        );
        const before = (
          await db.query(
            "select entered_quantity,unit_label,ounces_per_unit,quantity_delta_oz,value_delta_cents from public.inventory_movements where id=$1",
            [prior.movement_id],
          )
        ).rows;
        await db.query(
          "update public.inventory_units set ounces_per_unit=12 where id=$1",
          [scoop],
        );
        await move(feed, oz, 100, "purchase", 10000);
        assert.deepEqual(
          (
            await db.query(
              "select entered_quantity,unit_label,ounces_per_unit,quantity_delta_oz,value_delta_cents from public.inventory_movements where id=$1",
              [prior.movement_id],
            )
          ).rows,
          before,
        );
        await assert.rejects(
          db.query(
            "update public.inventory_units set ounces_per_unit=20 where product_id=$1 and label='lb'",
            [feed],
          ),
          /Standard weight units|check constraint/,
        );
      },
    );
    await t.test(
      "daily rations do not consume stock until confirmed; insufficient lines roll back all products",
      async () => {
        const hay = await product("Hay");
        const hayUnit = await unit(hay);
        const prior = await balance(feed);
        await db.query(
          "insert into public.feed_rations(horse_id,product_id,unit_id,quantity) values($1,$2,$3,10),($1,$4,$5,20)",
          [horse, feed, oz, hay, hayUnit],
        );
        assert.deepEqual(await balance(feed), prior);
        await assert.rejects(
          db.query("select public.confirm_daily_feeding($1,'2026-01-01')", [
            horse,
          ]),
          /Not enough stock/,
        );
        assert.deepEqual(await balance(feed), prior);
        assert.equal(
          (await db.query("select * from public.feeding_confirmations")).rows
            .length,
          0,
        );
        await move(hay, hayUnit, 100, "opening", 1000);
        const first = (
          await db.query(
            "select public.confirm_daily_feeding($1,'2026-01-01') as id",
            [horse],
          )
        ).rows;
        const after = await balance(feed);
        assert.deepEqual(
          (
            await db.query(
              "select public.confirm_daily_feeding($1,'2026-01-01') as id",
              [horse],
            )
          ).rows,
          first,
        );
        assert.deepEqual(await balance(feed), after);
        assert.deepEqual(await balance(hay), { quantity: 80, value: 800 });
        await db.query(
          "update public.feed_rations set quantity=99 where horse_id=$1 and product_id=$2",
          [horse, feed],
        );
        await db.query("select public.confirm_daily_feeding($1,'2026-01-01')", [
          horse,
        ]);
        assert.deepEqual(await balance(feed), after);
      },
    );
    await t.test(
      "corrections restore original consumption cost once and retain both ledger entries",
      async () => {
        const before = await balance(feed);
        const first = (
          await db.query(
            "select public.reverse_stock_consumption($1,'Wrong quantity') as id",
            [consumed],
          )
        ).rows;
        assert.deepEqual(await balance(feed), {
          quantity: before.quantity + 100,
          value: before.value + 1500,
        });
        assert.deepEqual(
          (
            await db.query(
              "select public.reverse_stock_consumption($1,'Retry') as id",
              [consumed],
            )
          ).rows,
          first,
        );
        assert.deepEqual(await balance(feed), {
          quantity: before.quantity + 100,
          value: before.value + 1500,
        });
        assert.equal(
          (
            await db.query(
              "select id from public.inventory_movements where id=$1",
              [consumed],
            )
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      "emptying stock clears fractional value and never leaves rounding residue",
      async () => {
        const p = await product("Fractional supplement");
        const u = await unit(p);
        await move(p, u, 3, "opening", 100);
        await move(p, u, 1, "waste");
        await move(p, u, 2, "waste");
        assert.deepEqual(await balance(p), { quantity: 0, value: 0 });
      },
    );
    await t.test(
      "expenses support payment tracking, voids and retry safety while stock purchase amounts are protected",
      async () => {
        const request = crypto.randomUUID();
        const values = JSON.stringify({
          expense_date: "2026-01-01",
          paid_on: null,
          category_id: category,
          amount_cents: 2500,
          vendor: "Farrier",
          horse_id: horse,
          reimbursable: true,
        });
        const result = (
          await db.query<{ id: string }>(
            "select public.save_expense(null,$1::jsonb,$2) as id",
            [values, request],
          )
        ).rows[0].id;
        assert.equal(
          (
            await db.query<{ id: string }>(
              "select public.save_expense(null,$1::jsonb,$2) as id",
              [values, request],
            )
          ).rows[0].id,
          result,
        );
        await db.query(
          "select public.set_expense_status($1,'2026-01-02',false)",
          [result],
        );
        await db.query(
          "select public.set_expense_status($1,'2026-01-02',true)",
          [result],
        );
        assert.ok(
          (
            await db.query<{ voided_at: string | null }>(
              "select voided_at from public.expenses where id=$1",
              [result],
            )
          ).rows[0].voided_at,
        );
        await assert.rejects(
          db.query("select public.save_expense($1,$2::jsonb)", [
            purchaseExpense,
            values,
          ]),
          /Purchase costs/,
        );
        await assert.rejects(
          db.query("select public.set_expense_status($1,null,true)", [
            purchaseExpense,
          ]),
          /cannot be voided/,
        );
        await db.query(
          "select public.set_expense_status($1,'2026-01-02',false)",
          [purchaseExpense],
        );
      },
    );
    await t.test(
      "a late purchase failure rolls back both its expense and stock balance",
      async () => {
        await db.exec("reset role");
        await db.exec(
          `create function public.test_reject_movement() returns trigger language plpgsql as $$ begin if new.notes='test rollback' then raise exception 'test rollback'; end if; return new; end; $$;create trigger test_reject before insert on public.inventory_movements for each row execute function public.test_reject_movement();`,
        );
        await login(db, adminId);
        const before = await balance(feed);
        const expensesBefore = (
          await db.query("select count(*) from public.expenses")
        ).rows;
        await assert.rejects(
          db.query(
            "select public.record_stock_movement($1,$2,$3,10,'purchase','2026-01-01',100,null,'test rollback')",
            [crypto.randomUUID(), feed, oz],
          ),
          /test rollback/,
        );
        assert.deepEqual(await balance(feed), before);
        assert.deepEqual(
          (await db.query("select count(*) from public.expenses")).rows,
          expensesBefore,
        );
      },
    );
    await t.test(
      "custom conversions, adjustments, and cross-product units obey stock safeguards",
      async () => {
        const p = await product("Custom hay");
        const pOz = await unit(p);
        const bale = (
          await db.query<{ id: string }>(
            "insert into public.inventory_units(product_id,label,ounces_per_unit) values($1,'bale',800) returning id",
            [p],
          )
        ).rows[0].id;
        await move(p, bale, 2, "opening", 4000);
        assert.deepEqual(await balance(p), { quantity: 1600, value: 4000 });
        await assert.rejects(
          move(p, oz, 1, "waste"),
          /belonging to this product/,
        );
        await assert.rejects(
          move(p, pOz, 1, "adjustment_out"),
          /correction reason/,
        );
        await db.query(
          "select public.record_stock_movement($1,$2,$3,10,'adjustment_in','2026-01-01',25,null,'Found extra stock')",
          [crypto.randomUUID(), p, pOz],
        );
        assert.deepEqual(await balance(p), { quantity: 1610, value: 4025 });
        await assert.rejects(
          db.query(
            "select public.record_stock_movement($1,$2,$3,0.0000001,'waste','2026-01-01')",
            [crypto.randomUUID(), p, pOz],
          ),
          /six decimal/,
        );
        await assert.rejects(
          db.query(
            "update public.inventory_movements set value_delta_cents=0 where product_id=$1",
            [p],
          ),
          /permission denied/,
        );
        await assert.rejects(
          db.query(
            "select public.record_stock_movement($1,$2,$3,1,'purchase','2999-01-01',1)",
            [crypto.randomUUID(), p, pOz],
          ),
          /future date/,
        );
      },
    );
    await t.test(
      "receipts are private and non-admin users cannot read finances or mutate stock",
      async () => {
        await db.query(
          "insert into storage.objects(bucket_id,name) values('expense-receipts','test.pdf')",
        );
        await db.query(
          "insert into public.expense_receipts(expense_id,object_path,file_name,content_type,size_bytes) values($1,'test.pdf','receipt.pdf','application/pdf',100)",
          [purchaseExpense],
        );
        await login(db, outsiderId);
        for (const table of [
          "expenses",
          "inventory_products",
          "inventory_balances",
          "feed_rations",
          "inventory_movements",
          "expense_receipts",
        ])
          assert.deepEqual(
            (await db.query(`select * from public.${table}`)).rows,
            [],
          );
        assert.deepEqual(
          (await db.query("select * from storage.objects")).rows,
          [],
        );
        await assert.rejects(
          move(feed, oz, 1, "purchase", 1),
          /Administrator access required/,
        );
        await assert.rejects(
          db.query("select public.reverse_stock_consumption($1,'bad')", [
            consumed,
          ]),
          /Administrator access required/,
        );
        await assert.rejects(
          db.query("select public.confirm_daily_feeding($1,'2026-01-02')", [
            horse,
          ]),
          /Administrator access required/,
        );
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.query("select * from public.expense_receipts"),
          /permission denied/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
