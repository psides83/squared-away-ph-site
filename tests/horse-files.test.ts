import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
const id = (n: number) =>
  `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ca = id(1),
  cb = id(2),
  ha = id(3),
  hb = id(4),
  ua = id(5),
  ub = id(6),
  photo = id(7),
  document = id(8),
  other = id(9);
test("horse files remain private until explicitly published and respect customer/storage access", async (t) => {
  const db = await inventoryDatabase();
  try {
    await db.exec(`reset role;
      insert into auth.users(id,email) values('${ua}','files-a@example.com'),('${ub}','files-b@example.com');
      insert into public.customers(id,name) values('${ca}','Files A'),('${cb}','Files B');
      insert into public.horses(id,barn_name) values('${ha}','Shared files horse'),('${hb}','Other horse');
    `);
    await login(db, adminId);
    for (const [customer, email] of [
      [ca, "files-a@example.com"],
      [cb, "files-b@example.com"],
    ]) {
      await db.query(
        "select public.grant_customer_portal($1,$2,$3,'Files access')",
        [crypto.randomUUID(), customer, email],
      );
      await db.query(
        "select public.set_customer_horse_access($1,$2,$3,null,true,'Manual files grant')",
        [crypto.randomUUID(), customer, ha],
      );
    }
    const path = (horse: string, file: string, ext = "png") =>
      `${horse}/${file}.${ext}`;
    const attach = async (
      file: string,
      horse: string,
      kind = "photo",
      type = "image/png",
      ext = "png",
    ) => {
      await db.query(
        "insert into storage.objects(bucket_id,name) values('horse-files',$1)",
        [path(horse, file, ext)],
      );
      return db.query(
        "select public.attach_horse_file($1,$2,$3,'Reviewed horse file',$4,$5,$6,100)",
        [file, horse, kind, `horse.${ext}`, path(horse, file, ext), type],
      );
    };
    const change = async (file: string, action: string) =>
      db.query(
        "select public.change_horse_file($1,$2,'Reviewed file sharing')",
        [file, action],
      );
    const files = async (horse: string | null = null) =>
      (
        await db.query<{ r: any }>("select public.portal_files($1,1) r", [
          horse,
        ])
      ).rows[0].r;
    const read = async (file: string) =>
      (await db.query<{ r: any }>("select public.portal_file($1) r", [file]))
        .rows[0].r;
    const objects = async () =>
      (
        await db.query(
          "select name from storage.objects where bucket_id='horse-files'",
        )
      ).rows;
    await t.test(
      "uploads attach as private; metadata and objects stay hidden from customers",
      async () => {
        await attach(photo, ha);
        await attach(document, ha, "document", "application/pdf", "pdf");
        await attach(other, hb);
        await change(other, "publish");
        await db.query(
          "select public.attach_horse_file($1,$2,'photo','Reviewed horse file','horse.png',$3,'image/png',100)",
          [photo, ha, path(ha, photo)],
        );
        assert.equal(
          (await db.query("select * from public.horse_files")).rows.length,
          3,
        );
        await assert.rejects(
          db.query(
            "select public.attach_horse_file($1,$2,'photo','Bad','x.png','wrong-path','image/png',100)",
            [crypto.randomUUID(), ha],
          ),
          /Invalid horse file path/,
        );
        await login(db, ua);
        assert.equal((await files()).total, 0);
        assert.equal(await read(photo), null);
        assert.equal((await objects()).length, 0);
        assert.equal(
          (await db.query("select * from public.horse_files")).rows.length,
          0,
        );
        await login(db, adminId);
      },
    );
    await t.test(
      "published photos/documents are shared only with granted co-owners and matching storage paths",
      async () => {
        await change(photo, "publish");
        await change(document, "publish");
        await login(db, ua);
        const list = await files();
        assert.equal(list.total, 2);
        assert.ok(!JSON.stringify(list).includes("object_path"));
        assert.ok(list.rows.some((r: any) => r.kind === "document"));
        assert.equal((await files(hb)).total, 0);
        assert.equal(await read(other), null);
        assert.equal((await read(photo)).path, path(ha, photo));
        assert.equal((await objects()).length, 2);
        await assert.rejects(
          db.query(
            "insert into storage.objects(bucket_id,name) values('horse-files',$1)",
            [path(ha, crypto.randomUUID())],
          ),
          /row-level security/,
        );
        await login(db, ub);
        assert.equal((await files()).total, 2);
        await login(db, adminId);
      },
    );
    await t.test(
      "publication date bounds, horse revocation, and account disable stop fresh file access",
      async () => {
        const tomorrow = (
          await db.query<{ d: string }>(
            "select to_char((now() at time zone 'America/Chicago')::date+1,'YYYY-MM-DD') d",
          )
        ).rows[0].d;
        await db.query(
          "select public.set_customer_horse_access($1,$2,$3,$4,true,'Date bound')",
          [crypto.randomUUID(), ca, ha, tomorrow],
        );
        await login(db, ua);
        assert.equal((await files()).total, 0);
        assert.equal(await read(photo), null);
        assert.equal((await objects()).length, 0);
        await login(db, adminId);
        await db.query(
          "select public.set_customer_horse_access($1,$2,$3,null,false,'Revoke')",
          [crypto.randomUUID(), ca, ha],
        );
        await login(db, ua);
        assert.equal(await read(photo), null);
        await login(db, adminId);
        await db.query(
          "select public.set_customer_horse_access($1,$2,$3,null,true,'Restore')",
          [crypto.randomUUID(), ca, ha],
        );
        await db.query("select public.disable_customer_portal($1,'Disable')", [
          ca,
        ]);
        await login(db, ua);
        await assert.rejects(files(), /Customer portal access/);
        assert.equal((await objects()).length, 0);
        await login(db, adminId);
      },
    );
    await t.test(
      "unpublishing/archiving revoke storage access and retain owner files/history",
      async () => {
        await assert.rejects(
          db.query("select public.rename_horse_file($1,'New title','Review')", [
            photo,
          ]),
          /Unpublish/,
        );
        await change(photo, "unpublish");
        await db.query(
          "select public.rename_horse_file($1,'New title','Review')",
          [photo],
        );
        await login(db, ub);
        assert.equal((await files()).total, 1);
        assert.equal(await read(photo), null);
        assert.equal((await objects()).length, 1);
        await login(db, adminId);
        await change(document, "archive");
        await assert.rejects(change(document, "publish"), /Archived/);
        await login(db, ub);
        assert.equal((await files()).total, 0);
        assert.equal((await objects()).length, 0);
        await login(db, adminId);
        assert.equal((await objects()).length, 3);
        assert.equal(
          (await db.query("select * from public.horse_files")).rows.length,
          3,
        );
        assert.ok(
          (
            await db.query(
              "select * from public.portal_admin_events where file_id is not null",
            )
          ).rows.length >= 7,
        );
      },
    );
    await t.test(
      "non-admin mutations and anonymous/outsider reads cannot bypass file permissions",
      async () => {
        await login(db, ub);
        await assert.rejects(change(photo, "publish"), /Administrator access/);
        await assert.rejects(
          db.exec("update public.horse_files set published_at=now()"),
          /permission denied/,
        );
        await login(db, outsiderId);
        await assert.rejects(files(), /Customer portal access/);
        assert.equal((await objects()).length, 0);
        await db.exec("reset role;set role anon");
        await assert.rejects(
          db.exec("select public.portal_files()"),
          /permission denied/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
