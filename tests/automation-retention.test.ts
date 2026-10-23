import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
} from "./helpers/inventory-database.ts";

test("scheduler retention is bounded, service-only and preserves recent, unfinished and latest runs", async () => {
  const db = await inventoryDatabase();
  try {
    await assert.rejects(
      db.query("select prune_automation_runs()"),
      /permission denied/,
    );
    await db.exec("reset role");
    for (const table of [
      "billing_automation_runs",
      "expense_automation_runs",
    ]) {
      await db.exec(`insert into ${table}(business_date,started_at,finished_at,state,reason)
        select current_date-n,now()-make_interval(days=>n),now()-make_interval(days=>n),'complete','expired'
        from generate_series(1000,1600) n;
        insert into ${table}(business_date,finished_at,state,reason) values
        (current_date-1,now()-interval '500 days','complete','latest'),
        (current_date-2,now()-interval '89 days','complete','recent'),
        (current_date-3,now()-interval '100 days','error','retained error'),
        (current_date-4,now()-interval '366 days','blocked','expired blocked'),
        (current_date-5,null,'running','unfinished'),
        (current_date-6,null,'error','no finish');`);
    }
    await db.exec("set role service_role");
    let result = (
      await db.query<{
        r: { billing_deleted: number; expenses_deleted: number };
      }>("select prune_automation_runs() r")
    ).rows[0].r;
    assert.equal(result.billing_deleted, 500);
    assert.equal(result.expenses_deleted, 500);
    result = (
      await db.query<{
        r: { billing_deleted: number; expenses_deleted: number };
      }>("select prune_automation_runs() r")
    ).rows[0].r;
    assert.equal(result.billing_deleted, 102);
    assert.equal(result.expenses_deleted, 102);
    await login(db, adminId);
    for (const table of [
      "billing_automation_runs",
      "expense_automation_runs",
    ]) {
      assert.deepEqual(
        (
          await db.query<{ reason: string }>(
            `select reason from ${table} order by reason`,
          )
        ).rows.map((x) => x.reason),
        ["latest", "no finish", "recent", "retained error", "unfinished"],
      );
    }
    await db.exec("reset role;set role service_role");
    const combined = (
      await db.query<{
        r: {
          state: string;
          cleanup: { state: string; billing_deleted: number };
        };
      }>("select run_scheduled_automations() r")
    ).rows[0].r;
    assert.equal(combined.state, "complete");
    assert.equal(combined.cleanup.state, "complete");
    assert.equal(combined.cleanup.billing_deleted, 0);
    await db.exec("reset role");
    await db.exec(`insert into billing_automation_runs(business_date,finished_at,state) values(current_date-900,now()-interval '900 days','complete');
      create function public.fixture_retention_failure() returns trigger language plpgsql as $$begin raise exception 'Injected cleanup failure';end;$$;
      create trigger fixture_retention_failure before delete on billing_automation_runs for each row execute function public.fixture_retention_failure();
      set role service_role;`);
    const failure = (
      await db.query<{
        r: {
          state: string;
          billing: { state: string };
          expenses: { state: string };
          cleanup: { state: string };
        };
      }>("select run_scheduled_automations() r")
    ).rows[0].r;
    assert.equal(failure.state, "error");
    assert.equal(failure.cleanup.state, "error");
    assert.equal(failure.billing.state, "off");
    assert.equal(failure.expenses.state, "off");
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select prune_automation_runs()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
