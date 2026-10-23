import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";

export const adminId = "20000000-0000-4000-8000-000000000001";
export const outsiderId = "20000000-0000-4000-8000-000000000002";
export async function inventoryDatabase(through?: string) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb);
    alter table storage.objects enable row level security;
    grant usage on schema auth,public,storage to authenticated,anon;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory))
    .filter((f) => f.endsWith(".sql") && (!through || f <= through))
    .sort())
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [
    adminId,
    outsiderId,
  ]);
  await db.query("insert into public.admin_users(user_id) values($1)", [
    adminId,
  ]);
  await login(db, adminId);
  return db;
}
export async function login(db: PGlite, user: string) {
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}
