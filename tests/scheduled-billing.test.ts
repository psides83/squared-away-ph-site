import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { handleBillingCron } from "../src/lib/billing-cron.ts";
test("cron rejects missing configuration, invalid credentials and non-production before billing", async () => {
  const secret = "s".repeat(40);
  let calls = 0;
  const run = async () => {
    calls++;
    return { state: "complete", processed: 2 };
  };
  const request = (token?: string) =>
    new Request("https://example.test/api/cron/billing", {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const config = { secret, production: true, configured: true };
  assert.equal((await handleBillingCron(request(), config, run)).status, 401);
  assert.equal(
    (await handleBillingCron(request("x".repeat(40)), config, run)).status,
    401,
  );
  assert.equal(
    (
      await handleBillingCron(
        request(secret),
        { ...config, secret: undefined },
        run,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await handleBillingCron(
        request(secret),
        { ...config, production: false },
        run,
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await handleBillingCron(
        request(secret),
        { ...config, configured: false },
        run,
      )
    ).status,
    503,
  );
  assert.equal(calls, 0);
  const response = await handleBillingCron(request(secret), config, run);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(calls, 1);
  assert.equal(
    (
      await handleBillingCron(request(secret), config, async () => ({
        state: "blocked",
      }))
    ).status,
    500,
  );
  assert.equal(
    (
      await handleBillingCron(request(secret), config, async () => {
        throw Error("secret database detail");
      })
    ).status,
    500,
  );
});
test("scheduled billing stays off by default, finalizes complete cycles, retains review drafts, audits and deduplicates daily runs", async () => {
  const db = await inventoryDatabase();
  try {
    await assert.rejects(
      db.query("select run_scheduled_billing()"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("update billing_automation set enabled=true"),
      /permission denied/,
    );
    async function worker() {
      await db.exec("reset role;set role service_role");
      const r = (
        await db.query<{ r: { state: string; processed?: number } }>(
          "select run_scheduled_billing() r",
        )
      ).rows[0].r;
      await login(db, adminId);
      return r;
    }
    assert.equal((await worker()).state, "off");
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Customer') returning id",
      )
    ).rows[0].id;
    async function stay(name: string, complete: boolean, feed = "included") {
      const horse = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values($1) returning id",
          [name],
        )
      ).rows[0].id;
      await db.query(
        "insert into horse_customers(horse_id,customer_id) values($1,$2)",
        [horse, customer],
      );
      const id = (
        await db.query<{ id: string }>(
          "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,recurring_enabled,recurring_start_date,billing_schedule,proration,invoice_due_days,feed_billing,boarding_billing) values($1,$2,'2020-01-01','2020-01-02',31000,true,'2020-01-01','first_of_month','calendar_days',7,$3,'included') returning id",
          [horse, customer, feed],
        )
      ).rows[0].id;
      if (complete)
        await db.query(
          "select set_training_days($1,'2020-01-01','2020-01-02','worked','Reviewed')",
          [id],
        );
      return id;
    }
    const done = await stay("Complete", true),
      missing = await stay("Missing calendar", false),
      actual = await stay("Needs approval", true, "at_cost");
    await db.query("select configure_billing_automation(true)");
    let r = await worker();
    assert.equal(r.state, "review");
    assert.equal(r.processed, 3);
    const invoices = (
      await db.query<{ stay_id: string; id: string; status: string }>(
        "select stay_id,id,status from invoices",
      )
    ).rows;
    assert.equal(invoices.find((i) => i.stay_id === done)!.status, "issued");
    assert.equal(invoices.find((i) => i.stay_id === missing)!.status, "draft");
    assert.equal(invoices.find((i) => i.stay_id === actual)!.status, "draft");
    const audit = (
      await db.query<{
        state: string;
        authorized_by: string;
        results: unknown[];
      }>("select * from billing_automation_runs")
    ).rows[0];
    assert.equal(audit.state, "review");
    assert.equal(audit.authorized_by, adminId);
    assert.equal(audit.results.length, 3);
    assert.equal((await worker()).state, "already_run");
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from invoices"))
        .rows[0].n,
      3,
    );
    // Simulate a later business day without changing the worker's clock or public API.
    await db.exec("reset role");
    await db.exec(
      "update billing_automation_runs set business_date=business_date-1",
    );
    await login(db, adminId);
    await db.query(
      "select set_training_days($1,'2020-01-01','2020-01-02','worked','Reviewed')",
      [missing],
    );
    await db.query(
      "select set_invoice_cost_ready($1,'feed',true,'Confirmed intentional zero feed cost')",
      [invoices.find((i) => i.stay_id === actual)!.id],
    );
    assert.equal((await worker()).state, "complete");
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from invoices where status='issued'",
        )
      ).rows[0].n,
      3,
    );
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from invoices"))
        .rows[0].n,
      3,
    );
    await db.query("select configure_billing_automation(false)");
    assert.equal((await worker()).state, "off");
    await login(db, outsiderId);
    await assert.rejects(
      db.query("select configure_billing_automation(true)"),
      /Administrator/,
    );
    assert.equal(
      (await db.query("select * from billing_automation_runs")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select run_scheduled_billing()"),
      /permission denied/,
    );
    await login(db, adminId);
    await db.query("select configure_billing_automation(true)");
    await db.exec("reset role");
    await db.exec(
      "delete from billing_automation_runs;delete from admin_users",
    );
    await db.exec("set role service_role");
    assert.equal(
      (
        await db.query<{ r: { state: string } }>(
          "select run_scheduled_billing() r",
        )
      ).rows[0].r.state,
      "blocked",
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from invoices"))
        .rows[0].n,
      3,
    );
    // Worker context never escapes into the caller, including error paths.
    assert.equal(
      (
        await db.query<{ sub: string }>(
          "select current_setting('request.jwt.claim.sub') sub",
        )
      ).rows[0].sub,
      adminId,
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select run_scheduled_billing()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("worker isolates one stay failure, restores delegated identity, and keeps error audit private", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Customer') returning id",
      )
    ).rows[0].id;
    for (const name of ["Fails", "Works"]) {
      const horse = (
        await db.query<{ id: string }>(
          "insert into horses(barn_name) values($1) returning id",
          [name],
        )
      ).rows[0].id;
      await db.query(
        "insert into horse_customers(horse_id,customer_id) values($1,$2)",
        [horse, customer],
      );
      await db.query(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,monthly_rate_cents,recurring_enabled,recurring_start_date) values($1,$2,'2020-01-01',10000,true,'2020-01-01')",
        [horse, customer],
      );
    }
    await db.query("select configure_billing_automation(true)");
    await db.exec("reset role");
    // Inject a database-level fault after invoice creation; its partial writes must roll back.
    await db.exec(`create or replace function public.prepare_recurring_invoice(p_stay uuid,p_expected_from date,p_expected_to date) returns jsonb language plpgsql security definer set search_path='' as $$
 declare invoice uuid:=gen_random_uuid();begin
 if not public.is_admin() then raise exception 'Admin required';end if;
 perform public.create_invoice(invoice,(select billing_customer_id from public.training_stays where id=p_stay),p_stay,'2020-02-01','2020-02-01',p_expected_from,p_expected_to);
 if exists(select 1 from public.training_stays s join public.horses h on h.id=s.horse_id where s.id=p_stay and h.barn_name='Fails') then raise exception 'Injected stay failure';end if;
 return jsonb_build_object('state','review','invoice_id',invoice,'reason','Fixture review');end;$$`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      outsiderId,
    ]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: outsiderId, role: "service_role" }),
    ]);
    await db.exec("set role service_role");
    const result = (
      await db.query<{ r: { state: string; processed: number } }>(
        "select run_scheduled_billing() r",
      )
    ).rows[0].r;
    assert.equal(result.state, "error");
    assert.equal(result.processed, 2);
    const claims = (
      await db.query<{ sub: string; claims: string }>(
        "select current_setting('request.jwt.claim.sub') sub,current_setting('request.jwt.claims') claims",
      )
    ).rows[0];
    assert.equal(claims.sub, outsiderId);
    assert.equal(JSON.parse(claims.claims).sub, outsiderId);
    await db.exec("reset role");
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from invoices"))
        .rows[0].n,
      1,
    );
    const run = (
      await db.query<{ results: { state: string; reason: string }[] }>(
        "select results from billing_automation_runs",
      )
    ).rows[0];
    assert.ok(
      run.results.some(
        (r) => r.state === "error" && r.reason === "Injected stay failure",
      ),
    );
  } finally {
    await db.close();
  }
});
