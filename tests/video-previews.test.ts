import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previewDimensions,
  validateVideoPreview,
  videoPreviewLimit,
} from "../src/lib/video-preview.ts";
import { generateVideoPreview } from "../src/lib/generate-video-preview.ts";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
function jpeg(width: number, height: number) {
  return new Uint8Array([
    255,
    216,
    255,
    192,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    17,
    0,
    255,
    217,
  ]);
}
test("generated preview dimensions preserve portrait/landscape proportions and bound accepted JPEGs", () => {
  assert.deepEqual(previewDimensions(1920, 1080), { width: 640, height: 360 });
  assert.deepEqual(previewDimensions(1080, 1920), { width: 360, height: 640 });
  assert.deepEqual(previewDimensions(320, 180), { width: 320, height: 180 });
  for (const value of [0, -1, NaN, Infinity, 40000])
    assert.throws(() => previewDimensions(value, 1080));
  assert.deepEqual(validateVideoPreview(jpeg(640, 360)), {
    width: 640,
    height: 360,
  });
  for (const bytes of [
    jpeg(641, 360),
    jpeg(0, 360),
    new Uint8Array([255, 216, 255, 217]),
    new Uint8Array(videoPreviewLimit + 1),
    jpeg(640, 360).slice(0, -1),
  ])
    assert.throws(() => validateVideoPreview(bytes));
});
test("local frame generation waits for a decoded frame, cleans resources and handles errors or cancellation without uploading", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  let loads = 0,
    paused = 0,
    drawn = 0,
    cleared = 0;
  const video = {
    videoWidth: 1920,
    videoHeight: 1080,
    duration: 10,
    currentTime: 0,
    readyState: 2,
    seeking: false,
    src: "",
    muted: false,
    playsInline: false,
    preload: "",
    onloadedmetadata: null as null | (() => void),
    onloadeddata: null as null | (() => void),
    onseeked: null as null | (() => void),
    onerror: null as null | (() => void),
    pause: () => paused++,
    removeAttribute: () => cleared++,
    load: () => loads++,
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => drawn++ }),
    toBlob: (callback: (blob: Blob | null) => void) =>
      callback(new Blob([jpeg(640, 360)], { type: "image/jpeg" })),
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (name: string) => (name === "video" ? video : canvas),
    },
  });
  try {
    const pending = generateVideoPreview(new Blob(["local-video"]));
    video.onloadedmetadata!();
    assert.equal(video.currentTime, 1);
    video.seeking = true;
    video.onloadeddata!();
    assert.equal(drawn, 0);
    video.seeking = false;
    video.onseeked!();
    const image = await pending;
    assert.equal(image.type, "image/jpeg");
    assert.equal(drawn, 1);
    assert.equal(paused, 1);
    assert.equal(cleared, 1);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    assert.equal(video.onseeked, null);

    const custom = generateVideoPreview(new Blob(["video"]), undefined, 3.5);
    video.onloadedmetadata!();
    assert.equal(video.currentTime, 3.5);
    video.onseeked!();
    await custom;
    const outside = generateVideoPreview(new Blob(["video"]), undefined, 10);
    video.onloadedmetadata!();
    await assert.rejects(outside, /before the end/);
    await assert.rejects(
      generateVideoPreview(new Blob(), undefined, -1),
      /frame time/,
    );
    await assert.rejects(
      generateVideoPreview(new Blob(), undefined, Infinity),
      /frame time/,
    );
    assert.equal(loads, 6);
    assert.equal(paused, 3);
    const controller = new AbortController();
    const cancelled = generateVideoPreview(
      new Blob(["local-video"]),
      controller.signal,
    );
    controller.abort();
    await assert.rejects(cancelled, /cancelled/);
    assert.equal(paused, 4);
    const unsupported = generateVideoPreview(new Blob(["unsupported"]));
    video.onerror!();
    await assert.rejects(unsupported, /cannot decode/);
    assert.equal(paused, 5);
    assert.equal(loads, 10);
    const stalled = generateVideoPreview(new Blob(["stalled"]));
    const rejection = assert.rejects(stalled, /in time/);
    t.mock.timers.tick(8000);
    await rejection;
    assert.equal(paused, 6);
    assert.equal(loads, 12);
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    await assert.rejects(
      generateVideoPreview(new Blob(["cancelled"]), alreadyCancelled.signal),
      /cancelled/,
    );
    assert.equal(paused, 6);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
async function fixture() {
  const db = await inventoryDatabase();
  const horse = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Preview horse') returning id",
    )
  ).rows[0].id;
  const file = crypto.randomUUID();
  const path = (
    await db.query<{ p: string }>(
      "select prepare_horse_video($1,$2,'Training clip','clip.mp4','video/mp4',10000) p",
      [file, horse],
    )
  ).rows[0].p;
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata) values('horse-videos',$1,$2)",
    [path, { size: 10000, mimetype: "video/mp4" }],
  );
  await db.query("select finish_horse_video($1)", [file]);
  return { db, horse, file };
}
test("preview attachment verifies the saved video and matching storage metadata, retains one immutable preview/audit and protects referenced objects", async () => {
  const { db, horse, file } = await fixture();
  try {
    const hash = "a".repeat(64),
      path = `${horse}/${file}/${hash}.jpg`;
    await assert.rejects(
      db.query("select attach_video_preview($1,$2,1000)", [file, hash]),
      /matching JPEG/,
    );
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('horse-video-previews',$1,$2)",
      [path, { size: 999, mimetype: "image/jpeg" }],
    );
    await assert.rejects(
      db.query("select attach_video_preview($1,$2,1000)", [file, hash]),
      /matching JPEG/,
    );
    await db.exec("reset role");
    await db.query("update storage.objects set metadata=$1 where name=$2", [
      { size: 1000, mimetype: "image/jpeg" },
      path,
    ]);
    await login(db, adminId);
    const photo = crypto.randomUUID();
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('horse-files',$1,$2)",
      [`${horse}/${photo}.jpg`, { size: 1000, mimetype: "image/jpeg" }],
    );
    await db.query(
      "select attach_horse_file($1,$2,'photo','Photo','photo.jpg',$3,'image/jpeg',1000)",
      [photo, horse, `${horse}/${photo}.jpg`],
    );
    await assert.rejects(
      db.query("select attach_video_preview($1,$2,1000)", [photo, hash]),
      /active saved video/,
    );
    await db.query("select attach_video_preview($1,$2,1000)", [file, hash]);
    await db.query("select attach_video_preview($1,$2,1000)", [file, hash]);
    await assert.rejects(
      db.query("select attach_video_preview($1,$2,1000)", [
        file,
        "b".repeat(64),
      ]),
      /already saved/,
    );
    assert.equal(
      (
        await db.query("select * from horse_video_previews where file_id=$1", [
          file,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from portal_admin_events where file_id=$1 and kind='video_preview_attached'",
          [file],
        )
      ).rows.length,
      1,
    );
    await db.query(
      "delete from storage.objects where bucket_id='horse-video-previews' and name=$1",
      [path],
    );
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='horse-video-previews' and name=$1",
          [path],
        )
      ).rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name,metadata) values('horse-video-previews','wrong/file.jpg','{}')",
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.query("delete from horse_video_previews where file_id=$1", [file]),
      /permission denied/,
    );
    await db.query("select change_horse_file($1,'archive','Retain original')", [
      file,
    ]);
    await assert.rejects(
      db.query("select attach_video_preview($1,$2,1000)", [file, hash]),
      /active saved video/,
    );
  } finally {
    await db.close();
  }
});
test("preview publication, visibility bounds and revocation mirror the parent video while metadata stays administrator-only", async () => {
  const { db, horse, file } = await fixture();
  try {
    const hash = "c".repeat(64),
      path = `${horse}/${file}/${hash}.jpg`;
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('horse-video-previews',$1,$2)",
      [path, { size: 1000, mimetype: "image/jpeg" }],
    );
    await db.query("select attach_video_preview($1,$2,1000)", [file, hash]);
    await db.exec("reset role");
    await db.query(
      "update auth.users set email='preview@example.com' where id=$1",
      [outsiderId],
    );
    await login(db, adminId);
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Preview customer') returning id",
      )
    ).rows[0].id;
    await db.query(
      "select grant_customer_portal($1,$2,'preview@example.com','Customer access')",
      [crypto.randomUUID(), customer],
    );
    await db.query(
      "select set_customer_horse_access($1,$2,$3,null,true,'Manual horse grant')",
      [crypto.randomUUID(), customer, horse],
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query<{ p: null }>("select portal_video_preview($1) p", [file]))
        .rows[0].p,
      null,
    );
    assert.equal(
      (await db.query("select * from horse_video_previews")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='horse-video-previews'",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select attach_video_preview($1,$2,1000)", [file, hash]),
      /Administrator/,
    );
    await login(db, adminId);
    await db.query("select change_horse_file($1,'publish','Reviewed clip')", [
      file,
    ]);
    await login(db, outsiderId);
    assert.equal(
      (
        await db.query<{ p: string }>("select portal_video_preview($1) p", [
          file,
        ])
      ).rows[0].p,
      path,
    );
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='horse-video-previews'",
        )
      ).rows.length,
      1,
    );
    const list = (
      await db.query<{ r: { rows: { has_preview: boolean }[] } }>(
        "select portal_files(null,1) r",
      )
    ).rows[0].r;
    assert.equal(list.rows[0].has_preview, true);
    await login(db, adminId);
    await db.query(
      "select set_customer_horse_access($1,$2,$3,(now() at time zone 'America/Chicago')::date+1,true,'Future visibility')",
      [crypto.randomUUID(), customer, horse],
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query<{ p: null }>("select portal_video_preview($1) p", [file]))
        .rows[0].p,
      null,
    );
    await login(db, adminId);
    await db.query(
      "select set_customer_horse_access($1,$2,$3,null,true,'Review all published clips')",
      [crypto.randomUUID(), customer, horse],
    );
    await db.query(
      "select change_horse_file($1,'unpublish','Remove shared clip')",
      [file],
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query<{ p: null }>("select portal_video_preview($1) p", [file]))
        .rows[0].p,
      null,
    );
    await login(db, adminId);
    await db.query("select change_horse_file($1,'publish','Republish')", [
      file,
    ]);
    await db.query(
      "select set_customer_horse_access($1,$2,$3,null,false,'Revoke horse access')",
      [crypto.randomUUID(), customer, horse],
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query<{ p: null }>("select portal_video_preview($1) p", [file]))
        .rows[0].p,
      null,
    );
    assert.equal(
      (
        await db.query(
          "select * from storage.objects where bucket_id='horse-video-previews'",
        )
      ).rows.length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select portal_video_preview($1)", [file]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
