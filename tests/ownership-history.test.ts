import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";

test("ownership history snapshots migration baselines and actual changes without duplicating saves", async () => {
  const db = await inventoryDatabase("20261022002700_expense_followup.sql");
  try {
    const customers = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Original owner'),('New owner') returning id",
      )
    ).rows;
    const first = customers[0].id,
      second = customers[1].id;
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('History horse') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into horse_customers(horse_id,customer_id) values($1,$2)",
      [horse, first],
    );
    const stay = (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,monthly_rate_cents) values($1,$2,'2026-01-01',0) returning id",
        [horse, first],
      )
    ).rows[0].id;
    await db.exec("reset role");
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261022002800_ownership_history.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query(
      "insert into customer_horse_access(customer_id,horse_id,visible_from,active) values($1,$2,'2026-01-01',true)",
      [first, horse],
    );
    await db.query(
      "insert into customer_portal_accounts(customer_id,user_id,linked_email) values($1,$2,'customer@example.com')",
      [first, outsiderId],
    );
    await login(db, adminId);
    let events = (
      await db.query<{
        event: string;
        customer_name: string;
        actor_id: string | null;
      }>(
        "select * from horse_ownership_events where horse_id=$1 order by recorded_at,id",
        [horse],
      )
    ).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "baseline");
    assert.equal(events[0].actor_id, null);
    await db.query(
      "select save_horse_with_customers($1::jsonb,$2::uuid[],$3)",
      [JSON.stringify({ barn_name: "History horse" }), [first, first], horse],
    );
    assert.equal(
      (await db.query("select * from horse_ownership_events")).rows.length,
      1,
    );
    await db.query(
      "select save_horse_with_customers($1::jsonb,$2::uuid[],$3)",
      [JSON.stringify({ barn_name: "History horse" }), [first, second], horse],
    );
    await db.query("update customers set name='Renamed owner' where id=$1", [
      first,
    ]);
    await db.query(
      "select save_horse_with_customers($1::jsonb,$2::uuid[],$3)",
      [JSON.stringify({ barn_name: "History horse" }), [second], horse],
    );
    events = (
      await db.query<{
        event: string;
        customer_name: string;
        actor_id: string | null;
      }>(
        "select * from horse_ownership_events where horse_id=$1 order by recorded_at,id",
        [horse],
      )
    ).rows;
    assert.deepEqual(
      events.map((e) => e.event),
      ["baseline", "added", "removed"],
    );
    assert.equal(events[0].customer_name, "Original owner");
    assert.equal(events[2].customer_name, "Renamed owner");
    assert.equal(events[1].actor_id, adminId);
    assert.equal(
      (
        await db.query<{ billing_customer_id: string }>(
          "select billing_customer_id from training_stays where id=$1",
          [stay],
        )
      ).rows[0].billing_customer_id,
      first,
    );
    const access = (
      await db.query<{ customer_id: string; active: boolean }>(
        "select customer_id,active from customer_horse_access where horse_id=$1",
        [horse],
      )
    ).rows;
    assert.deepEqual(access, [{ customer_id: first, active: true }]);
    await db.query(
      "update horse_customers set relationship='co-owner' where horse_id=$1",
      [horse],
    );
    assert.equal(
      (
        await db.query<{ event: string }>(
          "select event from horse_ownership_events order by recorded_at desc limit 1",
        )
      ).rows[0].event,
      "relationship_changed",
    );
    await db.query(
      "update horse_customers set relationship='co-owner' where horse_id=$1",
      [horse],
    );
    assert.equal(
      (await db.query("select * from horse_ownership_events")).rows.length,
      4,
    );
    await db.query("delete from customers where id=$1", [second]).then(
      () => assert.fail("current owner deletion allowed"),
      () => {},
    );
    const before = (await db.query("select * from horse_ownership_events")).rows
      .length;
    await assert.rejects(
      db.query("select save_horse_with_customers($1::jsonb,$2::uuid[],$3)", [
        JSON.stringify({ barn_name: "Should roll back" }),
        [crypto.randomUUID()],
        horse,
      ]),
    );
    assert.equal(
      (await db.query("select * from horse_ownership_events")).rows.length,
      before,
    );
    await assert.rejects(
      db.query(
        "insert into horse_ownership_events(horse_id,customer_id,customer_name,event) values($1,$2,'Forged','added')",
        [horse, first],
      ),
    );
    await assert.rejects(
      db.query("update horse_ownership_events set customer_name='Tampered'"),
    );
    await assert.rejects(db.query("delete from horse_ownership_events"));
    await assert.rejects(db.query("select record_horse_ownership_event()"));
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from horse_ownership_events")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into horse_customers(horse_id,customer_id) values($1,$2)",
        [horse, first],
      ),
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(db.query("select * from horse_ownership_events"));
  } finally {
    await db.close();
  }
});

test("new horses get link history atomically and retained history prevents accidental horse deletion", async () => {
  const db = await inventoryDatabase();
  try {
    const owner = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Owner') returning id",
      )
    ).rows[0].id;
    const horse = (
      await db.query<{ id: string }>(
        "select save_horse_with_customers($1::jsonb,$2::uuid[]) as id",
        [JSON.stringify({ barn_name: "New horse" }), [owner]],
      )
    ).rows[0].id;
    assert.equal(
      (
        await db.query<{ event: string }>(
          "select event from horse_ownership_events where horse_id=$1",
          [horse],
        )
      ).rows[0].event,
      "added",
    );
    await db.query("delete from horse_customers where horse_id=$1", [horse]);
    await db.query("delete from customers where id=$1", [owner]);
    assert.equal(
      (
        await db.query<{ customer_name: string }>(
          "select customer_name from horse_ownership_events where horse_id=$1",
          [horse],
        )
      ).rows[0].customer_name,
      "Owner",
    );
    await assert.rejects(db.query("delete from horses where id=$1", [horse]));
    assert.equal(
      (
        await db.query(
          "select * from horse_ownership_events where horse_id=$1",
          [horse],
        )
      ).rows.length,
      2,
    );
  } finally {
    await db.close();
  }
});
