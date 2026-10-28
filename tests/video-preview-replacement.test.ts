import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const horse = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Thumbnail horse') returning id",
    )
  ).rows[0].id;
  const file = crypto.randomUUID();
  const path = (
    await db.query<{ p: string }>(
      "select prepare_horse_video($1,$2,'Training video','clip.mp4','video/mp4',10000) p",
      [file, horse],
    )
  ).rows[0].p;
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('horse-videos',$1,$2)",
    [path, { size: 10000, mimetype: "video/mp4" }],
  );
  await db.query("select finish_horse_video($1)", [file]);
  const object = (hash: string) => `${horse}/${file}/${hash}.jpg`;
  const upload = (hash: string, size = 1000, mimetype = "image/jpeg") =>
    db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('horse-video-previews',$1,$2)",
      [object(hash), { size, mimetype }],
    );
  const a = "a".repeat(64),
    b = "b".repeat(64),
    c = "c".repeat(64);
  await upload(a);
  await db.query("select attach_video_preview($1,$2,1000)", [file, a]);
  const replace = (id: string, expected = a, next = b, size = 1000) =>
    db.query("select replace_video_preview($1,$2,$3,$4,$5)", [
      id,
      file,
      expected,
      next,
      size,
    ]);
  const current = async () =>
    (
      await db.query<{ sha256: string; object_path: string }>(
        "select sha256,object_path from horse_video_previews where file_id=$1",
        [file],
      )
    ).rows[0];
  return { db, horse, file, path, object, upload, a, b, c, replace, current };
}
test("reviewed video replacements require matching uploaded metadata, retain history and reject stale edits without overwriting", async () => {
  const f = await fixture();
  try {
    const request = crypto.randomUUID();
    await assert.rejects(f.replace(request), /matching JPEG/);
    await assert.rejects(f.replace(request, f.a, f.b, 524289), /Invalid/);
    await assert.rejects(f.replace(request, f.a, f.a), /matches the saved/);
    await f.upload(f.b, 999);
    await assert.rejects(f.replace(request), /matching JPEG/);
    assert.equal((await f.current()).sha256, f.a);
    await f.db.exec("reset role");
    await f.db.query("update storage.objects set metadata=$1 where name=$2", [
      { size: 1000, mimetype: "image/jpeg" },
      f.object(f.b),
    ]);
    await login(f.db, adminId);
    await f.replace(request);
    await f.replace(request);
    assert.equal((await f.current()).sha256, f.b);
    const first = (
      await f.db.query<{
        previous_hash: string;
        previous_path: string;
        previous_size: number;
        next_hash: string;
        created_by: string;
      }>(
        "select previous_hash,previous_path,previous_size,next_hash,created_by from video_preview_changes",
      )
    ).rows;
    assert.deepEqual(first, [
      {
        previous_hash: f.a,
        previous_path: f.object(f.a),
        previous_size: 1000,
        next_hash: f.b,
        created_by: adminId,
      },
    ]);
    await f.upload(f.c);
    await assert.rejects(
      f.replace(crypto.randomUUID(), f.a, f.c),
      /saved preview changed/,
    );
    await f.replace(crypto.randomUUID(), f.b, f.c);
    await f.replace(request);
    assert.equal((await f.current()).sha256, f.c);
    await assert.rejects(f.replace(request, f.a, f.c), /already saved/);
    assert.equal(
      (
        await f.db.query<{ n: number }>(
          "select count(*)::int n from portal_admin_events where file_id=$1 and kind='video_preview_replaced'",
          [f.file],
        )
      ).rows[0].n,
      2,
    );
    await f.db.query(
      "delete from storage.objects where bucket_id='horse-video-previews'",
    );
    assert.equal(
      (
        await f.db.query<{ n: number }>(
          "select count(*)::int n from storage.objects where bucket_id='horse-video-previews'",
        )
      ).rows[0].n,
      3,
    );
    await assert.rejects(
      f.db.query("delete from video_preview_changes"),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("update horse_video_previews set sha256=$1 where file_id=$2", [
        f.a,
        f.file,
      ]),
      /permission denied/,
    );
    const parent = (
      await f.db.query<{
        object_path: string;
        size_bytes: number;
        published_at: string | null;
      }>(
        "select object_path,size_bytes,published_at from horse_files where id=$1",
        [f.file],
      )
    ).rows[0];
    assert.deepEqual(parent, {
      object_path: f.path,
      size_bytes: 10000,
      published_at: null,
    });
    await f.db.query("select change_horse_file($1,'archive','Keep original')", [
      f.file,
    ]);
    await assert.rejects(
      f.replace(crypto.randomUUID(), f.c, f.b),
      /active saved video/,
    );
    await f.replace(request);
    assert.equal((await f.current()).sha256, f.c);
  } finally {
    await f.db.close();
  }
});
test("replacement previews inherit publication and manual customer grants while historical previews and change records stay private", async () => {
  const f = await fixture();
  try {
    await f.db.exec("reset role");
    await f.db.query(
      "update auth.users set email='thumbnail@example.com' where id=$1",
      [outsiderId],
    );
    await login(f.db, adminId);
    const customer = (
      await f.db.query<{ id: string }>(
        "insert into customers(name) values('Thumbnail customer') returning id",
      )
    ).rows[0].id;
    await f.db.query(
      "select grant_customer_portal($1,$2,'thumbnail@example.com','Existing account')",
      [crypto.randomUUID(), customer],
    );
    await f.db.query(
      "select set_customer_horse_access($1,$2,$3,null,true,'Manual grant')",
      [crypto.randomUUID(), customer, f.horse],
    );
    await f.db.query(
      "select change_horse_file($1,'publish','Reviewed video')",
      [f.file],
    );
    await f.upload(f.b);
    await f.replace(crypto.randomUUID());
    await login(f.db, outsiderId);
    assert.equal(
      (
        await f.db.query<{ p: string }>("select portal_video_preview($1) p", [
          f.file,
        ])
      ).rows[0].p,
      f.object(f.b),
    );
    const visible = (
      await f.db.query<{ name: string }>(
        "select name from storage.objects where bucket_id='horse-video-previews'",
      )
    ).rows;
    assert.deepEqual(visible, [{ name: f.object(f.b) }]);
    assert.equal(
      (await f.db.query("select * from video_preview_changes")).rows.length,
      0,
    );
    const files = (
      await f.db.query<{
        r: { rows: { id: string; preview_version: string }[] };
      }>("select portal_files(null,1) r")
    ).rows[0].r;
    assert.equal(files.rows.find((v) => v.id === f.file)?.preview_version, f.b);
    await assert.rejects(
      f.replace(crypto.randomUUID(), f.b, f.a),
      /Administrator/,
    );
    await login(f.db, adminId);
    await f.db.query(
      "select change_horse_file($1,'unpublish','Private again')",
      [f.file],
    );
    await login(f.db, outsiderId);
    assert.equal(
      (
        await f.db.query<{ p: string | null }>(
          "select portal_video_preview($1) p",
          [f.file],
        )
      ).rows[0].p,
      null,
    );
    await login(f.db, adminId);
    await f.db.query("select change_horse_file($1,'publish','Share again')", [
      f.file,
    ]);
    await f.db.query(
      "select set_customer_horse_access($1,$2,$3,null,false,'Revoke')",
      [crypto.randomUUID(), customer, f.horse],
    );
    await login(f.db, outsiderId);
    assert.equal(
      (
        await f.db.query(
          "select * from storage.objects where bucket_id='horse-video-previews'",
        )
      ).rows.length,
      0,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(
      f.replace(crypto.randomUUID(), f.b, f.a),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});
