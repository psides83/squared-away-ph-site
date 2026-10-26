import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import webpush from "web-push";
import { sendDevicePush } from "../src/lib/push-delivery.ts";
import {
  pushConfig,
  validatePushSubscription,
  pushMessage,
} from "../src/lib/web-push.ts";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
const keys = webpush.generateVAPIDKeys();
const config = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: keys.publicKey,
  VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: "https://squaredawayperformancehorses.vercel.app",
};
test("push config verifies matching keys; provider validation blocks arbitrary server destinations and payloads stay generic", () => {
  assert.equal(pushConfig(config)?.publicKey, keys.publicKey);
  assert.equal(pushConfig({}), null);
  assert.equal(
    pushConfig({
      ...config,
      VAPID_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey,
    }),
    null,
  );
  assert.equal(
    pushConfig({ ...config, VAPID_SUBJECT: "file:///tmp/secret" }),
    null,
  );
  const key = createECDH("prime256v1");
  key.generateKeys();
  const sub = {
    endpoint: "https://web.push.apple.com/example",
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: Buffer.alloc(16, 1).toString("base64url"),
    },
  };
  assert.deepEqual(validatePushSubscription(sub), sub);
  for (const endpoint of [
    "http://web.push.apple.com/a",
    "https://127.0.0.1/a",
    "https://web.push.apple.com.evil.example/a",
    "https://web.push.apple.com@127.0.0.1/a",
    "https://web.push.apple.com:444/a",
    "https://web.push.apple.com/a#secret",
  ])
    assert.throws(() => validatePushSubscription({ ...sub, endpoint }));
  for (const kind of ["supplier", "scheduler", "care"]) {
    const message = pushMessage(kind);
    assert.ok(message.url.startsWith("/admin/"));
    assert.equal(JSON.stringify(message).includes("$"), false);
  }
  assert.throws(() => pushMessage("other"));
});
test("push subscriptions are private, daily queue is deduplicated, leases protect retries and expired endpoints disable safely", async () => {
  const db = await inventoryDatabase();
  try {
    const reg = async (endpoint = "https://web.push.apple.com/device") =>
      (
        await db.query<{ id: string }>(
          "select save_admin_push_device($1,$2,$3,$4,'My phone',true,true) id",
          [endpoint, "A".repeat(87), "B".repeat(22), keys.publicKey],
        )
      ).rows[0].id;
    const device = await reg();
    assert.equal(await reg(), device);
    await db.query("select reserve_admin_push_test($1,$2)", [
      device,
      keys.publicKey,
    ]);
    await assert.rejects(
      db.query("select reserve_admin_push_test($1,$2)", [
        device,
        keys.publicKey,
      ]),
      /one minute/,
    );
    await assert.rejects(reg("https://127.0.0.1/private"), /Invalid device/);
    await assert.rejects(
      db.query("select claim_admin_push($1,true)", [keys.publicKey]),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from admin_push_devices")).rows.length,
      0,
    );
    await assert.rejects(reg(), /Administrator/);
    await login(db, adminId);
    const product = (
      await db.query<{ id: string }>(
        "select create_inventory_product('Push feed','feed',(select id from expense_categories where name='Feed')) id",
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
    type Job = { id: string; kind: string; lease_token: string };
    const service = () => db.exec("reset role;set role service_role");
    const claim = async (failed = true) =>
      (
        await db.query<{ jobs: Job[] }>("select claim_admin_push($1,$2) jobs", [
          keys.publicKey,
          failed,
        ])
      ).rows[0].jobs;
    await service();
    const jobs = await claim();
    assert.equal(jobs.length, 2);
    assert.equal((await claim()).length, 0);
    const supplier = jobs.find((j) => j.kind === "supplier")!,
      scheduler = jobs.find((j) => j.kind === "scheduler")!;
    await db.query("select finish_admin_push($1,$2,'sent',201)", [
      supplier.id,
      crypto.randomUUID(),
    ]);
    await db.query("select finish_admin_push($1,$2,'sent',201)", [
      supplier.id,
      supplier.lease_token,
    ]);
    await db.query("select finish_admin_push($1,$2,'failed',503)", [
      scheduler.id,
      scheduler.lease_token,
    ]);
    assert.equal((await claim()).length, 0); // Backoff, plus sent dedupe.
    await db.exec("reset role");
    await db.query(
      "update admin_push_deliveries set last_attempt_at=now()-interval '6 minutes' where id=$1",
      [scheduler.id],
    );
    await service();
    const retry = (await claim())[0];
    assert.notEqual(retry.lease_token, scheduler.lease_token);
    await db.query("select finish_admin_push($1,$2,'sent',201)", [
      scheduler.id,
      scheduler.lease_token,
    ]); // Old worker cannot settle the new lease.
    await db.query("select finish_admin_push($1,$2,'expired',410)", [
      retry.id,
      retry.lease_token,
    ]);
    await login(db, adminId);
    assert.equal(
      (
        await db.query<{ enabled: boolean }>(
          "select enabled from admin_push_devices where id=$1",
          [device],
        )
      ).rows[0].enabled,
      false,
    );
    const states = (
      await db.query<{ state: string }>(
        "select state from admin_push_deliveries order by kind",
      )
    ).rows.map((r) => r.state);
    assert.deepEqual(states, ["expired", "sent"]);
    await reg();
    await db.query(
      "select update_admin_push_device($1,'My phone',false,false,false)",
      [device],
    );
    await service();
    assert.equal((await claim()).length, 0);
    // Removed admin access blocks future sends, even with a retained subscription.
    await login(db, adminId);
    await reg();
    await db.exec("reset role");
    await db.query("delete from admin_users where user_id=$1", [adminId]);
    await service();
    assert.equal((await claim()).length, 0);
  } finally {
    await db.close();
  }
});
test("push service worker displays generic fallback and only opens allowed same-origin admin destinations", async () => {
  const callbacks: Record<string, (event: any) => void> = {};
  const shown: any[] = [];
  const opened: string[] = [];
  let task: Promise<unknown> | undefined;
  const self = {
    location: { origin: "https://example.test" },
    addEventListener: (name: string, fn: (event: any) => void) =>
      (callbacks[name] = fn),
    registration: {
      showNotification: async (...args: any[]) => {
        shown.push(args);
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
    skipWaiting: () => {},
  };
  vm.runInNewContext(
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    { self, URL },
  );
  callbacks.push({
    data: {
      json: () => ({
        title: "Alert",
        body: "Open app",
        url: "https://evil.test/",
      }),
    },
    waitUntil: (p: Promise<unknown>) => (task = p),
  });
  await task;
  assert.equal(shown[0][1].data.url, "/admin/settings/notifications");
  callbacks.notificationclick({
    notification: { close: () => {}, data: { url: "//evil.test/" } },
    waitUntil: (p: Promise<unknown>) => (task = p),
  });
  await task;
  assert.equal(opened[0], "https://example.test/admin/settings/notifications");
  callbacks.push({
    data: { json: () => pushMessage("care") },
    waitUntil: (p: Promise<unknown>) => (task = p),
  });
  await task;
  assert.equal(shown[1][1].data.url, "/admin/reminders");
  callbacks.notificationclick({
    notification: { close: () => {}, data: { url: "/admin/reminders" } },
    waitUntil: (p: Promise<unknown>) => (task = p),
  });
  await task;
  assert.equal(opened[1], "https://example.test/admin/reminders");
});

test("push transport encrypts notifications, restricts endpoints and handles provider outcomes without exposing responses", async (t) => {
  const key = createECDH("prime256v1");
  key.generateKeys();
  const subscription = {
    endpoint: "https://web.push.apple.com/test",
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: Buffer.alloc(16, 1).toString("base64url"),
    },
  };
  const valid = pushConfig(config)!;
  let calls = 0;
  let code = 201;
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, options: RequestInit) => {
      calls++;
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      assert.ok(options.body);
      return new Response(null, { status: code });
    },
  );
  try {
    assert.deepEqual(await sendDevicePush(valid, subscription, "test"), {
      status: "sent",
      code: 201,
    });
    code = 410;
    assert.deepEqual(await sendDevicePush(valid, subscription, "supplier"), {
      status: "expired",
      code: 410,
    });
    code = 503;
    assert.deepEqual(await sendDevicePush(valid, subscription, "scheduler"), {
      status: "failed",
      code: 503,
    });
    const count = calls;
    assert.deepEqual(
      await sendDevicePush(
        valid,
        { ...subscription, endpoint: "https://127.0.0.1/private" },
        "supplier",
      ),
      { status: "failed", code: null },
    );
    assert.equal(calls, count);
  } finally {
    mock.mock.restore();
  }
});

test("device quota, ownership, preference revocation and changed subscriptions are respected by delayed workers", async () => {
  const db = await inventoryDatabase();
  try {
    const register = async (endpoint: string) =>
      (
        await db.query<{ id: string }>(
          "select save_admin_push_device($1,$2,$3,$4,'Device',true,true) id",
          [endpoint, "A".repeat(87), "B".repeat(22), keys.publicKey],
        )
      ).rows[0].id;
    const endpoint = "https://web.push.apple.com/first";
    const first = await register(endpoint);
    for (let i = 1; i < 10; i++)
      await register(`https://web.push.apple.com/device${i}`);
    await assert.rejects(
      register("https://web.push.apple.com/eleventh"),
      /maximum 10/,
    );
    await db.exec("reset role");
    await db.query("insert into admin_users(user_id) values($1)", [outsiderId]);
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from admin_push_devices")).rows.length,
      0,
    );
    await assert.rejects(register(endpoint), /another account/);
    await assert.rejects(
      db.query("select reserve_admin_push_test($1,$2)", [
        first,
        keys.publicKey,
      ]),
      /Reconnect/,
    );
    await login(db, adminId);
    await db.exec("reset role;set role service_role");
    assert.equal(
      (
        await db.query<{ j: unknown[] }>(
          "select claim_admin_push($1,false) j",
          [keys.publicKey],
        )
      ).rows[0].j.length,
      0,
    ); // No overdue target, no scheduler failure.
    const jobs = (
      await db.query<{
        j: { id: string; device_id: string; lease_token: string }[];
      }>("select claim_admin_push($1,true) j", [keys.publicKey])
    ).rows[0].j;
    assert.equal(jobs.length, 10);
    const stale = jobs.find((j) => j.device_id === first)!;
    await login(db, adminId);
    await register(endpoint); // A fresh subscription must survive a late 410 from its old version.
    await db.exec("reset role;set role service_role");
    await db.query("select finish_admin_push($1,$2,'expired',410)", [
      stale.id,
      stale.lease_token,
    ]);
    await login(db, adminId);
    assert.equal(
      (
        await db.query<{ enabled: boolean }>(
          "select enabled from admin_push_devices where id=$1",
          [first],
        )
      ).rows[0].enabled,
      true,
    );
    await db.query(
      "select update_admin_push_device($1,'Device',false,false,false)",
      [first],
    );
    await register("https://web.push.apple.com/eleventh");
    await assert.rejects(register(endpoint), /maximum 10/); // Re-enabling a disabled device also respects quota.
  } finally {
    await db.close();
  }
});
