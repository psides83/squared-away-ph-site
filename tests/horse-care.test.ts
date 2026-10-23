import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("care stays private until deliberately shared and manual portal grants expose only safe fields", async () => {
  const db = await inventoryDatabase();
  try {
    const coowner = "20000000-0000-4000-8000-000000000003",
      unrelated = "20000000-0000-4000-8000-000000000004";
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='customer@example.com' where id=$1",
      [outsiderId],
    );
    await db.query(
      "insert into auth.users(id,email) values($1,'coowner@example.com'),($2,'unrelated@example.com')",
      [coowner, unrelated],
    );
    await login(db, adminId);
    const customers = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Customer'),('Co-owner'),('Unrelated') returning id",
      )
    ).rows;
    const horses = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Horse'),('Other horse') returning id",
      )
    ).rows;
    for (const [index, email] of [
      "customer@example.com",
      "coowner@example.com",
      "unrelated@example.com",
    ].entries())
      await db.query(
        "select grant_customer_portal($1,$2,$3,'Existing account')",
        [crypto.randomUUID(), customers[index].id, email],
      );
    for (const index of [0, 1])
      await db.query(
        "select set_customer_horse_access($1,$2,$3,null,true,'Manual shared horse access')",
        [crypto.randomUUID(), customers[index].id, horses[0].id],
      );
    // Ownership alone does not expose care.
    await db.query(
      "insert into horse_customers(horse_id,customer_id) values($1,$2)",
      [horses[0].id, customers[2].id],
    );
    const data = {
      horse_id: horses[0].id,
      care_date: "2020-01-01",
      kind: "farrier",
      title: "Trim completed",
      provider: "Farrier",
      notes: "Routine trim completed.",
      private_notes: "Trainer-only confidential note",
    };
    const id = crypto.randomUUID();
    await db.query("select save_horse_care($1,null,0,$2)", [id, data]);
    await db.query("select save_horse_care($1,null,0,$2)", [id, data]);
    await assert.rejects(
      db.query("select save_horse_care($1,null,0,$2)", [
        id,
        { ...data, title: "Changed payload" },
      ]),
      /already used/,
    );
    async function portal(horse: string | null = null, page = 1) {
      return (
        await db.query<{
          r: { rows: Record<string, unknown>[]; total: number };
        }>("select portal_care_records($1,$2) r", [horse, page])
      ).rows[0].r;
    }
    await login(db, outsiderId);
    assert.equal((await portal()).total, 0);
    assert.equal(
      (await db.query("select * from horse_care_records")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from horse_care_events")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select save_horse_care($1,null,0,$2)", [
        crypto.randomUUID(),
        data,
      ]),
      /Administrator/,
    );
    await login(db, adminId);
    const share = crypto.randomUUID();
    await db.query(
      "select change_horse_care($1,$2,1,'share','Reviewed customer details')",
      [share, id],
    );
    await db.query(
      "select change_horse_care($1,$2,1,'share','Reviewed customer details')",
      [share, id],
    );
    await assert.rejects(
      db.query("select save_horse_care($1,$2,2,$3)", [
        crypto.randomUUID(),
        id,
        data,
      ]),
      /Unshare/,
    );
    await login(db, outsiderId);
    let r = await portal();
    assert.equal(r.total, 1);
    assert.equal(r.rows[0].title, data.title);
    assert.equal(r.rows[0].notes, data.notes);
    assert.ok(!("private_notes" in r.rows[0]));
    assert.ok(!JSON.stringify(r).includes("confidential"));
    assert.equal((await portal(horses[1].id)).total, 0);
    await assert.rejects(
      db.query("select change_horse_care($1,$2,2,'archive','Unauthorized')", [
        crypto.randomUUID(),
        id,
      ]),
      /Administrator/,
    );
    await login(db, coowner);
    assert.equal((await portal()).total, 1);
    await login(db, unrelated);
    assert.equal((await portal()).total, 0);
    await login(db, adminId);
    await db.query(
      "select change_horse_care($1,$2,2,'unshare','Correcting care details')",
      [crypto.randomUUID(), id],
    );
    await assert.rejects(
      db.query("select save_horse_care($1,$2,2,$3)", [
        crypto.randomUUID(),
        id,
        data,
      ]),
      /changed/,
    );
    await assert.rejects(
      db.query("select save_horse_care($1,$2,3,$3)", [
        crypto.randomUUID(),
        id,
        { ...data, horse_id: horses[1].id },
      ]),
      /original horse/,
    );
    await db.query("select save_horse_care($1,$2,3,$3)", [
      crypto.randomUUID(),
      id,
      { ...data, notes: "Corrected trim details" },
    ]);
    await db.query(
      "select change_horse_care($1,$2,4,'share','Reviewed corrected details')",
      [crypto.randomUUID(), id],
    );
    await db.query(
      "select change_horse_care($1,$2,5,'archive','Retain record in history')",
      [crypto.randomUUID(), id],
    );
    await login(db, outsiderId);
    assert.equal((await portal()).total, 0);
    await login(db, adminId);
    await db.query(
      "select change_horse_care($1,$2,6,'restore','Restore private record')",
      [crypto.randomUUID(), id],
    );
    assert.equal(
      (
        await db.query<{ p: null }>(
          "select published_at p from horse_care_records where id=$1",
          [id],
        )
      ).rows[0].p,
      null,
    );
    await db.query(
      "select change_horse_care($1,$2,7,'share','Share restored details')",
      [crypto.randomUUID(), id],
    );
    await db.query(
      "select set_customer_horse_access($1,$2,$3,'2099-01-01',true,'Future publication cutoff')",
      [crypto.randomUUID(), customers[0].id, horses[0].id],
    );
    await login(db, outsiderId);
    assert.equal((await portal()).total, 0);
    await login(db, adminId);
    await db.query(
      "select set_customer_horse_access($1,$2,$3,null,false,'Access revoked')",
      [crypto.randomUUID(), customers[1].id, horses[0].id],
    );
    await login(db, coowner);
    assert.equal((await portal()).total, 0);
    await login(db, adminId);
    await assert.rejects(
      db.query("select save_horse_care($1,null,0,$2)", [
        crypto.randomUUID(),
        { ...data, care_date: "2099-01-01" },
      ]),
      /actual care date/,
    );
    await assert.rejects(
      db.query("delete from horse_care_records"),
      /permission denied/,
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from expenses"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from horse_care_events where record_id=$1",
          [id],
        )
      ).rows[0].n,
      8,
    );
    await db.query(
      "select set_customer_horse_access($1,$2,$3,null,true,'Restore access for page checks')",
      [crypto.randomUUID(), customers[0].id, horses[0].id],
    );
    for (let n = 0; n < 26; n++) {
      const extra = crypto.randomUUID();
      await db.query("select save_horse_care($1,null,0,$2)", [
        extra,
        { ...data, title: `Care ${n}` },
      ]);
      await db.query(
        "select change_horse_care($1,$2,1,'share','Reviewed for sharing')",
        [crypto.randomUUID(), extra],
      );
    }
    await login(db, outsiderId);
    assert.equal((await portal()).rows.length, 25);
    assert.equal((await portal(null, 2)).rows.length, 2);
    assert.equal((await portal()).total, 27);
    await assert.rejects(portal(null, 0), /valid care page/);
    await login(db, adminId);
    await db.query("select disable_customer_portal($1,'Account disabled')", [
      customers[0].id,
    ]);
    await login(db, outsiderId);
    await assert.rejects(portal(), /portal access/);
    await db.exec("reset role;set role anon");
    await assert.rejects(portal(), /permission denied/);
  } finally {
    await db.close();
  }
});
