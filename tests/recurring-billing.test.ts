import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { billingScheduleValues } from "../src/lib/billing-schedule.ts";
test("billing schedules validate modes, 31st dates, and intentional recurring start dates", () => {
  const f = new FormData();
  f.set("arrival_date", "2026-01-31");
  f.set("billing_schedule", "arrival_anniversary");
  f.set("recurring_enabled", "on");
  f.set("recurring_start_date", "2026-01-31");
  assert.equal(billingScheduleValues(f).billing_day, 31);
  f.set("billing_schedule", "first_of_month");
  assert.equal(billingScheduleValues(f).billing_day, 1);
  f.set("billing_schedule", "custom");
  f.set("billing_day", "32");
  assert.throws(() => billingScheduleValues(f), /1 to 31/);
  f.set("billing_day", "31");
  f.set("recurring_start_date", "2026-01-01");
  assert.throws(() => billingScheduleValues(f), /before arrival/);
});
test("recurring cycles clamp anchors, generate completed periods safely, and retain incomplete drafts", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Customer') returning id",
      )
    ).rows[0].id;
    async function stay(
      name: string,
      arrival: string,
      departure: string | null,
      schedule: string,
      day: number,
      feed = "included",
      board = "included",
      proration = "calendar_days",
    ) {
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
          "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,billing_schedule,billing_day,recurring_enabled,recurring_start_date,proration,invoice_due_days,feed_billing,boarding_billing,feed_monthly_cents,boarding_monthly_cents) values($1,$2,$3,$4,3100,$5,$6,true,$3,$7,7,$8,$9,case when $8='separate_monthly' then 3100 else null end,case when $9='separate_monthly' then 3100 else null end) returning id",
          [
            horse,
            customer,
            arrival,
            departure,
            schedule,
            day,
            proration,
            feed,
            board,
          ],
        )
      ).rows[0].id;
      return { id, horse };
    }
    type Cycle = {
      state: string;
      from: string;
      to: string;
      billing_date: string;
      invoice_id?: string;
      cycle_id?: string;
      reason?: string;
    };
    async function next(stay: string) {
      return (
        await db.query<{ cycle: Cycle }>(
          "select next_recurring_cycle($1,'2026-10-22') cycle",
          [stay],
        )
      ).rows[0].cycle;
    }
    async function prepare(stay: string, cycle: Cycle) {
      return (
        await db.query<{
          result: { state: string; invoice_id: string; reason?: string };
        }>("select prepare_recurring_invoice($1,$2,$3) result", [
          stay,
          cycle.from,
          cycle.to,
        ])
      ).rows[0].result;
    }
    async function classify(
      stay: string,
      from: string,
      to: string,
      status = "worked",
    ) {
      await db.query("select set_training_days($1,$2,$3,$4,'Reviewed dates')", [
        stay,
        from,
        to,
        status,
      ]);
    }
    const anniversary = await stay(
      "31st arrival",
      "2026-01-31",
      null,
      "arrival_anniversary",
      31,
      "included",
      "separate_monthly",
    );
    const cycle = await next(anniversary.id);
    assert.equal(cycle.billing_date, "2026-02-28");
    assert.equal(cycle.to, "2026-02-27");
    await classify(anniversary.id, cycle.from, cycle.to);
    const first = await prepare(anniversary.id, cycle);
    assert.equal(first.state, "issued", first.reason ?? "");
    const total = (
      await db.query<{ total_cents: string; due_date: Date }>(
        "select total_cents,due_date from invoice_totals where id=$1",
        [first.invoice_id],
      )
    ).rows[0];
    assert.equal(Number(total.total_cents), 6178);
    assert.equal((await next(anniversary.id)).billing_date, "2026-03-31");
    assert.equal(
      (await prepare(anniversary.id, cycle)).invoice_id,
      first.invoice_id,
    );
    assert.equal(
      Number(
        (
          await db.query<{ count: string }>(
            "select count(*) from recurring_billing_cycles where stay_id=$1",
            [anniversary.id],
          )
        ).rows[0].count,
      ),
      1,
    );
    const leap = (
      await db.query<{ value: string }>(
        "select billing_anchor_date('2028-02-01',31)::text as value",
      )
    ).rows[0].value;
    assert.equal(leap, "2028-02-29");
    const final = await stay(
      "Leaving",
      "2026-01-10",
      "2026-01-20",
      "first_of_month",
      1,
      "separate_monthly",
    );
    const finalCycle = await next(final.id);
    assert.equal(finalCycle.billing_date, "2026-01-21");
    assert.equal(finalCycle.to, "2026-01-20");
    await classify(final.id, finalCycle.from, finalCycle.to, "nonbillable");
    const finalInvoice = await prepare(final.id, finalCycle);
    assert.equal(finalInvoice.state, "issued", finalInvoice.reason ?? "");
    assert.equal(
      Number(
        (
          await db.query<{ total_cents: string }>(
            "select total_cents from invoice_totals where id=$1",
            [finalInvoice.invoice_id],
          )
        ).rows[0].total_cents,
      ),
      1100,
    );
    assert.equal((await next(final.id)).state, "complete");
    const missing = await stay(
      "Missing dates",
      "2026-01-01",
      null,
      "first_of_month",
      1,
    );
    const missingCycle = await next(missing.id);
    const draft = await prepare(missing.id, missingCycle);
    assert.equal(draft.state, "review");
    assert.match(draft.reason!, /Classify every/);
    assert.equal(
      (await prepare(missing.id, missingCycle)).invoice_id,
      draft.invoice_id,
    );
    await classify(missing.id, missingCycle.from, missingCycle.to);
    assert.equal((await prepare(missing.id, missingCycle)).state, "issued");
    const atCost = await stay(
      "Actual costs",
      "2026-01-01",
      "2026-01-31",
      "first_of_month",
      1,
      "at_cost",
      "not_provided",
    );
    const costCycle = await next(atCost.id);
    await classify(atCost.id, costCycle.from, costCycle.to, "nonbillable");
    const costDraft = await prepare(atCost.id, costCycle);
    assert.equal(costDraft.state, "review");
    assert.match(costDraft.reason!, /Mark every/);
    await db.query(
      "update training_stays set invoice_due_days=14 where id=$1",
      [atCost.id],
    );
    assert.match(
      (await prepare(atCost.id, costCycle)).reason!,
      /Payment terms changed/,
    );
    await db.query(
      "select update_invoice_header($1,'2026-02-01','2026-02-15',null)",
      [costDraft.invoice_id],
    );
    await db.query(
      "select set_invoice_cost_ready($1,'feed',true,'Reviewed intentional zero feed cost')",
      [costDraft.invoice_id],
    );
    assert.equal((await prepare(atCost.id, costCycle)).state, "issued");
    const changedAgreement = await stay(
      "Changed service agreement",
      "2026-01-01",
      "2026-01-31",
      "first_of_month",
      1,
      "separate_monthly",
      "at_cost",
    );
    const changedCycle = await next(changedAgreement.id);
    await classify(changedAgreement.id, changedCycle.from, changedCycle.to);
    const changedDraft = await prepare(changedAgreement.id, changedCycle);
    assert.equal(changedDraft.state, "review");
    await db.query(
      "update training_stays set feed_billing='included',feed_monthly_cents=null where id=$1",
      [changedAgreement.id],
    );
    assert.match(
      (await prepare(changedAgreement.id, changedCycle)).reason!,
      /Remove the old feed/,
    );
    const oldFeed = (
      await db.query<{ id: string }>(
        "select id from invoice_lines where invoice_id=$1 and source_snapshot->>'service'='feed'",
        [changedDraft.invoice_id],
      )
    ).rows[0].id;
    await db.query("select remove_invoice_line($1)", [oldFeed]);
    await db.query(
      "select set_invoice_cost_ready($1,'boarding',true,'Reviewed zero boarding cost')",
      [changedDraft.invoice_id],
    );
    assert.equal(
      (await prepare(changedAgreement.id, changedCycle)).state,
      "issued",
    );
    const manual = await stay(
      "Manual policy",
      "2026-01-01",
      null,
      "first_of_month",
      1,
      "included",
      "included",
      "manual",
    );
    const manualCycle = await next(manual.id);
    const manualDraft = await prepare(manual.id, manualCycle);
    assert.match(manualDraft.reason!, /manual/);
    await db.query("select void_invoice($1,'Do not bill this cycle')", [
      manualDraft.invoice_id,
    ]);
    const voided = await next(manual.id);
    assert.equal(voided.state, "voided");
    await assert.rejects(prepare(manual.id, manualCycle), /no due cycle/);
    await db.query(
      "select skip_voided_recurring_cycle($1,'Owner chose to waive this period')",
      [voided.cycle_id],
    );
    assert.equal((await next(manual.id)).from, "2026-02-01");
    await assert.rejects(
      db.query("select prepare_recurring_invoice($1,$2,$3)", [
        anniversary.id,
        "2026-01-01",
        "2026-01-31",
      ]),
      /next cycle changed/,
    );
    await login(db, outsiderId);
    await assert.rejects(next(anniversary.id), /Administrator/);
    await assert.rejects(prepare(anniversary.id, cycle), /Administrator/);
    await assert.rejects(
      db.query("select recurring_billing_overview()"),
      /Administrator/,
    );
    assert.equal(
      (await db.query("select * from recurring_billing_cycles")).rows.length,
      0,
    );
    await assert.rejects(
      db.query("select build_recurring_charges($1)", [first.invoice_id]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
