import { test } from "node:test";
import assert from "node:assert/strict";
import {
  videoType,
  videoSize,
  videoLimit,
  resumableEndpoint,
} from "../src/lib/horse-video.ts";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
function header(brand: string) {
  const b = new Uint8Array(24);
  new DataView(b.buffer).setUint32(0, 24);
  for (const [offset, s] of [
    [4, "ftyp"],
    [8, brand],
    [16, brand],
  ] as const)
    for (let n = 0; n < s.length; n++) b[offset + n] = s.charCodeAt(n);
  return b;
}
test("video headers and upload bounds distinguish supported containers and storage endpoints", () => {
  assert.equal(videoType(header("isom")).mime, "video/mp4");
  assert.equal(videoType(header("qt  ")).extension, "mov");
  assert.throws(() => videoType(header("heic")));
  const webm = new Uint8Array([
    0x1a,
    0x45,
    0xdf,
    0xa3,
    ...new TextEncoder().encode("doctypewebm"),
  ]);
  assert.equal(videoType(webm).mime, "video/webm");
  assert.throws(() => videoType(new Uint8Array([1, 2, 3])));
  assert.equal(videoSize(videoLimit), videoLimit);
  for (const n of [0, -1, videoLimit + 1, 1.5])
    assert.throws(() => videoSize(n));
  assert.equal(
    resumableEndpoint("https://example.supabase.co"),
    "https://example.storage.supabase.co/storage/v1/upload/resumable",
  );
  assert.equal(
    resumableEndpoint("http://localhost:54321"),
    "http://localhost:54321/storage/v1/upload/resumable",
  );
  assert.throws(() => resumableEndpoint("https://user:secret@example.com"));
  assert.throws(() => resumableEndpoint("https://example.com/path"));
});
test("videos attach only after verified storage metadata, remain private and follow manual portal access", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='customer@example.com' where id=$1",
      [outsiderId],
    );
    await login(db, adminId);
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Customer') returning id",
      )
    ).rows[0].id;
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Horse') returning id",
      )
    ).rows[0].id;
    await db.query(
      "select grant_customer_portal($1,$2,'customer@example.com','Existing customer account')",
      [crypto.randomUUID(), customer],
    );
    await db.query(
      "select set_customer_horse_access($1,$2,$3,null,true,'Manual horse access')",
      [crypto.randomUUID(), customer, horse],
    );
    const id = crypto.randomUUID();
    const path = (
      await db.query<{ p: string }>(
        "select prepare_horse_video($1,$2,'Training clip','clip.mp4','video/mp4',10000) p",
        [id, horse],
      )
    ).rows[0].p;
    assert.equal(
      (
        await db.query<{ p: string }>(
          "select prepare_horse_video($1,$2,'Training clip','clip.mp4','video/mp4',10000) p",
          [id, horse],
        )
      ).rows[0].p,
      path,
    );
    await assert.rejects(
      db.query(
        "select prepare_horse_video($1,$2,'Different clip','clip.mp4','video/mp4',10000)",
        [id, horse],
      ),
      /different details/,
    );
    await assert.rejects(
      db.query("select finish_horse_video($1)", [id]),
      /Complete the video upload/,
    );
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('horse-videos',$1,$2)",
      [path, { size: 9000, mimetype: "video/mp4" }],
    );
    await assert.rejects(
      db.query("select finish_horse_video($1)", [id]),
      /does not match/,
    );
    await db.exec("reset role");
    await db.query("update storage.objects set metadata=$1 where name=$2", [
      { size: 10000, mimetype: "video/mp4" },
      path,
    ]);
    await login(db, adminId);
    await db.query("select finish_horse_video($1)", [id]);
    await db.query("select finish_horse_video($1)", [id]);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from horse_files where id=$1",
          [id],
        )
      ).rows[0].n,
      1,
    );
    await login(db, outsiderId);
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='horse-videos'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query<{ r: null }>("select portal_file($1) r", [id])).rows[0].r,
      null,
    );
    await assert.rejects(
      db.query(
        "select prepare_horse_video($1,$2,'Unauthorized','clip.mp4','video/mp4',10000)",
        [crypto.randomUUID(), horse],
      ),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select finish_horse_video($1)", [id]),
      /Administrator/,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values('horse-videos','forbidden.mp4')",
      ),
      /row-level security/,
    );
    await login(db, adminId);
    await db.query(
      "select change_horse_file($1,'publish','Reviewed customer clip')",
      [id],
    );
    await login(db, outsiderId);
    const file = (
      await db.query<{ r: { kind: string; path: string } }>(
        "select portal_file($1) r",
        [id],
      )
    ).rows[0].r;
    assert.equal(file.kind, "video");
    assert.equal(file.path, path);
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='horse-videos'",
        )
      ).rows.length,
      1,
    );
    await login(db, adminId);
    await db.query(
      "select set_customer_horse_access($1,$2,$3,null,false,'Access revoked')",
      [crypto.randomUUID(), customer, horse],
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query<{ r: null }>("select portal_file($1) r", [id])).rows[0].r,
      null,
    );
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='horse-videos'",
        )
      ).rows.length,
      0,
    );
    await login(db, adminId);
    await assert.rejects(
      db.query(
        "select prepare_horse_video($1,$2,'Too large','clip.mp4','video/mp4',52428801)",
        [crypto.randomUUID(), horse],
      ),
      /50 MB/,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from portal_admin_events where file_id=$1 and kind='file_attached'",
          [id],
        )
      ).rows[0].n,
      1,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select finish_horse_video($1)", [id]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
