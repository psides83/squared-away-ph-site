import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("purchase cost replay recalculates weighted use, retains issued charges and blocks stale draft finalization", async () => {
  const db = await inventoryDatabase();
  try {
    const horse = crypto.randomUUID(),
      customer = crypto.randomUUID(),
      stay = crypto.randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into customers(id,name) values($1,'Revaluation customer')",
      [customer],
    );
    await db.query(
      "insert into horses(id,barn_name) values($1,'Revaluation horse')",
      [horse],
    );
    await db.query(
      "insert into training_stays(id,horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,boarding_billing) values($1,$2,$3,'2020-01-01','2020-01-31',0,'at_cost','included')",
      [stay, horse, customer],
    );
    await login(db, adminId);
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Replay feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    let sequence = 0;
    const move = async (
      q: number,
      kind: string,
      cost: number | null,
      date: string,
    ) => {
      const result = (
        await db.query<{ r: { movement_id: string; expense_id: string } }>(
          "select record_stock_movement($1,$2,$3,$4,$5,$6,$7,$8,'Fixture') r",
          [
            crypto.randomUUID(),
            product,
            unit,
            q,
            kind,
            date,
            cost,
            kind === "feeding" ? horse : null,
          ],
        )
      ).rows[0].r;
      await db.exec("reset role");
      await db.query(
        "update inventory_movements set created_at='2020-01-01'::timestamptz+make_interval(secs=>$2) where id=$1",
        [result.movement_id, ++sequence],
      );
      await login(db, adminId);
      return result;
    };
    const p = await move(100, "purchase", 1000, "2020-01-01");
    const f = await move(20, "feeding", null, "2020-01-02");
    const invoice = async () =>
      (
        await db.query<{ id: string }>(
          "select create_invoice($1,$2,$3,'2020-02-01','2020-02-08','2020-01-01','2020-01-31') id",
          [crypto.randomUUID(), customer, stay],
        )
      ).rows[0].id;
    const issued = await invoice();
    await db.query("select add_actual_feed($1)", [issued]);
    await db.query("select finalize_invoice($1)", [issued]);
    await move(100, "purchase", 2000, "2020-01-03");
    const f2 = await move(90, "feeding", null, "2020-01-04");
    const draft = await invoice();
    const line = (
      await db.query<{ id: string }>("select add_actual_feed($1) id", [draft])
    ).rows[0].id;
    await db.query(
      "select set_invoice_cost_ready($1,'feed',true,'All feed records reviewed')",
      [draft],
    );
    const waste = await move(10, "waste", null, "2020-01-05");
    await db.query("select reverse_stock_consumption($1,'Not spilled')", [
      waste.movement_id,
    ]);
    await db.exec("reset role");
    await db.query(
      "update inventory_movements set created_at='2020-01-01'::timestamptz+interval '1 day' where reverses_id=$1",
      [waste.movement_id],
    );
    await login(db, adminId);
    // Newly recorded bulk entries with matching timestamps use their durable sequence.
    await db.exec("reset role");
    await db.query(
      "update inventory_movements set created_at='2020-01-01',legacy_order=false where product_id=$1",
      [product],
    );
    await login(db, adminId);
    const request = crypto.randomUUID();
    const replay = (req = request, expected = 1000, cost = 2000) =>
      db.query<{ id: string }>(
        "select revalue_purchase_cost($1,$2,$3,$4,'Correct receipt total') id",
        [req, p.movement_id, expected, cost],
      );
    assert.equal((await replay()).rows[0].id, request);
    assert.equal((await replay()).rows[0].id, request);
    await assert.rejects(replay(request, 1000, 2001), /already used/);
    await assert.rejects(replay(crypto.randomUUID()), /cost changed/);
    const values = (
      await db.query<{ id: string; v: string }>(
        "select id,value_delta_cents v from inventory_movements where id=any($1::uuid[])",
        [[f.movement_id, f2.movement_id]],
      )
    ).rows;
    assert.equal(Number(values.find((x) => x.id === f.movement_id)!.v), -400);
    assert.equal(Number(values.find((x) => x.id === f2.movement_id)!.v), -1800);
    const balance = (
      await db.query<{ q: string; v: string }>(
        "select quantity_oz q,value_cents v from inventory_balances where product_id=$1",
        [product],
      )
    ).rows[0];
    assert.equal(Number(balance.q), 90);
    assert.equal(Number(balance.v), 1800);
    const readiness = (
      await db.query<{ r: { ready: boolean; changed: boolean }[] }>(
        "select invoice_cost_readiness($1) r",
        [draft],
      )
    ).rows[0].r;
    assert.equal(readiness[0].ready, false);
    assert.equal(readiness[0].changed, true);
    const report = (
      await db.query<{
        r: { totals: { cost_cents: number; issued_cents: number } };
      }>("select feed_charge_comparison('2020-01-01','2020-01-31') r")
    ).rows[0].r;
    assert.equal(report.totals.cost_cents, 2200);
    assert.equal(report.totals.issued_cents, 200);

    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from expenses where id=$1",
          [p.expense_id],
        )
      ).rows[0].amount_cents,
      2000,
    );
    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from invoice_lines where invoice_id=$1",
          [issued],
        )
      ).rows[0].amount_cents,
      200,
    );
    assert.equal(
      (
        await db.query(
          "select * from invoice_feed_cost_flags where resolved_at is null",
        )
      ).rows.length,
      2,
    );
    await assert.rejects(
      db.query("select finalize_invoice($1)", [draft]),
      /feed-cost corrections/,
    );
    await assert.rejects(
      db.query("select resolve_feed_cost_flag($1,$2,'Reviewed')", [
        request,
        draft,
      ]),
      /Remove and regenerate/,
    );
    await db.query(
      "select resolve_feed_cost_flag($1,$2,'Issued amount retained; credit considered')",
      [request, issued],
    );
    await db.query("select remove_invoice_line($1)", [line]);
    await db.query("select add_actual_feed($1)", [draft]);
    await db.query(
      "select resolve_feed_cost_flag($1,$2,'Regenerated feed charge')",
      [request, draft],
    );
    await db.query("select finalize_invoice($1)", [draft]);
    // Further corrections create a new review, rather than overwrite the old decision.
    await replay(crypto.randomUUID(), 2000, 1500);
    assert.equal(
      (
        await db.query(
          "select * from invoice_feed_cost_flags where resolved_at is null",
        )
      ).rows.length,
      2,
    );
    await db.exec("reset role");
    await db.query(
      "insert into expense_allocations(id,expense_id,period_from,period_to,source_amount_cents,reason,created_by,submitted_rows) values($1,$2,'2020-01-01','2020-01-01',1500,'Protected allocation',$3,'[]')",
      [crypto.randomUUID(), p.expense_id, adminId],
    );
    await login(db, adminId);
    await assert.rejects(
      replay(crypto.randomUUID(), 1500, 1000),
      /Clear the shared-cost allocation/,
    );
    assert.equal(
      (await db.query("select * from inventory_cost_corrections")).rows.length,
      2,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from inventory_cost_corrections")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from invoice_feed_cost_flags")).rows.length,
      0,
    );
    await assert.rejects(replay(crypto.randomUUID()), /Administrator/);
    await db.exec("reset role;set role anon");
    await assert.rejects(replay(crypto.randomUUID()), /permission denied/);
  } finally {
    await db.close();
  }
});

test("revaluation rejects ambiguous or unreconciled history and rolls back partial work", async () => {
  const db = await inventoryDatabase();
  try {
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Guard feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const p = (
      await db.query<{ r: { movement_id: string; expense_id: string } }>(
        "select record_stock_movement($1,$2,$3,100,'purchase','2020-01-01',1000) r",
        [crypto.randomUUID(), product, unit],
      )
    ).rows[0].r;
    await db.query(
      "select record_stock_movement($1,$2,$3,100,'waste','2020-01-02',null,null,'Empty bag')",
      [crypto.randomUUID(), product, unit],
    );
    const replay = () =>
      db.query(
        "select revalue_purchase_cost($1,$2,1000,500,'Correct receipt')",
        [crypto.randomUUID(), p.movement_id],
      );
    await db.exec("reset role");
    await db.query(
      "update inventory_movements set created_at='2020-01-01',legacy_order=true where product_id=$1",
      [product],
    );
    await login(db, adminId);
    await assert.rejects(replay(), /same recording time/);
    await db.exec("reset role");
    await db.query(
      "update inventory_movements set created_at='2020-01-02' where product_id=$1 and kind='waste'",
      [product],
    );
    await db.query(
      "update inventory_balances set quantity_oz=1 where product_id=$1",
      [product],
    );
    await login(db, adminId);
    await assert.rejects(replay(), /does not reconcile/);
    await db.exec("reset role");
    await db.query(
      "update inventory_balances set quantity_oz=0 where product_id=$1",
      [product],
    );
    await db.exec(`create function public.fixture_cost_failure() returns trigger language plpgsql as $$begin if new.kind='waste' then raise exception 'Injected replay failure';end if;return new;end;$$;
 create trigger fixture_cost_failure before update on inventory_movements for each row execute function public.fixture_cost_failure();`);
    await login(db, adminId);
    await assert.rejects(replay(), /Injected replay failure/);
    assert.equal(
      (await db.query("select * from inventory_cost_corrections")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from expenses where id=$1",
          [p.expense_id],
        )
      ).rows[0].amount_cents,
      1000,
    );
    assert.equal(
      Number(
        (
          await db.query<{ v: string }>(
            "select value_delta_cents v from inventory_movements where id=$1",
            [p.movement_id],
          )
        ).rows[0].v,
      ),
      1000,
    );
    await db.exec(
      "reset role;drop trigger fixture_cost_failure on inventory_movements;",
    );
    await login(db, adminId);
    await replay();
    assert.equal(
      Number(
        (
          await db.query<{ v: string }>(
            "select value_cents v from inventory_balances where product_id=$1",
            [product],
          )
        ).rows[0].v,
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
