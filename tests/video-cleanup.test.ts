import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupAbandonedVideos } from "../src/lib/video-cleanup.ts";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
const horse = "10000000-0000-4000-8000-000000000001",
  id = "20000000-0000-4000-8000-000000000001";
const row = {
  id,
  horse_id: horse,
  path: `${horse}/${id}.mp4`,
  content_type: "video/mp4",
};
test("cleanup deletes only exact prepared paths, records confirmed success and retains failures for retry", async () => {
  const records: unknown[] = [];
  assert.deepEqual(
    await cleanupAbandonedVideos({
      claim: async () => [row],
      remove: async (path) => {
        assert.equal(path, row.path);
        return true;
      },
      record: async (...args) => {
        records.push(args);
      },
    }),
    { deleted: 1, failed: 0 },
  );
  assert.deepEqual(records, [[id, true]]);
  assert.deepEqual(
    await cleanupAbandonedVideos({
      claim: async () => [row],
      remove: async () => {
        throw Error("network");
      },
      record: async (...args) => {
        records.push(args);
      },
    }),
    { deleted: 0, failed: 1 },
  );
  assert.deepEqual(records[1], [id, false]);
  for (const path of ["other.mp4", `../${id}.mp4`])
    await assert.rejects(
      cleanupAbandonedVideos({
        claim: async () => [{ ...row, path }],
        remove: async () => {
          throw Error("must not run");
        },
        record: async () => {
          throw Error("must not run");
        },
      }),
      /Invalid cleanup path/,
    );
});
test("cleanup freezes only 30-day set-aside uploads, waits 48 hours, protects restore/attachment, retains completion and denies customer workers", async () => {
  const db = await inventoryDatabase();
  try {
    const h = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Cleanup horse') returning id",
      )
    ).rows[0].id;
    const ids = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    for (const upload of ids)
      await db.query(
        "select prepare_horse_video_transfer($1,$2,'Clip','clip.mp4','video/mp4',10000,$3)",
        [upload, h, "a".repeat(64)],
      );
    for (const upload of ids.slice(0, 2))
      await db.query(
        "select change_horse_video_upload($1,$2,0,'abandon','No longer needed')",
        [crypto.randomUUID(), upload],
      );
    await assert.rejects(
      db.query("select claim_abandoned_video_cleanup()"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query(
      "update horse_video_uploads set abandoned_at=now()-interval '31 days' where id=$1",
      [ids[0]],
    );
    // Even an inconsistent historical set-aside record is protected by its saved-file path.
    await db.query(
      "insert into horse_files(id,horse_id,kind,title,file_name,object_path,content_type,size_bytes) select id,horse_id,'video',title,file_name,object_path,content_type,size_bytes from horse_video_uploads where id=$1",
      [ids[3]],
    );
    await db.query(
      "update horse_video_uploads set abandoned_at=now()-interval '31 days',abandoned_by=created_by,abandoned_reason='Historical record' where id=$1",
      [ids[3]],
    );
    assert.deepEqual(
      (
        await db.query<{ r: unknown[] }>(
          "select claim_abandoned_video_cleanup() r",
        )
      ).rows[0].r,
      [],
    );
    const rows = (
      await db.query<{ id: string; cleanup_started_at: string | null }>(
        "select id,cleanup_started_at from horse_video_uploads",
      )
    ).rows;
    assert.ok(rows.find((x) => x.id === ids[0])!.cleanup_started_at);
    assert.equal(rows.find((x) => x.id === ids[1])!.cleanup_started_at, null);
    assert.equal(rows.find((x) => x.id === ids[2])!.cleanup_started_at, null);
    await assert.rejects(
      db.query(
        "update horse_video_uploads set abandoned_at=null,abandoned_by=null,abandoned_reason=null where id=$1",
        [ids[0]],
      ),
      /permanent cleanup/,
    );
    await assert.rejects(
      db.query(
        "insert into horse_files(id,horse_id,kind,title,file_name,object_path,content_type,size_bytes) select id,horse_id,'video',title,file_name,object_path,content_type,size_bytes from horse_video_uploads where id=$1",
        [ids[0]],
      ),
      /permanent cleanup/,
    );
    await db.query(
      "update horse_video_uploads set cleanup_started_at=now()-interval '49 hours' where id=$1",
      [ids[0]],
    );
    const candidates = (
      await db.query<{ r: { id: string }[] }>(
        "select claim_abandoned_video_cleanup() r",
      )
    ).rows[0].r;
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, ids[0]);
    await db.query("select record_abandoned_video_cleanup($1,false)", [ids[0]]);
    assert.equal(
      (
        await db.query<{ r: unknown[] }>(
          "select claim_abandoned_video_cleanup() r",
        )
      ).rows[0].r.length,
      1,
    );
    await db.query("select record_abandoned_video_cleanup($1,true)", [ids[0]]);
    await db.query("select record_abandoned_video_cleanup($1,true)", [ids[0]]);
    assert.equal(
      (
        await db.query<{ r: unknown[] }>(
          "select claim_abandoned_video_cleanup() r",
        )
      ).rows[0].r.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ cleanup_attempts: number }>(
          "select cleanup_attempts from horse_video_uploads where id=$1",
          [ids[0]],
        )
      ).rows[0].cleanup_attempts,
      2,
    );
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select claim_abandoned_video_cleanup()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
