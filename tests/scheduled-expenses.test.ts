import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("automatic expenses are independently opt-in, unpaid, daily-idempotent and isolated from invoice scheduling", async () => {
  const db = await inventoryDatabase();
  try {
    async function worker() {
      await db.exec("reset role;set role service_role");
      const r = (
        await db.query<{
          r: {
            state: string;
            expenses: { state: string; processed?: number };
            billing: { state: string };
          };
        }>("select run_scheduled_automations() r")
      ).rows[0].r;
      await login(db, adminId);
      return r;
    }
    assert.equal((await worker()).expenses.state, "off");
    await assert.rejects(
      db.query("select run_scheduled_expenses()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select run_scheduled_automations()"),
      /permission denied/,
    );
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Other'",
      )
    ).rows[0].id;
    async function schedule(name: string, extra: object = {}) {
      const id = crypto.randomUUID();
      await db.query("select save_recurring_expense($1,0,$2)", [
        id,
        {
          name,
          category_id: category,
          amount_cents: 1000,
          cadence: "monthly",
          starts_on: "2020-01-31",
          ends_on: "2020-01-31",
          active: true,
          ...extra,
        },
      ]);
      return id;
    }
    const one = await schedule("One-off end"),
      backlog = await schedule("Backlog", { ends_on: null });
    await schedule("Paused", { active: false });
    await schedule("Future", { starts_on: "2099-01-01", ends_on: null });
    await schedule("Bad", { vendor: "Bad vendor" });
    await db.exec("reset role");
    await db.exec(
      `create function public.fixture_expense_failure() returns trigger language plpgsql as $$begin if new.vendor='Bad vendor' then raise exception 'Injected expense failure';end if;return new;end;$$;create trigger fixture_failure before insert on public.expenses for each row execute function public.fixture_expense_failure();`,
    );
    await login(db, adminId);
    await db.query("select configure_expense_automation(true)");
    let r = await worker();
    assert.equal(r.billing.state, "off");
    assert.equal(r.expenses.state, "error");
    assert.equal(r.state, "error");
    assert.equal(r.expenses.processed, 3);
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from expenses"))
        .rows[0].n,
      2,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from expenses where paid_on is not null",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from inventory_movements",
        )
      ).rows[0].n,
      0,
    );
    const audit = (
      await db.query<{
        authorized_by: string;
        results: { state: string; reason?: string }[];
      }>("select * from expense_automation_runs")
    ).rows[0];
    assert.equal(audit.authorized_by, adminId);
    assert.ok(
      audit.results.some(
        (x) => x.state === "error" && x.reason === "Injected expense failure",
      ),
    );
    assert.equal((await worker()).expenses.state, "already_run");
    const rows = (
      await db.query<{
        r: { id: string; next_date: string; revision: number }[];
      }>("select recurring_expense_overview() r")
    ).rows[0].r;
    assert.equal(rows.find((x) => x.id === backlog)!.next_date, "2020-02-29");
    // Manual creation shares the same sequence, and a void never rewinds it.
    await db.query("select prepare_recurring_expense($1,$2,2,'2020-02-29')", [
      crypto.randomUUID(),
      backlog,
    ]);
    const original = (
      await db.query<{ expense_id: string }>(
        "select expense_id from recurring_expense_occurrences where template_id=$1",
        [one],
      )
    ).rows[0].expense_id;
    await db.query("select set_expense_status($1,null,true)", [original]);
    await db.exec("reset role");
    await db.exec(
      "update expense_automation_runs set business_date=business_date-1;drop trigger fixture_failure on public.expenses;",
    );
    await login(db, adminId);
    r = await worker();
    assert.equal(r.expenses.state, "complete");
    assert.equal(r.expenses.processed, 2);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from recurring_expense_occurrences where template_id=$1",
          [one],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query<{ r: { business: { spent_cents: number } } }>(
          "select financial_report_bundle('2020-01-01','2020-12-31') r",
        )
      ).rows[0].r.business.spent_cents,
      0,
    );
    await db.query("select configure_expense_automation(false)");
    assert.equal((await worker()).expenses.state, "off");
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from expense_automation_runs")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from expense_automation")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select configure_expense_automation(true)"),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select run_scheduled_expenses()"),
      /permission denied/,
    );
    await login(db, adminId);
    await db.query("select configure_expense_automation(true)");
    await db.exec("reset role");
    await db.exec(
      "delete from expense_automation_runs;delete from admin_users;",
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      outsiderId,
    ]);
    await db.exec("set role service_role");
    assert.equal(
      (
        await db.query<{ r: { state: string } }>(
          "select run_scheduled_expenses() r",
        )
      ).rows[0].r.state,
      "blocked",
    );
    assert.equal(
      (
        await db.query<{ sub: string }>(
          "select current_setting('request.jwt.claim.sub') sub",
        )
      ).rows[0].sub,
      outsiderId,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select run_scheduled_automations()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
