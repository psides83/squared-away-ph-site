import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  supplierPushInterval,
  pushIntervalLabel,
} from "../src/lib/push-days.ts";
const key = "A".repeat(87),
  p256 = "B".repeat(87),
  auth = "C".repeat(22);
test("supplier reminder interval validates calendar-day limits and labels daily versus spaced alerts", () => {
  assert.equal(supplierPushInterval(1), 1);
  assert.equal(supplierPushInterval(30), 30);
  assert.equal(pushIntervalLabel(1), "every eligible day");
  assert.equal(pushIntervalLabel(3), "at least 3 days apart");
  for (const invalid of [null, undefined, "3", 0, 31, 1.5, NaN, Infinity])
    assert.throws(() => supplierPushInterval(invalid), /1 to 30/);
});
async function device(
  db: Awaited<ReturnType<typeof inventoryDatabase>>,
  suffix = "interval",
  interval = 3,
) {
  return (
    await db.query<{ id: string }>(
      "select save_admin_push_device_cadence($1,$2,$3,$4,'Interval phone',true,true,array[1,2,3,4,5,6,7],true,$5) id",
      [`https://web.push.apple.com/${suffix}`, p256, auth, key, interval],
    )
  ).rows[0].id;
}
test("cadence saves validate atomically, legacy editors preserve the interval and device access stays private", async () => {
  const db = await inventoryDatabase();
  try {
    const id = await device(db);
    await db.query(
      "select update_admin_push_device_preferences($1,'Legacy client',true,true,true,array[1,3],false)",
      [id],
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select supplier_interval_days n from admin_push_devices where id=$1",
          [id],
        )
      ).rows[0].n,
      3,
    );
    await db.query(
      "select save_admin_push_device_preferences('https://web.push.apple.com/interval',$1,$2,$3,'Legacy reconnect',true,true,array[1,2,3,4,5,6,7],true)",
      [p256, auth, key],
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select supplier_interval_days n from admin_push_devices where id=$1",
          [id],
        )
      ).rows[0].n,
      3,
    );
    for (const value of [0, 31, null])
      await assert.rejects(
        db.query(
          "select update_admin_push_device_cadence($1,'Invalid',true,true,true,array[1],true,$2)",
          [id, value],
        ),
        /1 to 30/,
      );
    assert.equal(
      (
        await db.query<{ label: string }>(
          "select label from admin_push_devices where id=$1",
          [id],
        )
      ).rows[0].label,
      "Legacy reconnect",
    );
    const legacy = (
      await db.query<{ id: string }>(
        "select save_admin_push_device('https://web.push.apple.com/legacy',$1,$2,$3,'Old device',true,true) id",
        [p256, auth, key],
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select supplier_interval_days n from admin_push_devices where id=$1",
          [legacy],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      db.query("select supplier_push_interval_due($1,current_date)", [id]),
      /permission denied/,
    );
    await login(db, outsiderId);
    await assert.rejects(device(db, "forbidden"), /Administrator/);
    await assert.rejects(
      db.query(
        "select update_admin_push_device_cadence($1,'No access',true,true,true,array[1],true,3)",
        [id],
      ),
      /Administrator/,
    );
    assert.equal(
      (await db.query("select * from admin_push_devices")).rows.length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(device(db, "anonymous"), /permission denied/);
  } finally {
    await db.close();
  }
});
test("supplier interval uses accepted supplier alerts only and becomes due exactly at its calendar-day boundary", async () => {
  const db = await inventoryDatabase();
  try {
    const id = await device(db);
    await db.exec("reset role");
    await db.query(
      "insert into admin_push_deliveries(device_id,kind,business_date,state,sent_at) values($1,'supplier','2020-01-01','sent','2020-01-01'),($1,'scheduler','2020-01-03','sent','2020-01-03'),($1,'care','2020-01-03','sent','2020-01-03'),($1,'supplier','2020-01-03','failed',null)",
      [id],
    );
    const due = async (day: string) =>
      (
        await db.query<{ v: boolean }>(
          "select supplier_push_interval_due($1,$2) v",
          [id, day],
        )
      ).rows[0].v;
    assert.equal(await due("2019-12-31"), true);
    assert.equal(await due("2020-01-02"), false);
    assert.equal(await due("2020-01-03"), false);
    assert.equal(await due("2020-01-04"), true);
    await db.query(
      "update admin_push_devices set supplier_interval_days=1 where id=$1",
      [id],
    );
    assert.equal(await due("2020-01-02"), true);
    assert.equal(await due("2020-01-01"), false);
  } finally {
    await db.close();
  }
});
test("queue combines supplier weekday and interval limits while care/failure delivery and failed-send retry remain independent", async () => {
  const db = await inventoryDatabase();
  try {
    const id = await device(db),
      product = (
        await db.query<{ id: string }>(
          "select create_inventory_product('Interval feed','feed',(select id from expense_categories where name='Feed')) id",
        )
      ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,10,'purchase','2020-01-01',1000,null,'Purchase','Store',null)",
      [crypto.randomUUID(), product, unit],
    );
    const ret = crypto.randomUUID();
    await db.query(
      "select record_supplier_return($1,$2,$3,1,'2020-01-02','Store','Return')",
      [ret, product, unit],
    );
    await db.query(
      "select save_supplier_return_expectations($1,null,$2,500,'2020-02-01',0,null,null)",
      [ret, crypto.randomUUID()],
    );
    await db.query(
      "insert into reminders(title,due_date) values('Due care',(now() at time zone 'America/Chicago')::date)",
    );
    await db.exec("reset role");
    await db.query(
      "insert into admin_push_deliveries(device_id,kind,business_date,state,sent_at) values($1,'supplier',(now() at time zone 'America/Chicago')::date-2,'sent',now()-interval '2 days')",
      [id],
    );
    const claim = async (failed = false) => {
      await db.exec("reset role;set role service_role");
      return (
        await db.query<{
          jobs: { id: string; kind: string; lease_token: string }[];
        }>("select claim_admin_push($1,$2) jobs", [key, failed])
      ).rows[0].jobs;
    };
    const independent = await claim(true);
    assert.deepEqual(independent.map((j) => j.kind).sort(), [
      "care",
      "scheduler",
    ]);
    for (const job of independent)
      await db.query("select finish_admin_push($1,$2,'sent',201)", [
        job.id,
        job.lease_token,
      ]);
    await db.exec("reset role");
    await db.query(
      "update admin_push_deliveries set business_date=(now() at time zone 'America/Chicago')::date-3 where device_id=$1 and kind='supplier'",
      [id],
    );
    const supplier = await claim();
    assert.equal(supplier.length, 1);
    assert.equal(supplier[0].kind, "supplier");
    await db.query("select finish_admin_push($1,$2,'failed',503)", [
      supplier[0].id,
      supplier[0].lease_token,
    ]);
    await db.exec("reset role");
    await db.query(
      "update admin_push_deliveries set last_attempt_at=now()-interval '6 minutes' where id=$1",
      [supplier[0].id],
    );
    assert.equal((await claim()).length, 1);
    // A longer interval expires the unfinished supplier job; reducing it later cannot resurrect that day's expired record.
    await login(db, adminId);
    await db.query(
      "select update_admin_push_device_cadence($1,'Interval phone',true,true,true,array[1,2,3,4,5,6,7],true,5)",
      [id],
    );
    await claim();
    await login(db, adminId);
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from admin_push_deliveries where id=$1",
          [supplier[0].id],
        )
      ).rows[0].state,
      "expired",
    );
    await db.query(
      "select update_admin_push_device_cadence($1,'Interval phone',true,true,true,array[1,2,3,4,5,6,7],true,1)",
      [id],
    );
    assert.equal((await claim()).length, 0);
  } finally {
    await db.close();
  }
});
