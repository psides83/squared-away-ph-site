import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("quick training writes selected sessions atomically and preserves retry history", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec("reset role");
    const horse = crypto.randomUUID(),
      second = crypto.randomUUID(),
      other = crypto.randomUUID(),
      customer = crypto.randomUUID();
    await db.query(
      "insert into customers(id,name) values($1,'Training owner')",
      [customer],
    );
    await db.query(
      "insert into horses(id,barn_name) values($1,'One'),($2,'Two'),($3,'No stay')",
      [horse, second, other],
    );
    await db.query(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,monthly_rate_cents) values($1,$3,'2020-01-01',10000),($2,$3,'2020-01-01',10000)",
      [horse, second, customer],
    );
    await login(db, adminId);
    const log = (request: string, ids: string[], title = "Cow work") =>
      db.query(
        "select log_training_batch($1,$2,'2020-01-02',$3,'Worked on stops',30)",
        [request, ids, title],
      );
    const failed = crypto.randomUUID();
    await assert.rejects(log(failed, [horse, other]), /training stay/);
    assert.equal(
      (await db.query("select * from training_entries")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from training_log_batches")).rows.length,
      0,
    );
    const request = crypto.randomUUID();
    await log(request, [horse, second]);
    await log(request, [second, horse]);
    assert.equal(
      (await db.query("select * from training_entries")).rows.length,
      2,
    );
    await assert.rejects(
      log(request, [horse, second], "Different"),
      /different session/,
    );
    await assert.rejects(log(crypto.randomUUID(), [horse, horse]), /only once/);
    await db.query(
      "update training_entries set notes='Edited individually' where horse_id=$1",
      [horse],
    );
    await log(request, [horse, second]);
    assert.equal(
      (
        await db.query<{ notes: string }>(
          "select notes from training_entries where horse_id=$1",
          [horse],
        )
      ).rows[0].notes,
      "Edited individually",
    );
    await db.query("delete from training_entries where batch_id=$1", [request]);
    await log(request, [horse, second]);
    assert.equal(
      (await db.query("select * from training_entries")).rows.length,
      0,
    );
    await log(crypto.randomUUID(), [horse]);
    assert.equal(
      (await db.query("select * from training_entries")).rows.length,
      1,
    );
    await login(db, outsiderId);
    await assert.rejects(log(crypto.randomUUID(), [horse]), /Administrator/);
    assert.equal(
      (await db.query("select * from training_log_batches")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
