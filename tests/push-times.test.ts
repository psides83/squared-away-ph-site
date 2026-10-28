import { createECDH } from "node:crypto";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverAdminPush } from "../src/lib/push-delivery.ts";
import { pushConfig } from "../src/lib/web-push.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  pushReminderTime,
  pushTimeLabel,
  configuredReminderTime,
  frequentPushConfigured,
} from "../src/lib/push-time.ts";
import { handlePushCron } from "../src/lib/push-cron.ts";
const key = "A".repeat(87),
  p256 = "B".repeat(87),
  auth = "C".repeat(22);
const register = async (
  db: Awaited<ReturnType<typeof inventoryDatabase>>,
  time: string | null = "09:00",
) =>
  (
    await db.query<{ id: string }>(
      "select save_admin_push_device_timing('https://web.push.apple.com/time',$1,$2,$3,'Timed phone',true,true,array[1,2,3,4,5,6,7],true,1,$4) id",
      [p256, auth, key, time],
    )
  ).rows[0].id;
test("reminder times are explicit Central clock values and custom selections require frequent-check configuration", () => {
  assert.equal(pushReminderTime(null), null);
  assert.equal(pushReminderTime("00:00"), "00:00");
  assert.equal(pushReminderTime("23:59"), "23:59");
  for (const value of [
    "9:00",
    "24:00",
    "12:60",
    "09:00:00",
    "09:00\n",
    undefined,
    900,
  ])
    assert.throws(() => pushReminderTime(value), /valid reminder/);
  assert.equal(pushTimeLabel(null), "During the daily check");
  assert.equal(pushTimeLabel("09:15:00"), "At or after 9:15 AM Central");
  assert.equal(pushTimeLabel("00:00:00"), "At or after 12:00 AM Central");
  assert.equal(pushTimeLabel("12:00"), "At or after 12:00 PM Central");
  assert.equal(configuredReminderTime(null, false), null);
  assert.throws(
    () => configuredReminderTime("09:00", false),
    /configured first/,
  );
  const env = {
    VERCEL_ENV: "production",
    PUSH_FREQUENT_CHECKS: "1",
    PUSH_CRON_SECRET: "s".repeat(32),
  };
  assert.equal(frequentPushConfigured(env), true);
  assert.equal(
    frequentPushConfigured({ ...env, CRON_SECRET: env.PUSH_CRON_SECRET }),
    false,
  );
  assert.equal(
    frequentPushConfigured({ ...env, VERCEL_ENV: "preview" }),
    false,
  );
  assert.equal(
    frequentPushConfigured({ ...env, PUSH_CRON_SECRET: "short" }),
    false,
  );
  assert.equal(
    frequentPushConfigured({ ...env, PUSH_FREQUENT_CHECKS: "0" }),
    false,
  );
});
test("notification-only endpoint requires its own secret, production and setup; failures are sanitized and never cacheable", async () => {
  const secret = "n".repeat(32);
  let calls = 0;
  const run = async () => {
    calls++;
    return { accepted: 2, failed: 0 };
  };
  const request = (token = secret, method = "POST") =>
    new Request("https://example.test/api/cron/notifications", {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
  const config = { secret, production: true, configured: true };
  for (const [req, cfg, status] of [
    [request("billing-secret"), config, 401],
    [request(), { ...config, secret: "" }, 503],
    [request(), { ...config, production: false }, 503],
    [request(), { ...config, configured: false }, 503],
    [request(secret, "GET"), config, 405],
  ] as const) {
    const r = await handlePushCron(req, cfg, run);
    assert.equal(r.status, status);
    assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(calls, 0);
  const ok = await handlePushCron(request(), config, run);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { accepted: 2, failed: 0 });
  assert.equal(calls, 1);
  assert.equal(
    (
      await handlePushCron(request(), config, async () => ({
        accepted: 0,
        failed: 1,
      }))
    ).status,
    500,
  );
  const error = await handlePushCron(request(), config, async () => {
    throw Error("private token and database payload");
  });
  assert.equal(error.status, 500);
  assert.doesNotMatch(await error.text(), /private token/);
});
test("timing preferences validate atomically, preserve legacy callers and enforce ownership/privacy", async () => {
  const db = await inventoryDatabase();
  try {
    const id = await register(db);
    await db.query(
      "select update_admin_push_device_cadence($1,'Legacy edit',true,true,true,array[1,2,3,4,5,6,7],true,3)",
      [id],
    );
    await db.query(
      "select save_admin_push_device_cadence('https://web.push.apple.com/time',$1,$2,$3,'Legacy reconnect',true,true,array[1,2,3,4,5,6,7],true,3)",
      [p256, auth, key],
    );
    assert.equal(
      (
        await db.query<{ t: string }>(
          "select reminder_time t from admin_push_devices where id=$1",
          [id],
        )
      ).rows[0].t,
      "09:00:00",
    );
    for (const time of ["24:00", "9:00", "12:00:01", ""]) {
      await assert.rejects(
        db.query(
          "select update_admin_push_device_timing($1,'Invalid',true,true,true,array[1],false,1,$2)",
          [id, time],
        ),
        /valid reminder/,
      );
    }
    assert.equal(
      (
        await db.query<{ label: string }>(
          "select label from admin_push_devices where id=$1",
          [id],
        )
      ).rows[0].label,
      "Legacy reconnect",
    );
    await db.query(
      "select update_admin_push_device_timing($1,'Daily again',true,true,true,array[1],false,1,null)",
      [id],
    );
    assert.equal(
      (
        await db.query<{ t: null }>(
          "select reminder_time t from admin_push_devices where id=$1",
          [id],
        )
      ).rows[0].t,
      null,
    );
    await assert.rejects(
      db.query("select admin_push_reminder_due($1,now())", [id]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select validate_admin_push_time('09:00')"),
      /permission denied/,
    );
    await login(db, outsiderId);
    await assert.rejects(register(db), /Administrator/);
    assert.equal(
      (await db.query("select * from admin_push_devices")).rows.length,
      0,
    );
    await db.exec("reset role");
    await db.query("insert into admin_users(user_id) values($1)", [outsiderId]);
    await login(db, outsiderId);
    await assert.rejects(
      db.query(
        "select update_admin_push_device_timing($1,'Other admin',true,true,true,array[1],true,1,'08:00')",
        [id],
      ),
      /not found/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(register(db), /permission denied/);
  } finally {
    await db.close();
  }
});
test("Central reminder eligibility handles exact times, winter/summer offsets and both daylight-saving transitions", async () => {
  const db = await inventoryDatabase();
  try {
    const id = await register(db, "09:00");
    await db.exec("reset role");
    const due = async (at: string) =>
      (
        await db.query<{ v: boolean }>(
          "select admin_push_reminder_due($1,$2) v",
          [id, at],
        )
      ).rows[0].v;
    assert.equal(await due("2026-01-15T14:59:59Z"), false);
    assert.equal(await due("2026-01-15T15:00:00Z"), true);
    assert.equal(await due("2026-07-15T13:59:59Z"), false);
    assert.equal(await due("2026-07-15T14:00:00Z"), true);
    await db.query(
      "update admin_push_devices set reminder_time='02:30' where id=$1",
      [id],
    );
    assert.equal(await due("2026-03-08T07:59:59Z"), false);
    assert.equal(await due("2026-03-08T08:00:00Z"), true);
    await db.query(
      "update admin_push_devices set reminder_time='01:30' where id=$1",
      [id],
    );
    assert.equal(await due("2026-11-01T06:29:59Z"), false);
    assert.equal(await due("2026-11-01T06:30:00Z"), true);
    assert.equal(await due("2026-11-01T07:30:00Z"), true);
    await db.query(
      "update admin_push_devices set reminder_time=null where id=$1",
      [id],
    );
    assert.equal(await due("2026-07-15T05:00:00Z"), true);
  } finally {
    await db.close();
  }
});
test("care jobs wait without expiring or using attempts; scheduler failures bypass preferred times and accepted care stays deduplicated", async () => {
  const db = await inventoryDatabase();
  try {
    const id = await register(db, "00:00");
    await db.query(
      "insert into reminders(title,due_date) values('Care due',(now() at time zone 'America/Chicago')::date)",
    );
    await db.exec("reset role;begin");
    // Freeze a transaction clock and choose a time after it, including tests run in the day's last minute.
    await db.query(
      "update admin_push_devices set reminder_time='23:59:59.999999' where id=$1",
      [id],
    );
    const claim = async (failed = false) => {
      await db.exec("set role service_role");
      return (
        await db.query<{
          jobs: { id: string; kind: string; lease_token: string }[];
        }>("select claim_admin_push($1,$2) jobs", [key, failed])
      ).rows[0].jobs;
    };
    let jobs = await claim(true);
    assert.deepEqual(
      jobs.map((j) => j.kind),
      ["scheduler"],
    );
    await db.query("select finish_admin_push($1,$2,'sent',201)", [
      jobs[0].id,
      jobs[0].lease_token,
    ]);
    await db.exec("reset role");
    await db.query(
      "update admin_push_devices set reminder_time='00:00' where id=$1",
      [id],
    );
    jobs = await claim();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, "care");
    const care = jobs[0];
    await db.query("select finish_admin_push($1,$2,'failed',503)", [
      care.id,
      care.lease_token,
    ]);
    await db.exec("reset role");
    await db.query(
      "update admin_push_deliveries set last_attempt_at=now()-interval '6 minutes' where id=$1",
      [care.id],
    );
    await db.query(
      "update admin_push_devices set reminder_time='23:59:59.999999' where id=$1",
      [id],
    );
    assert.equal((await claim()).length, 0);
    await db.exec("reset role");
    assert.deepEqual(
      (
        await db.query(
          "select state,attempts from admin_push_deliveries where id=$1",
          [care.id],
        )
      ).rows[0],
      { state: "failed", attempts: 1 },
    );
    await db.query(
      "update admin_push_devices set reminder_time='00:00' where id=$1",
      [id],
    );
    jobs = await claim();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, care.id);
    await db.query("select finish_admin_push($1,$2,'sent',201)", [
      jobs[0].id,
      jobs[0].lease_token,
    ]);
    assert.equal((await claim()).length, 0);
    await db.exec("reset role");
    await db.query(
      "insert into admin_push_devices(user_id,endpoint,p256dh,auth_key,vapid_public,label,supplier_alerts,care_alerts,scheduler_alerts) values(auth.uid(),'https://web.push.apple.com/daily-legacy',$1,$2,$3,'Daily device',false,true,true)",
      [p256, auth, key],
    );
    await db.exec("set role service_role");
    assert.deepEqual(
      (
        await db.query<{ jobs: unknown[] }>(
          "select claim_timed_admin_push($1) jobs",
          [key],
        )
      ).rows[0].jobs,
      [],
    );
    // The same daily device still receives its reminder from the existing daily coordinator.
    assert.equal((await claim()).length, 1);
    await db.exec("reset role;rollback");
  } finally {
    await db.close();
  }
});

test("timed supplier checks retain weekday/interval gates and never dispatch daily-only devices", async () => {
  const db = await inventoryDatabase();
  try {
    const id = await register(db, "00:00");
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Timed feed','feed',(select id from expense_categories where name='Feed')) id",
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    await db.query(
      "select record_stock_movement($1,$2,$3,10,'purchase','2020-01-01',1000,null,null,'Store',null)",
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
    await db.exec("reset role;begin");
    const claim = async () => {
      await db.exec("set role service_role");
      return (
        await db.query<{
          jobs: { id: string; kind: string; lease_token: string }[];
        }>("select claim_timed_admin_push($1) jobs", [key])
      ).rows[0].jobs;
    };
    await db.query(
      "update admin_push_devices set reminder_time='23:59:59.999999' where id=$1",
      [id],
    );
    assert.equal((await claim()).length, 0);
    await db.exec("reset role");
    await db.query(
      "update admin_push_devices set reminder_time='00:00',supplier_days=array[(extract(isodow from (now() at time zone 'America/Chicago'))::integer % 7)+1] where id=$1",
      [id],
    );
    assert.equal((await claim()).length, 0);
    await db.exec("reset role");
    await db.query(
      "update admin_push_devices set supplier_days=array[1,2,3,4,5,6,7],supplier_interval_days=3 where id=$1",
      [id],
    );
    await db.query(
      "insert into admin_push_deliveries(device_id,kind,business_date,state,sent_at) values($1,'supplier',(now() at time zone 'America/Chicago')::date-1,'sent',now()-interval '1 day')",
      [id],
    );
    assert.equal((await claim()).length, 0);
    await db.exec("reset role");
    await db.query(
      "update admin_push_devices set supplier_interval_days=1 where id=$1",
      [id],
    );
    const jobs = await claim();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, "supplier");
    await db.query("select finish_admin_push($1,$2,'sent',201)", [
      jobs[0].id,
      jobs[0].lease_token,
    ]);
    assert.equal((await claim()).length, 0);
    await db.exec("reset role;rollback");
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select claim_timed_admin_push($1)", [key]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select claim_admin_push_queue($1,false,true)", [key]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("notification-only sender uses the restricted queue and ten-wide bounded dispatch; daily dispatch stays five-wide", async (t) => {
  const keys = webpush.generateVAPIDKeys(),
    ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const config = pushConfig({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: "https://example.test",
  })!;
  const jobs = Array.from({ length: 30 }, () => ({
    id: crypto.randomUUID(),
    kind: "care",
    lease_token: crypto.randomUUID(),
    endpoint: "https://web.push.apple.com/sample",
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth_key: Buffer.alloc(16, 1).toString("base64url"),
  }));
  let active = 0,
    maxActive = 0;
  const calls: { name: string; values: any }[] = [];
  const mock = t.mock.method(globalThis, "fetch", async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 0));
    active--;
    return new Response(null, { status: 201 });
  });
  const db = {
    rpc(name: string, values: any) {
      calls.push({ name, values });
      return {
        abortSignal: async () => ({
          data: name.startsWith("claim_") ? jobs : null,
          error: null,
        }),
      };
    },
  } as unknown as SupabaseClient;
  try {
    assert.deepEqual(await deliverAdminPush(db, config, false, 10, true), {
      accepted: 30,
      failed: 0,
    });
    assert.equal(maxActive, 10);
    assert.equal(calls[0].name, "claim_timed_admin_push");
    assert.deepEqual(calls[0].values, { p_public: keys.publicKey });
    assert.equal(
      calls.filter((c) => c.name === "finish_admin_push").length,
      30,
    );
    assert.ok(
      calls.every((c) =>
        ["claim_timed_admin_push", "finish_admin_push"].includes(c.name),
      ),
    );
    calls.length = 0;
    maxActive = 0;
    assert.deepEqual(await deliverAdminPush(db, config, true), {
      accepted: 30,
      failed: 0,
    });
    assert.equal(maxActive, 5);
    assert.equal(calls[0].name, "claim_admin_push");
    assert.equal(
      (calls[0].values as { p_scheduler_failed?: boolean }).p_scheduler_failed,
      true,
    );
  } finally {
    mock.mock.restore();
  }
});
