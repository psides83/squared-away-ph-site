import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { customerIdentifiers } from "../src/lib/validation.ts";

const owner = "10000000-0000-4000-8000-000000000001";
const otherOwner = "10000000-0000-4000-8000-000000000002";
const rejectedOwner = "10000000-0000-4000-8000-000000000003";
const admin = "20000000-0000-4000-8000-000000000001";
const otherUser = "20000000-0000-4000-8000-000000000002";

test("horse form requires valid customer selections and handles shared ownership", () => {
  assert.throws(
    () => customerIdentifiers(new FormData()),
    /at least one customer/,
  );
  const form = new FormData();
  form.append("customer_ids", owner);
  form.append("customer_ids", otherOwner);
  form.append("customer_ids", owner);
  assert.deepEqual(customerIdentifiers(form), [owner, otherOwner]);
  form.append("customer_ids", "invalid");
  assert.throws(() => customerIdentifiers(form), /valid record/);
});

test("horse/customer migration and sales workflow", async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    // Reproduce Supabase's auth roles and JWT subject for local PostgreSQL tests.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
    `);
    for (const name of [
      "20261021000100_admin_foundation.sql",
      "20261021000200_horse_customer_save.sql",
      "20261021000300_training_log.sql",
      "20261021000400_business_settings.sql",
    ]) {
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    }
    await db.query("insert into auth.users(id) values ($1), ($2)", [
      admin,
      otherUser,
    ]);
    await db.query("insert into public.admin_users(user_id) values ($1)", [
      admin,
    ]);
    await db.query(
      "insert into public.customers(id, name) values ($1, 'Original owner'), ($2, 'New owner'), ($3, 'Rejected link')",
      [owner, otherOwner, rejectedOwner],
    );
    // A late failure verifies that the whole RPC rolls back, not just validation.
    await db.exec(`
      create function public.test_reject_link() returns trigger language plpgsql as $$
      begin
        if new.customer_id::text = current_setting('test.reject_customer', true) then
          raise exception 'Simulated relationship failure';
        end if;
        return new;
      end; $$;
      create trigger test_reject_link before insert on public.horse_customers
        for each row execute function public.test_reject_link();
      set role authenticated;
    `);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      admin,
    ]);
    const save = async (
      name: string,
      customers: string[] | null,
      id: string | null = null,
    ) => {
      const result = await db.query<{ id: string }>(
        "select public.save_horse_with_customers($1::jsonb, $2::uuid[], $3::uuid) as id",
        [
          JSON.stringify({ barn_name: name, sex: "gelding" }),
          customers === null ? null : `{${customers.join(",")}}`,
          id,
        ],
      );
      return result.rows[0].id;
    };
    let horseId = "";
    await t.test(
      "creates a horse and links multiple customers without duplicate relationships",
      async () => {
        horseId = await save("Dusty", [owner, otherOwner, owner]);
        const links = await db.query(
          "select customer_id from public.horse_customers where horse_id = $1 order by customer_id",
          [horseId],
        );
        assert.deepEqual(links.rows, [
          { customer_id: owner },
          { customer_id: otherOwner },
        ]);
      },
    );
    await t.test(
      "a sale replaces the customer links while preserving the horse and billing history",
      async () => {
        await db.query(
          "insert into public.training_stays(horse_id, billing_customer_id, arrival_date, monthly_rate_cents) values ($1, $2, '2026-01-01', 125000)",
          [horseId, owner],
        );
        assert.equal(
          await save("Dusty after sale", [otherOwner], horseId),
          horseId,
        );
        const links = await db.query(
          "select customer_id from public.horse_customers where horse_id = $1",
          [horseId],
        );
        assert.deepEqual(links.rows, [{ customer_id: otherOwner }]);
        const history = await db.query(
          "select billing_customer_id, monthly_rate_cents from public.training_stays where horse_id = $1",
          [horseId],
        );
        assert.deepEqual(history.rows, [
          { billing_customer_id: owner, monthly_rate_cents: 125000 },
        ]);
      },
    );
    await t.test(
      "missing or nonexistent customers cannot create an unlinked horse",
      async () => {
        const before = await db.query("select count(*) from public.horses");
        for (const ids of [[], null, ["30000000-0000-4000-8000-000000000001"]])
          await assert.rejects(save("Invalid", ids));
        assert.deepEqual(
          (await db.query("select count(*) from public.horses")).rows,
          before.rows,
        );
      },
    );
    await t.test(
      "a failed relationship insert rolls back profile changes and previous customer links",
      async () => {
        await db.query("select set_config('test.reject_customer', $1, false)", [
          rejectedOwner,
        ]);
        await assert.rejects(
          save("Should roll back", [rejectedOwner], horseId),
          /Simulated relationship failure/,
        );
        assert.deepEqual(
          (
            await db.query(
              "select barn_name from public.horses where id = $1",
              [horseId],
            )
          ).rows,
          [{ barn_name: "Dusty after sale" }],
        );
        assert.deepEqual(
          (
            await db.query(
              "select customer_id from public.horse_customers where horse_id = $1",
              [horseId],
            )
          ).rows,
          [{ customer_id: otherOwner }],
        );
        await assert.rejects(
          save("New horse should roll back", [rejectedOwner]),
          /Simulated relationship failure/,
        );
        assert.deepEqual(
          (await db.query("select count(*) from public.horses")).rows,
          [{ count: 1 }],
        );
        await db.query("select set_config('test.reject_customer', '', false)");
      },
    );
    await t.test(
      "training entries support sessions, notes, edits, deletion, and retained horse history",
      async () => {
        const result = await db.query<{ id: string }>(
          "insert into public.training_entries(horse_id, kind, entry_date, title, notes, duration_minutes) values ($1, 'session', '2026-10-21', 'Rating cattle', 'Stayed quiet. Work on the stop next time.', 40) returning id",
          [horseId],
        );
        const sessionId = result.rows[0].id;
        const note = await db.query<{ id: string }>(
          "insert into public.training_entries(horse_id, kind, entry_date, title, notes) values ($1, 'note', '2026-10-21', 'Progress', 'More confidence this week.') returning id",
          [horseId],
        );
        await db.query(
          "update public.training_entries set notes = 'Updated session notes' where id = $1",
          [sessionId],
        );
        await save("Dusty after another sale", [owner], horseId);
        assert.deepEqual(
          (
            await db.query(
              "select horse_id, notes, duration_minutes from public.training_entries where id = $1",
              [sessionId],
            )
          ).rows,
          [
            {
              horse_id: horseId,
              notes: "Updated session notes",
              duration_minutes: 40,
            },
          ],
        );
        await db.query("delete from public.training_entries where id = $1", [
          note.rows[0].id,
        ]);
        assert.equal(
          (await db.query("select id from public.training_entries")).rows
            .length,
          1,
        );
        for (const [kind, duration] of [
          ["note", 15],
          ["session", 0],
          ["session", 1441],
          ["other", null],
        ]) {
          await assert.rejects(
            db.query(
              "insert into public.training_entries(horse_id, kind, entry_date, title, notes, duration_minutes) values ($1, $2, '2026-10-21', 'Title', 'Notes', $3)",
              [horseId, kind, duration],
            ),
          );
        }
        const historyHorse = await save("History only", [owner]);
        await db.query(
          "insert into public.training_entries(horse_id, kind, entry_date, title, notes) values ($1, 'note', '2026-10-21', 'First day', 'Settled in.')",
          [historyHorse],
        );
        await assert.rejects(
          db.query("delete from public.horses where id = $1", [historyHorse]),
          /foreign key/,
        );
      },
    );
    await t.test(
      "business settings are editable by admin and do not rewrite existing stay terms",
      async () => {
        const original = await db.query(
          "select id, monthly_rate_cents, billing_day, proration, invoice_due_days from public.training_stays",
        );
        await db.exec(
          "update public.business_settings set default_monthly_rate_cents = 175000, default_billing_day = 15, default_invoice_due_days = 14, business_email = 'barn@example.com' where singleton",
        );
        assert.deepEqual(
          (
            await db.query(
              "select default_monthly_rate_cents, default_invoice_due_days from public.business_settings",
            )
          ).rows,
          [
            {
              default_monthly_rate_cents: 175000,
              default_invoice_due_days: 14,
            },
          ],
        );
        assert.deepEqual(
          (
            await db.query(
              "select id, monthly_rate_cents, billing_day, proration, invoice_due_days from public.training_stays",
            )
          ).rows,
          original.rows,
        );
        await assert.rejects(
          db.exec(
            "insert into public.business_settings(singleton) values (false)",
          ),
          /check constraint/,
        );
        await assert.rejects(
          db.exec("delete from public.business_settings"),
          /permission denied/,
        );
      },
    );
    await t.test(
      "non-admin users cannot access private records or change business settings",
      async () => {
        await db.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [otherUser],
        );
        await assert.rejects(
          save("Unauthorized", [owner]),
          /Administrator access required/,
        );
        assert.deepEqual(
          (await db.query("select id from public.horses")).rows,
          [],
        );
        assert.deepEqual(
          (await db.query("select id from public.training_entries")).rows,
          [],
        );
        assert.deepEqual(
          (await db.query("select * from public.business_settings")).rows,
          [],
        );
        assert.deepEqual(
          (
            await db.query(
              "update public.business_settings set default_monthly_rate_cents = 1 returning singleton",
            )
          ).rows,
          [],
        );
        await assert.rejects(
          db.exec(
            "insert into public.business_settings(singleton) values (true) on conflict (singleton) do update set default_monthly_rate_cents = 1",
          ),
          /row-level security/,
        );
        await assert.rejects(
          db.query(
            "insert into public.training_entries(horse_id, kind, entry_date, title, notes) values ($1, 'note', '2026-10-21', 'Unauthorized', 'Private')",
            [horseId],
          ),
          /row-level security/,
        );
        await db.exec("reset role; set role anon;");
        await assert.rejects(save("Anonymous", [owner]), /permission denied/);
        await assert.rejects(
          db.query("select id from public.training_entries"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select * from public.business_settings"),
          /permission denied/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
