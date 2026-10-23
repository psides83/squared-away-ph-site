import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { feedScheduleValues } from "../src/lib/feed-schedules.ts";
test("horse feed slots save all rations atomically, protect stale edits and preserve actual feeding history", async () => {
  const db = await inventoryDatabase();
  try {
    const horse = crypto.randomUUID(),
      other = crypto.randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into horses(id,barn_name) values($1,'Slot horse'),($2,'Other horse')",
      [horse, other],
    );
    await login(db, adminId);
    const times = (
      await db.query<{ id: string; name: string }>(
        "select id,name from feeding_times order by sort_order",
      )
    ).rows;
    const morning = times[0].id,
      evening = times[1].id;
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const products = [] as { id: string; unit: string }[];
    for (const name of ["Feed", "Supplement"]) {
      const product = (
        await db.query<{ id: string }>(
          "select create_inventory_product($1,'feed',$2) id",
          [name, category],
        )
      ).rows[0].id;
      const unit = (
        await db.query<{ id: string }>(
          "select id from inventory_units where product_id=$1 and label='oz'",
          [product],
        )
      ).rows[0].id;
      await db.query(
        "select record_stock_movement($1,$2,$3,100,'opening','2020-01-01',1000)",
        [crypto.randomUUID(), product, unit],
      );
      products.push({ id: product, unit });
    }
    type Row = {
      id: string;
      product_id: string;
      unit_id: string;
      quantity: number | string;
      active: boolean;
      notes: string | null;
    };
    const line = (index: number, qty: number, active = true): Row => ({
      id: crypto.randomUUID(),
      product_id: products[index].id,
      unit_id: products[index].unit,
      quantity: qty,
      active,
      notes: "Ration notes",
    });
    const current = async (time: string | null = morning, h = horse) =>
      (
        await db.query<Row>(
          "select id,product_id,unit_id,quantity,active,notes from feed_rations where horse_id=$1 and feeding_time_id is not distinct from $2 order by id",
          [h, time],
        )
      ).rows;
    const save = (
      expected: unknown,
      rows: unknown,
      source: string | null = morning,
      target: string | null = morning,
      request = crypto.randomUUID(),
      h = horse,
    ) =>
      db.query<{ id: string }>(
        "select save_horse_feed_schedule($1,$2,$3,$4,$5,$6) id",
        [request, h, source, target, expected, rows],
      );
    const original = [line(0, 10), line(1, 2)];
    const request = crypto.randomUUID();
    await save([], original, morning, morning, request);
    assert.equal((await current()).length, 2);
    await save([], original, morning, morning, request);
    await assert.rejects(
      save([], [{ ...original[0], quantity: 11 }], morning, morning, request),
      /already used/,
    );
    await assert.rejects(save([], original), /changed while/);
    let snapshot = await current();
    await assert.rejects(
      save(snapshot, [
        { ...original[0], quantity: 11 },
        { ...original[1], unit_id: products[0].unit },
      ]),
      /unit belonging/,
    );
    assert.deepEqual(await current(), snapshot);
    await assert.rejects(
      save(snapshot, [
        original[0],
        {
          ...original[1],
          product_id: products[0].id,
          unit_id: products[0].unit,
        },
      ]),
      /one ration per product/,
    );
    assert.deepEqual(await current(), snapshot);
    await save([], [line(0, 5)], evening, evening);
    await assert.rejects(
      save(snapshot, original, morning, evening),
      /already has a schedule/,
    );
    await db.query("select confirm_scheduled_feeding($1,'2020-01-02',$2)", [
      horse,
      morning,
    ]);
    const feeding = (
      await db.query(
        "select id,quantity_delta_oz,value_delta_cents from inventory_movements where horse_id=$1 order by id",
        [horse],
      )
    ).rows;
    assert.equal(feeding.length, 2);
    const stock = (
      await db.query("select * from inventory_balances order by product_id")
    ).rows;
    const changed = [
      { ...original[0], quantity: 20 },
      { ...original[1], active: false },
    ];
    await save(snapshot, changed);
    assert.deepEqual(
      (await db.query("select * from inventory_balances order by product_id"))
        .rows,
      stock,
    );
    assert.deepEqual(
      (
        await db.query(
          "select id,quantity_delta_oz,value_delta_cents from inventory_movements where horse_id=$1 order by id",
          [horse],
        )
      ).rows,
      feeding,
    );
    await db.query("select confirm_scheduled_feeding($1,'2020-01-03',$2)", [
      horse,
      morning,
    ]);
    assert.equal(
      (
        await db.query("select id from inventory_movements where horse_id=$1", [
          horse,
        ])
      ).rows.length,
      3,
    );
    // A lost response to the first save must not overwrite a later schedule.
    await save([], original, morning, morning, request);
    assert.equal(
      Number(
        (await current()).find((r) => r.product_id === products[0].id)!
          .quantity,
      ),
      20,
    );
    snapshot = await current();
    await assert.rejects(
      save([], [original[0]], morning, morning, crypto.randomUUID(), other),
      /another horse/,
    );
    // Entire slots can be removed; actual confirmations retain their snapshots.
    await save(snapshot, []);
    assert.equal((await current()).length, 0);
    assert.equal(
      (
        await db.query("select id from inventory_movements where horse_id=$1", [
          horse,
        ])
      ).rows.length,
      3,
    );
    // Legacy daily totals move together into a named time slot.
    await db.query(
      "insert into feed_rations(id,horse_id,product_id,unit_id,quantity) values($1,$2,$3,$4,3)",
      [original[0].id, horse, products[0].id, products[0].unit],
    );
    const legacy = await current(null);
    await save(legacy, legacy, null, morning);
    assert.equal((await current(null)).length, 0);
    assert.equal((await current()).length, 1);
    // Archived slots can be kept paused or cleared, never reactivated.
    const paused = (await current()).map((r) => ({ ...r, active: false }));
    await save(await current(), paused);
    await db.query("update feeding_times set archived=true where id=$1", [
      morning,
    ]);
    await assert.rejects(
      save(
        await current(),
        paused.map((r) => ({ ...r, active: true })),
      ),
      /active feeding time/,
    );
    await save(
      await current(),
      paused.map((r) => ({ ...r, notes: "Still paused" })),
    );
    await save(await current(), []);
    const later = crypto.randomUUID();
    await db.query(
      "insert into feeding_times(id,name,sort_order) values($1,'Late feeding',30)",
      [later],
    );
    const eveningRows = await current(evening);
    await save(eveningRows, eveningRows, evening, later);
    assert.equal((await current(evening)).length, 0);
    assert.equal((await current(later)).length, 1);
    assert.equal(
      (
        await db.query("select * from horse_feed_schedule_edits where id=$1", [
          request,
        ])
      ).rows.length,
      1,
    );
    assert.ok(
      (await db.query("select * from horse_feed_schedule_edits")).rows.length >
        0,
    );
    await assert.rejects(
      db.query("delete from horse_feed_schedule_edits"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from horse_feed_schedule_edits")).rows.length,
      0,
    );
    await assert.rejects(save([], []), /Administrator/);
    await db.exec("reset role;set role anon");
    await assert.rejects(save([], []), /permission denied/);
  } finally {
    await db.close();
  }
});

test("schedule form parsing keeps row fields aligned, pause state and explicit source time", () => {
  const id = () => crypto.randomUUID();
  const horse = id(),
    time = id(),
    row = id(),
    product = id(),
    unit = id();
  const form = new FormData();
  for (const [key, value] of Object.entries({
    request_id: id(),
    mode: "new",
    feeding_time_id: time,
    source_time: "",
    expected: "[]",
    row_key: row,
    product_id: product,
    unit_id: unit,
    quantity: "1.25",
    notes: "  Morning only  ",
    [`active_${row}`]: "on",
  }))
    form.set(key, value);
  const values = feedScheduleValues(horse, form);
  assert.equal(values.p_source_time, time);
  assert.equal(values.p_rows[0].quantity, "1.25");
  assert.equal(values.p_rows[0].notes, "Morning only");
  assert.equal(values.p_rows[0].active, true);
  form.set("mode", "edit");
  assert.equal(feedScheduleValues(horse, form).p_source_time, null);
  form.delete(`active_${row}`);
  assert.equal(feedScheduleValues(horse, form).p_rows[0].active, false);
  form.append("row_key", id());
  assert.throws(() => feedScheduleValues(horse, form), /Complete each ration/);
});
