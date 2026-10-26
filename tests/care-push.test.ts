import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
const publicKey = "A".repeat(87),
  p256dh = "B".repeat(87),
  auth = "C".repeat(22);
type Job = { id: string; kind: string; lease_token: string; device_id: string };
const service = (db: Awaited<ReturnType<typeof inventoryDatabase>>) =>
  db.exec("reset role;set role service_role");
async function claim(
  db: Awaited<ReturnType<typeof inventoryDatabase>>,
  failed = false,
) {
  await service(db);
  return (
    await db.query<{ jobs: Job[] }>("select claim_admin_push($1,$2) jobs", [
      publicKey,
      failed,
    ])
  ).rows[0].jobs;
}
test("existing devices keep care reminders off, and legacy edits preserve explicit care preferences", async () => {
  const db = await inventoryDatabase("20261024006000_cash_ledger_export.sql");
  try {
    const device = (
      await db.query<{ id: string }>(
        "select save_admin_push_device_schedule('https://web.push.apple.com/legacy-care',$1,$2,$3,'Old phone',true,true,array[1,3,5]) id",
        [p256dh, auth, publicKey],
      )
    ).rows[0].id;
    await db.exec("reset role");
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261026006100_care_reminder_push.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await login(db, adminId);
    assert.equal(
      (
        await db.query<{ care_alerts: boolean }>(
          "select care_alerts from admin_push_devices where id=$1",
          [device],
        )
      ).rows[0].care_alerts,
      false,
    );
    await db.query(
      "select update_admin_push_device_preferences($1,'Care phone',true,true,true,array[1,3,5],true)",
      [device],
    );
    await db.query(
      "select update_admin_push_device_schedule($1,'Old client',true,true,true,array[2,4])",
      [device],
    );
    await db.query(
      "select save_admin_push_device('https://web.push.apple.com/legacy-care',$1,$2,$3,'Reconnected by old client',true,true)",
      [p256dh, auth, publicKey],
    );
    const saved = (
      await db.query<{ care_alerts: boolean; supplier_days: number[] }>(
        "select care_alerts,supplier_days from admin_push_devices where id=$1",
        [device],
      )
    ).rows[0];
    assert.equal(saved.care_alerts, true);
    assert.deepEqual(saved.supplier_days, [2, 4]);
    await assert.rejects(
      db.query(
        "select update_admin_push_device_preferences($1,'Invalid',true,true,true,array[1],null)",
        [device],
      ),
      /valid reminder preferences/,
    );
    assert.equal(
      (
        await db.query<{ label: string }>(
          "select label from admin_push_devices where id=$1",
          [device],
        )
      ).rows[0].label,
      "Reconnected by old client",
    );
  } finally {
    await db.close();
  }
});
test("care queue includes due-today and overdue unfinished reminders, deduplicates daily and expires stale or disabled tasks independently of supplier weekdays", async () => {
  const db = await inventoryDatabase();
  try {
    const dates = (
      await db.query<{ today: string; other: number }>(
        "select ((now() at time zone 'America/Chicago')::date)::text today,(extract(isodow from now() at time zone 'America/Chicago')::integer%7)+1 other",
      )
    ).rows[0];
    const device = (
      await db.query<{ id: string }>(
        "select save_admin_push_device_preferences('https://web.push.apple.com/care',$1,$2,$3,'Care phone',false,true,$4::integer[],true) id",
        [p256dh, auth, publicKey, [dates.other]],
      )
    ).rows[0].id;
    await db.query(
      "insert into reminders(title,due_date,completed_at) values('Future',(now() at time zone 'America/Chicago')::date+1,null),('Completed',(now() at time zone 'America/Chicago')::date,now())",
    );
    assert.equal((await claim(db)).length, 0);
    await login(db, adminId);
    const due = (
      await db.query<{ id: string }>(
        "insert into reminders(title,due_date) values('Sensitive reminder',$1) returning id",
        [dates.today],
      )
    ).rows[0].id;
    const jobs = await claim(db);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, "care");
    assert.ok(!JSON.stringify(jobs).includes("Sensitive reminder"));
    assert.equal((await claim(db)).length, 0);
    await db.query("select finish_admin_push($1,$2,'failed',503)", [
      jobs[0].id,
      jobs[0].lease_token,
    ]);
    await login(db, adminId);
    await db.query("update reminders set completed_at=now() where id=$1", [
      due,
    ]);
    assert.equal((await claim(db)).length, 0);
    await login(db, adminId);
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from admin_push_deliveries where id=$1",
          [jobs[0].id],
        )
      ).rows[0].state,
      "expired",
    );
    // Reopening a task does not resurrect an expired daily delivery.
    await db.query(
      "update reminders set completed_at=null,due_date=$2::date-1 where id=$1",
      [due, dates.today],
    );
    assert.equal((await claim(db)).length, 0);
    const failures = await claim(db, true);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].kind, "scheduler");
    await login(db, adminId);
    const second = (
      await db.query<{ id: string }>(
        "select save_admin_push_device_preferences('https://web.push.apple.com/care-second',$1,$2,$3,'Second phone',false,false,array[1],true) id",
        [p256dh, auth, publicKey],
      )
    ).rows[0].id;
    const overdue = await claim(db);
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0].device_id, second);
    await db.query("select finish_admin_push($1,$2,'failed',503)", [
      overdue[0].id,
      overdue[0].lease_token,
    ]);
    await login(db, adminId);
    await db.query(
      "select update_admin_push_device_preferences($1,'Second phone',false,false,true,array[1],false)",
      [second],
    );
    assert.equal(
      (
        await db.query<{ state: string }>(
          "select state from admin_push_deliveries where id=$1",
          [overdue[0].id],
        )
      ).rows[0].state,
      "expired",
    );
    assert.equal((await claim(db)).length, 0);
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from admin_push_devices")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from admin_push_deliveries")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "select update_admin_push_device_preferences($1,'Other',true,true,true,array[1],true)",
        [device],
      ),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select claim_admin_push($1,false)", [publicKey]),
      /permission denied/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query(
        "select update_admin_push_device_preferences($1,'Other',true,true,true,array[1],true)",
        [device],
      ),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("one bounded check can claim all three alert types for ten devices without granting another administrator control", async () => {
  const db = await inventoryDatabase();
  try {
    await db.query(
      "insert into reminders(title,due_date) values('Due care',(now() at time zone 'America/Chicago')::date)",
    );
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Care queue feed','feed',(select id from expense_categories where name='Feed')) id",
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
    const devices: string[] = [];
    for (let index = 0; index < 10; index++)
      devices.push(
        (
          await db.query<{ id: string }>(
            "select save_admin_push_device_preferences($1,$2,$3,$4,'Phone',true,true,array[1,2,3,4,5,6,7],true) id",
            [
              `https://web.push.apple.com/care-${index}`,
              p256dh,
              auth,
              publicKey,
            ],
          )
        ).rows[0].id,
      );
    const jobs = await claim(db, true);
    assert.equal(jobs.length, 30);
    for (const kind of ["supplier", "scheduler", "care"])
      assert.equal(jobs.filter((job) => job.kind === kind).length, 10);
    assert.equal((await claim(db, true)).length, 0);
    await db.exec("reset role");
    await db.query("insert into admin_users(user_id) values($1)", [outsiderId]);
    await login(db, outsiderId);
    await assert.rejects(
      db.query(
        "select update_admin_push_device_preferences($1,'Stolen',false,false,true,array[1],false)",
        [devices[0]],
      ),
      /Device not found/,
    );
    await login(db, adminId);
    assert.equal(
      (
        await db.query<{ care_alerts: boolean }>(
          "select care_alerts from admin_push_devices where id=$1",
          [devices[0]],
        )
      ).rows[0].care_alerts,
      true,
    );
  } finally {
    await db.close();
  }
});
