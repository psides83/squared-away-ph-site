import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
const id = (n: number) =>
  `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customer = id(1),
  monthlyHorse = id(2),
  feedHorse = id(3),
  boardHorse = id(4),
  monthlyStay = id(5),
  feedStay = id(6),
  boardStay = id(7),
  shared = id(8),
  direct = id(9),
  parent = id(10),
  boardSplit = id(11),
  directSplit = id(12);

test("service billing follows physical days and recorded costs with retained sources and no duplicate claims", async (t) => {
  const db = await inventoryDatabase();
  try {
    await db.exec(`reset role;
      insert into public.customers(id,name) values('${customer}','Service customer');
      insert into public.horses(id,barn_name) values('${monthlyHorse}','Monthly horse'),('${feedHorse}','Feed horse'),('${boardHorse}','Board horse');
      insert into public.training_stays(id,horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,feed_monthly_cents,boarding_billing,boarding_monthly_cents) values
      ('${monthlyStay}','${monthlyHorse}','${customer}','2026-01-10','2026-01-20',100000,'separate_monthly',31000,'separate_monthly',62000),
      ('${feedStay}','${feedHorse}','${customer}','2026-01-01','2026-01-31',100000,'at_cost',null,'included',null),
      ('${boardStay}','${boardHorse}','${customer}','2026-01-01','2026-01-31',100000,'included',null,'at_cost',null);
      insert into public.expenses(id,expense_date,category_id,amount_cents,vendor)
        select '${shared}','2026-02-01',id,10000,'Facility' from public.expense_categories where name='Boarding / facility';
      insert into public.expenses(id,horse_id,expense_date,category_id,amount_cents,vendor,reimbursable)
        select '${direct}','${boardHorse}','2026-01-10',id,5000,'Facility extras',true from public.expense_categories where name='Boarding / facility';
    `);
    await login(db, "20000000-0000-4000-8000-000000000001");
    const draft = async (
      stay: string,
      from = "2026-01-01",
      to = "2026-01-31",
    ) =>
      (
        await db.query<{ i: string }>(
          "select public.create_invoice($1,$2,$3,'2026-02-01','2026-02-08',$4,$5,null) i",
          [crypto.randomUUID(), customer, stay, from, to],
        )
      ).rows[0].i;
    const monthly = async (invoice: string, service: string) =>
      (
        await db.query<{ line: string }>(
          "select public.add_monthly_service($1,$2) line",
          [invoice, service],
        )
      ).rows[0].line;
    const feed = async (invoice: string) =>
      (
        await db.query<{ line: string }>(
          "select public.add_actual_feed($1) line",
          [invoice],
        )
      ).rows[0].line;
    const board = async (invoice: string, split: string) =>
      (
        await db.query<{ line: string }>(
          "select public.add_actual_boarding($1,$2) line",
          [invoice, split],
        )
      ).rows[0].line;
    const remove = async (line: string) =>
      db.query("select public.remove_invoice_line($1)", [line]);
    const line = async (l: string) =>
      (
        await db.query<{ amount_cents: number; source_snapshot: any }>(
          "select * from public.invoice_lines where id=$1",
          [l],
        )
      ).rows[0];
    let monthlyInvoice = "",
      feedInvoice = "",
      boardInvoice = "",
      feedLine = "",
      feedMovement = "";
    await t.test(
      "monthly feed and boarding count every physical day without needing training classifications",
      async () => {
        monthlyInvoice = await draft(monthlyStay);
        const f = await monthly(monthlyInvoice, "feed"),
          b = await monthly(monthlyInvoice, "boarding");
        assert.equal((await line(f)).amount_cents, 11000);
        assert.equal((await line(b)).amount_cents, 22000);
        assert.equal((await line(f)).source_snapshot.boarding_days, 11);
        assert.equal(
          (await db.query("select * from public.training_days")).rows.length,
          0,
        );
        await assert.rejects(
          monthly(await draft(monthlyStay), "feed"),
          /already reserved/,
        );
        await remove(f);
        await monthly(monthlyInvoice, "feed");
        await assert.rejects(
          monthly(await draft(monthlyStay, "2026-01-01", "2026-02-01"), "feed"),
          /one calendar month/,
        );
        await assert.rejects(
          monthly(monthlyInvoice, "invalid"),
          /feed or boarding/,
        );
        await assert.rejects(
          db.query(
            "update public.training_stays set arrival_date='2026-01-11' where id=$1",
            [monthlyStay],
          ),
          /cannot exclude/,
        );
        await db.query("select public.finalize_invoice($1)", [monthlyInvoice]);
        await db.query(
          "update public.training_stays set feed_monthly_cents=62000 where id=$1",
          [monthlyStay],
        );
        assert.equal((await line(b)).source_snapshot.monthly_rate_cents, 62000);
        assert.equal(
          Number(
            (
              await db.query<{ total: string }>(
                "select issued_total_cents as total from public.invoices where id=$1",
                [monthlyInvoice],
              )
            ).rows[0].total,
          ),
          33000,
        );
      },
    );
    await t.test(
      "monthly services use leap-year calendar days and preserve explicit zero rates",
      async () => {
        const leapStay = crypto.randomUUID();
        await db.query(
          "insert into public.training_stays(id,horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,feed_billing,feed_monthly_cents,boarding_billing,boarding_monthly_cents) values($1,$2,$3,'2024-02-14','2024-02-29',0,'separate_monthly',0,'separate_monthly',29000)",
          [leapStay, monthlyHorse, customer],
        );
        const i = await draft(leapStay, "2024-02-01", "2024-02-29");
        const f = await monthly(i, "feed"),
          b = await monthly(i, "boarding");
        assert.equal((await line(f)).amount_cents, 0);
        assert.equal((await line(b)).amount_cents, 16000);
        assert.equal((await line(b)).source_snapshot.calendar_days, 29);
      },
    );
    const category = (
      await db.query<{ id: string }>(
        "select id from public.expense_categories where name='Feed'",
      )
    ).rows[0].id;
    const product = (
      await db.query<{ id: string }>(
        "select public.create_inventory_product('Measured feed','feed',$1) id",
        [category],
      )
    ).rows[0].id;
    const unit = (
      await db.query<{ id: string }>(
        "select id from public.inventory_units where product_id=$1 and label='oz'",
        [product],
      )
    ).rows[0].id;
    const move = async (
      kind: string,
      quantity: number,
      cost: number | null = null,
      date = "2026-01-01",
    ) =>
      (
        await db.query<{ r: { movement_id: string } }>(
          "select public.record_stock_movement($1,$2,$3,$4,$5,$6,$7,$8,null,'Feed store',null) r",
          [
            crypto.randomUUID(),
            product,
            unit,
            quantity,
            kind,
            date,
            cost,
            kind === "feeding" ? feedHorse : null,
          ],
        )
      ).rows[0].r.movement_id;
    await t.test(
      "feed at cost uses unreversed consumption, excludes waste, and rounds the sum once",
      async () => {
        await move("opening", 6, 2);
        feedMovement = await move("feeding", 1);
        await move("feeding", 1);
        await move("feeding", 1);
        const corrected = await move("feeding", 1);
        await db.query(
          "select public.reverse_stock_consumption($1,'Not fed')",
          [corrected],
        );
        await move("waste", 1);
        feedInvoice = await draft(feedStay);
        const options = (
          await db.query<{ r: any }>(
            "select public.invoice_service_options($1) r",
            [feedInvoice],
          )
        ).rows[0].r;
        assert.equal(options.feed.count, 3);
        assert.equal(options.feed.amount_cents, 1);
        feedLine = await feed(feedInvoice);
        const l = await line(feedLine);
        assert.equal(l.amount_cents, 1);
        assert.equal(l.source_snapshot.sources.length, 3);
        assert.ok(Number(l.source_snapshot.unrounded_cost_cents) > 0.99);
        await assert.rejects(feed(await draft(feedStay)), /No unbilled/);
        const balance = (
          await db.query(
            "select * from public.inventory_balances where product_id=$1",
            [product],
          )
        ).rows;
        await assert.rejects(
          db.query(
            "select public.reverse_stock_consumption($1,'Attempt billed correction')",
            [feedMovement],
          ),
          /reserved on an invoice/,
        );
        assert.deepEqual(
          (
            await db.query(
              "select * from public.inventory_balances where product_id=$1",
              [product],
            )
          ).rows,
          balance,
        );
        await db.query(
          "update public.training_stays set feed_billing='separate_monthly',feed_monthly_cents=31000 where id=$1",
          [feedStay],
        );
        await assert.rejects(
          monthly(await draft(feedStay), "feed"),
          /already billed at cost/,
        );
        await db.query(
          "update public.training_stays set feed_billing='at_cost',feed_monthly_cents=null where id=$1",
          [feedStay],
        );
      },
    );
    await t.test(
      "later purchases preserve billed feed cost and new actual feeding can be billed once",
      async () => {
        const before = await line(feedLine);
        await move("purchase", 3, 300);
        await move("feeding", 1, null, "2026-01-10");
        const extraInvoice = await draft(feedStay);
        const extra = await feed(extraInvoice);
        assert.equal((await line(extra)).source_snapshot.sources.length, 1);
        assert.deepEqual(await line(feedLine), before);
        await db.query("select public.finalize_invoice($1)", [feedInvoice]);
        await db.query(
          "select public.void_invoice($1,'Correct a feeding record')",
          [feedInvoice],
        );
        await db.query(
          "select public.reverse_stock_consumption($1,'Corrected after void')",
          [feedMovement],
        );
        assert.equal(
          (
            await db.query(
              "select * from public.invoice_feed_claims where line_id=$1",
              [feedLine],
            )
          ).rows.length,
          0,
        );
        assert.equal((await line(feedLine)).amount_cents, 1);
      },
    );
    await db.query(
      "select public.save_expense_allocation($1,$2,'2026-01-01','2026-01-31',$3::jsonb,'Reviewed board horse cost')",
      [
        parent,
        shared,
        JSON.stringify([{ horse_id: boardHorse, board_days: 31 }]),
      ],
    );
    await db.query(
      "select public.save_cost_stay_split($1,$2,$3,$4,$5::jsonb,'Reviewed boarding cost')",
      [
        boardSplit,
        shared,
        parent,
        boardHorse,
        JSON.stringify([{ stay_id: boardStay, amount_cents: 10000 }]),
      ],
    );
    await db.query(
      "select public.save_cost_stay_split($1,$2,null,$3,$4::jsonb,'Boarding portion only')",
      [
        directSplit,
        direct,
        boardHorse,
        JSON.stringify([{ stay_id: boardStay, amount_cents: 4000 }]),
      ],
    );
    await t.test(
      "boarding uses selected reviewed stay costs and protects source revisions until released",
      async () => {
        boardInvoice = await draft(boardStay);
        const l = await board(boardInvoice, boardSplit);
        assert.equal((await line(l)).amount_cents, 10000);
        assert.equal(
          (await line(l)).source_snapshot.expense_date,
          "2026-02-01",
        );
        await assert.rejects(
          board(await draft(boardStay), boardSplit),
          /already reserved/,
        );
        await assert.rejects(
          db.query(
            "select public.clear_cost_stay_split($1,$2,$3,'Attempt correction')",
            [shared, parent, boardHorse],
          ),
          /reserved on an invoice/,
        );
        await assert.rejects(
          db.query(
            "select public.clear_expense_allocation($1,'Attempt correction')",
            [shared],
          ),
          /reserved as boarding/,
        );
        await db.query(
          "update public.training_stays set boarding_billing='separate_monthly',boarding_monthly_cents=31000 where id=$1",
          [boardStay],
        );
        await assert.rejects(
          monthly(await draft(boardStay), "boarding"),
          /already billed at cost/,
        );
        await db.query(
          "update public.training_stays set boarding_billing='at_cost',boarding_monthly_cents=null where id=$1",
          [boardStay],
        );
      },
    );
    await t.test(
      "full expense reimbursements and assigned boarding portions cannot both bill the same expense",
      async () => {
        const l = await board(boardInvoice, directSplit);
        const other = await draft(boardStay);
        await assert.rejects(
          db.query("select public.add_expense_chargeback($1,$2,0)", [
            other,
            direct,
          ]),
          /already billed as boarding/,
        );
        await remove(l);
        const reimb = (
          await db.query<{ id: string }>(
            "select public.add_expense_chargeback($1,$2,0) id",
            [other, direct],
          )
        ).rows[0].id;
        await assert.rejects(
          board(boardInvoice, directSplit),
          /full charge-back/,
        );
        await remove(reimb);
        await board(boardInvoice, directSplit);
        await db.query("select public.finalize_invoice($1)", [boardInvoice]);
        await db.query(
          "select public.void_invoice($1,'Revise boarding allocation')",
          [boardInvoice],
        );
        assert.equal(
          (
            await db.query(
              "select * from public.invoice_boarding_claims where line_id in(select id from public.invoice_lines where invoice_id=$1)",
              [boardInvoice],
            )
          ).rows.length,
          0,
        );
        await db.query(
          "select public.clear_expense_allocation($1,'Allowed after void')",
          [shared],
        );
        assert.equal(
          (
            await db.query(
              "select * from public.invoice_lines where invoice_id=$1",
              [boardInvoice],
            )
          ).rows.length,
          2,
        );
      },
    );
    await t.test(
      "included services generate no charges and monthly reservations release on void",
      async () => {
        await assert.rejects(
          monthly(await draft(feedStay), "boarding"),
          /separate monthly rate/,
        );
        await assert.rejects(
          board(await draft(feedStay), boardSplit),
          /actual-cost boarding/,
        );
        await db.query("select public.void_invoice($1,'Monthly correction')", [
          monthlyInvoice,
        ]);
        assert.equal(
          (
            await db.query(
              "select * from public.invoice_service_days where line_id in(select id from public.invoice_lines where invoice_id=$1)",
              [monthlyInvoice],
            )
          ).rows.length,
          0,
        );
        await monthly(await draft(monthlyStay), "feed");
      },
    );
    await t.test(
      "non-admin users cannot inspect sources or generate service charges",
      async () => {
        await login(db, outsiderId);
        for (const table of [
          "invoice_service_days",
          "invoice_feed_claims",
          "invoice_boarding_claims",
          "boarding_invoice_sources",
        ])
          assert.equal(
            (await db.query(`select * from public.${table}`)).rows.length,
            0,
          );
        await assert.rejects(
          monthly(monthlyInvoice, "feed"),
          /Administrator access/,
        );
        await assert.rejects(feed(feedInvoice), /Administrator access/);
        await assert.rejects(
          board(boardInvoice, boardSplit),
          /Administrator access/,
        );
        await assert.rejects(
          db.query("select public.invoice_service_options($1)", [feedInvoice]),
          /Administrator access/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
