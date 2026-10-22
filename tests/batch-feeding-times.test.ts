import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";

test("feeding time setup saves more than three, retries safely, rolls back conflicts, and protects access", async () => {
  const db = await inventoryDatabase();
  try {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: randomUUID(),
      name: `Custom ${i}`,
      time_of_day: i === 0 ? "06:30" : null,
      sort_order: i + 30,
    }));
    const save = (value: unknown) =>
      db.query("select public.create_feeding_times($1::jsonb)", [
        JSON.stringify(value),
      ]);
    await save(rows);
    await save(rows);
    const count = async () =>
      Number(
        (
          await db.query<{ count: string }>(
            "select count(*) from public.feeding_times",
          )
        ).rows[0].count,
      );
    assert.equal(await count(), 8);
    await assert.rejects(
      save([
        { ...rows[0], name: "Changed" },
        {
          id: randomUUID(),
          name: "Another",
          time_of_day: null,
          sort_order: 90,
        },
      ]),
    );
    assert.equal(await count(), 8);
    await assert.rejects(
      save([
        {
          id: randomUUID(),
          name: "New valid",
          time_of_day: null,
          sort_order: 90,
        },
        {
          id: randomUUID(),
          name: "Morning",
          time_of_day: null,
          sort_order: 91,
        },
      ]),
    );
    assert.equal(await count(), 8);
    await assert.rejects(
      save([
        {
          id: randomUUID(),
          name: "Duplicate",
          time_of_day: null,
          sort_order: 90,
        },
        {
          id: randomUUID(),
          name: "duplicate",
          time_of_day: null,
          sort_order: 91,
        },
      ]),
    );
    await assert.rejects(
      save([
        {
          id: randomUUID(),
          name: "Invalid",
          time_of_day: "24:00",
          sort_order: 90,
        },
      ]),
    );
    await db.query("update public.feeding_times set name=$1 where id=$2", [
      "Edited custom",
      rows[0].id,
    ]);
    assert.equal(
      (
        await db.query<{ name: string }>(
          "select name from public.feeding_times where id=$1",
          [rows[1].id],
        )
      ).rows[0].name,
      "Custom 1",
    );
    await login(db, outsiderId);
    await assert.rejects(
      save([
        {
          id: randomUUID(),
          name: "Unauthorized",
          time_of_day: null,
          sort_order: 90,
        },
      ]),
      /Administrator/,
    );
  } finally {
    await db.close();
  }
});
