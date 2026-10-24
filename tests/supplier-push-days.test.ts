import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { supplierPushDays, pushDaysLabel } from "../src/lib/push-days.ts";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
const publicKey = "A".repeat(87);
test("supplier notification days validate complete weekday selections and display concise schedules", () => {
  assert.deepEqual(supplierPushDays([7, 1, 3]), [1, 3, 7]);
  assert.equal(pushDaysLabel([1, 2, 3, 4, 5, 6, 7]), "Every day");
  assert.equal(pushDaysLabel([1, 2, 3, 4, 5]), "Weekdays");
  assert.equal(pushDaysLabel([1, 4]), "Mon, Thu");
  for (const invalid of [null, [], [1, 1], [0], [8], [1.5], ["1"], [null]])
    assert.throws(() => supplierPushDays(invalid), /at least one/);
});
test("existing push devices migrate to daily and legacy preference edits preserve custom days", async () => {
  const db = await inventoryDatabase("20261023005500_admin_push.sql");
  try {
    const device = (
      await db.query<{ id: string }>(
        "select save_admin_push_device('https://web.push.apple.com/migrate',$1,$2,$3,'Old device',true,true) id",
        ["A".repeat(87), "B".repeat(22), publicKey],
      )
    ).rows[0].id;
    await db.exec("reset role");
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261023005600_supplier_push_days.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await login(db, adminId);
    assert.deepEqual(
      (
        await db.query<{ supplier_days: number[] }>(
          "select supplier_days from admin_push_devices where id=$1",
          [device],
        )
      ).rows[0].supplier_days,
      [1, 2, 3, 4, 5, 6, 7],
    );
    await db.query(
      "select update_admin_push_device_schedule($1,'Old device',true,true,true,array[5,1,3])",
      [device],
    );
    await db.query(
      "select update_admin_push_device($1,'Renamed with old client',true,true,true)",
      [device],
    );
    assert.deepEqual(
      (
        await db.query<{ supplier_days: number[] }>(
          "select supplier_days from admin_push_devices where id=$1",
          [device],
        )
      ).rows[0].supplier_days,
      [1, 3, 5],
    );
    await assert.rejects(
      db.query("select validate_supplier_push_days(array[1])"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("supplier reminders respect selected Central Time days independently of scheduler failures and expire unselected pending jobs", async () => {
  const db = await inventoryDatabase();
  try {
    const today = (
      await db.query<{ d: number }>(
        "select extract(isodow from (now() at time zone 'America/Chicago')::date)::integer d",
      )
    ).rows[0].d;
    const other = today === 7 ? 1 : today + 1;
    const device = (
      await db.query<{ id: string }>(
        "select save_admin_push_device_schedule('https://web.push.apple.com/scheduled',$1,$2,$3,'Scheduled device',true,true,$4::integer[]) id",
        ["A".repeat(87), "B".repeat(22), publicKey, [other]],
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Scheduled push feed','feed',(select id from expense_categories where name='Feed')) id",
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
    const service = () => db.exec("reset role;set role service_role");
    const claim = async (failed: boolean) =>
      (
        await db.query<{
          jobs: { id: string; kind: string; lease_token: string }[];
        }>("select claim_admin_push($1,$2) jobs", [publicKey, failed])
      ).rows[0].jobs;
    await service();
    assert.equal((await claim(false)).length, 0);
    const failure = await claim(true);
    assert.equal(failure.length, 1);
    assert.equal(failure[0].kind, "scheduler");
    await db.query("select finish_admin_push($1,$2,'sent',201)", [
      failure[0].id,
      failure[0].lease_token,
    ]);
    await login(db, adminId);
    await db.query(
      "select update_admin_push_device_schedule($1,'Scheduled device',true,true,true,$2::integer[])",
      [device, [today]],
    );
    await service();
    const supplier = await claim(false);
    assert.equal(supplier.length, 1);
    assert.equal(supplier[0].kind, "supplier");
    await db.query("select finish_admin_push($1,$2,'failed',503)", [
      supplier[0].id,
      supplier[0].lease_token,
    ]);
    await login(db, adminId);
    await db.query(
      "select update_admin_push_device_schedule($1,'Scheduled device',true,true,true,$2::integer[])",
      [device, [other]],
    );
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from admin_push_deliveries where id=$1",
          [supplier[0].id],
        )
      ).rows[0].state,
      "expired",
    );
    await service();
    assert.equal((await claim(false)).length, 0);
    await login(db, adminId);
    for (const days of [[], [0], [8], [1, 1], [null]])
      await assert.rejects(
        db.query(
          "select update_admin_push_device_schedule($1,'Scheduled device',true,true,true,$2::integer[])",
          [device, days],
        ),
        /at least one/,
      );
    assert.deepEqual(
      (
        await db.query<{ supplier_days: number[] }>(
          "select supplier_days from admin_push_devices where id=$1",
          [device],
        )
      ).rows[0].supplier_days,
      [other],
    );
    await login(db, outsiderId);
    await assert.rejects(
      db.query(
        "select update_admin_push_device_schedule($1,'No access',true,true,true,array[1])",
        [device],
      ),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});
