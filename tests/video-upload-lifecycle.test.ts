import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("setting aside and restoring video uploads retains objects and history, rejects stale changes and never resurrects late requests", async () => {
  const db = await inventoryDatabase();
  try {
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Lifecycle horse') returning id",
      )
    ).rows[0].id;
    const id = crypto.randomUUID(),
      hash = "a".repeat(64);
    const prepare = () =>
      db.query<{ path: string }>(
        "select prepare_horse_video_transfer($1,$2,'Clip','clip.mp4','video/mp4',10000,$3) path",
        [id, horse, hash],
      );
    const path = (await prepare()).rows[0].path;
    const change = (
      request: string,
      revision: number,
      action: string,
      reason: string,
    ) =>
      db.query("select change_horse_video_upload($1,$2,$3,$4,$5)", [
        request,
        id,
        revision,
        action,
        reason,
      ]);
    const abandoned = crypto.randomUUID();
    await change(abandoned, 0, "abandon", "Duplicate attempt");
    await change(abandoned, 0, "abandon", "Duplicate attempt");
    await assert.rejects(
      change(abandoned, 0, "abandon", "Changed reason"),
      /different details/,
    );
    await assert.rejects(
      change(crypto.randomUUID(), 0, "restore", "Stale tab"),
      /changed/,
    );
    await assert.rejects(
      change(crypto.randomUUID(), 1, "restore", " "),
      /enter a reason/,
    );
    await assert.rejects(prepare(), /set aside/);
    await assert.rejects(
      db.query(
        "select prepare_horse_video($1,$2,'Clip','clip.mp4','video/mp4',10000)",
        [id, horse],
      ),
      /set aside/,
    );
    // A transfer whose token was already issued can still arrive; recovery stays blocked.
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('horse-videos',$1,$2)",
      [path, { size: 10000, mimetype: "video/mp4" }],
    );
    await assert.rejects(
      db.query("select finish_horse_video($1)", [id]),
      /set aside/,
    );
    assert.equal(
      (await db.query("select id from horse_files where id=$1", [id])).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query("select id from storage.objects where name=$1", [path]))
        .rows.length,
      1,
    );
    await change(crypto.randomUUID(), 1, "restore", "Recover completed clip");
    // Delayed retry of the first request is a no-op, even after restoration.
    await change(abandoned, 0, "abandon", "Duplicate attempt");
    const current = (
      await db.query<{ abandoned_at: null; revision: number }>(
        "select abandoned_at,revision from horse_video_uploads where id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(current.abandoned_at, null);
    assert.equal(current.revision, 2);
    assert.equal(
      (
        await db.query(
          "select id from horse_video_upload_events where upload_id=$1",
          [id],
        )
      ).rows.length,
      2,
    );
    await prepare();
    await db.query("select finish_horse_video($1)", [id]);
    await assert.rejects(
      change(crypto.randomUUID(), 2, "abandon", "Saved file"),
      /already saved/,
    );
    await db.query("select finish_horse_video($1)", [id]);
    assert.equal(
      (await db.query("select id from horse_files where id=$1", [id])).rows
        .length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select id from portal_admin_events where file_id=$1 and kind='file_attached'",
          [id],
        )
      ).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
test("upload lifecycle and helper functions cannot bypass administrator permissions or audit history", async () => {
  const db = await inventoryDatabase();
  try {
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Private upload') returning id",
      )
    ).rows[0].id;
    const id = crypto.randomUUID();
    await db.query(
      "select prepare_horse_video($1,$2,'Private','private.mp4','video/mp4',10000)",
      [id, horse],
    );
    await db.query(
      "select change_horse_video_upload($1,$2,0,'abandon','Unused clip')",
      [crypto.randomUUID(), id],
    );
    await assert.rejects(
      db.query("update horse_video_uploads set abandoned_at=null where id=$1", [
        id,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("delete from horse_video_upload_events where upload_id=$1", [
        id,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select finish_horse_video_before_lifecycle($1)", [id]),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "select prepare_horse_video_before_lifecycle($1,$2,'Private','private.mp4','video/mp4',10000)",
        [id, horse],
      ),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from horse_video_uploads")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from horse_video_upload_events")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(
        "select change_horse_video_upload($1,$2,1,'restore','Not admin')",
        [crypto.randomUUID(), id],
      ),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select finish_horse_video($1)", [id]),
      /Administrator/,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query(
        "select change_horse_video_upload($1,$2,1,'restore','Anonymous')",
        [crypto.randomUUID(), id],
      ),
      /permission denied/,
    );
    await login(db, adminId);
    assert.equal(
      (await db.query("select * from horse_video_upload_events")).rows.length,
      1,
    );
  } finally {
    await db.close();
  }
});
