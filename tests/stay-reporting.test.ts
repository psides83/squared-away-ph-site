import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  costSplitValues,
  invoiceReportingValues,
} from "../src/lib/reporting-links.ts";
const id = (n: number) =>
  `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ca = id(1),
  cb = id(2),
  ha = id(3),
  hb = id(4),
  sa = id(5),
  sb = id(6),
  sc = id(7),
  inv = id(8),
  stayInv = id(9),
  direct = id(10),
  shared = id(11),
  parent = id(12);

test("reporting link inputs preserve exact cents, partial splits, and required reasons", () => {
  const f = new FormData();
  f.set("request_id", id(20));
  f.set("expense_id", direct);
  f.set("horse_id", ha);
  f.set("reason", "Reviewed source");
  f.set(`amount_${sa}`, "60.01");
  f.set(`amount_${sb}`, "0");
  assert.deepEqual(costSplitValues(f).p_rows, [
    { stay_id: sa, amount_cents: 6001 },
  ]);
  f.set(`amount_${sb}`, "0.001");
  assert.throws(() => costSplitValues(f), /decimal places/);
  f.set(`amount_${sa}`, "0");
  f.set(`amount_${sb}`, "0");
  assert.throws(() => costSplitValues(f), /positive amount/);
  f.set("invoice_id", inv);
  assert.equal(invoiceReportingValues(f).p_stay, null);
  f.set("reason", "");
  assert.throws(() => invoiceReportingValues(f), /reason/);
});

test("manual income links and stay cost splits retain history and reconcile without changing bills", async (t) => {
  const db = await inventoryDatabase();
  try {
    await db.exec(`reset role;
      insert into public.customers(id,name) values('${ca}','First owner'),('${cb}','Second owner');
      insert into public.horses(id,barn_name) values('${ha}','Horse A'),('${hb}','Horse B');
      insert into public.training_stays(id,horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values
        ('${sa}','${ha}','${ca}','2026-01-01','2026-01-15',100000),
        ('${sb}','${ha}','${cb}','2026-01-16','2026-01-31',100000),
        ('${sc}','${hb}','${ca}','2026-01-01','2026-01-31',100000);
      insert into public.invoices(id,customer_id,stay_id,status,issue_date,due_date,issued_total_cents,customer_snapshot,business_snapshot) values
        ('${inv}','${ca}',null,'issued','2026-01-01','2026-01-10',10000,'{"name":"Original customer"}','{"name":"Original business"}'),
        ('${stayInv}','${ca}','${sa}','issued','2026-01-01','2026-01-10',20000,null,null);
      insert into public.invoice_payments(id,invoice_id,paid_on,amount_cents,method,reversed_at) values
        (gen_random_uuid(),'${inv}','2026-01-15',3000,'cash',null),
        (gen_random_uuid(),'${inv}','2026-02-01',2000,'cash',null),
        (gen_random_uuid(),'${inv}','2026-01-15',1000,'cash',now()),
        (gen_random_uuid(),'${stayInv}','2026-01-15',10000,'cash',null);
      insert into public.expenses(id,horse_id,expense_date,paid_on,category_id,amount_cents) select '${direct}','${ha}','2026-02-01','2026-01-31',id,10001 from public.expense_categories where name='Vet';
      insert into public.expenses(horse_id,expense_date,paid_on,category_id,amount_cents) select '${hb}','2026-01-01','2026-01-31',id,500 from public.expense_categories where name='Vet';
      insert into public.expenses(id,expense_date,paid_on,category_id,amount_cents) select '${shared}','2026-01-01','2026-01-31',id,9001 from public.expense_categories where name='Hay';
      insert into public.expenses(expense_date,paid_on,category_id,amount_cents) select '2026-01-01','2026-01-31',id,1000 from public.expense_categories where name='Other';
      insert into public.expenses(horse_id,expense_date,category_id,amount_cents) select '${ha}','2026-01-01',id,2000 from public.expense_categories where name='Other';
    `);
    await login(db, adminId);
    await db.query(
      "select public.save_expense_allocation($1,$2,'2026-01-01','2026-01-31',$3::jsonb,'Reviewed horse shares')",
      [
        parent,
        shared,
        JSON.stringify([
          { horse_id: ha, board_days: 2 },
          { horse_id: hb, board_days: 1 },
        ]),
      ],
    );
    const link = async (
      request: string,
      horse: string,
      stay: string | null,
      reason = "Reviewed invoice income",
    ) =>
      db.query("select public.set_invoice_reporting_link($1,$2,$3,$4,$5)", [
        request,
        inv,
        horse,
        stay,
        reason,
      ]);
    const split = async (
      request: string,
      expense: string,
      allocation: string | null,
      horse: string,
      rows: { stay_id: string; amount_cents: number }[],
      reason = "Reviewed stay costs",
    ) =>
      db.query("select public.save_cost_stay_split($1,$2,$3,$4,$5::jsonb,$6)", [
        request,
        expense,
        allocation,
        horse,
        JSON.stringify(rows),
        reason,
      ]);
    const bundle = async () =>
      (
        await db.query<{ r: any }>(
          "select public.financial_report_bundle('2026-01-01','2026-01-31') r",
        )
      ).rows[0].r;
    const check = async () => {
      const r = await bundle();
      const sum = (rows: any[]) =>
        rows.reduce((sum: number, x: any) => sum + x.margin_cents, 0);
      assert.equal(
        sum(r.horse.horses) +
          r.horse.unassigned_received_cents -
          r.horse.unallocated_paid_cents,
        r.business.net_cents,
      );
      assert.equal(
        sum(r.stay.stays) +
          r.stay.unassigned_received_cents -
          r.stay.unassigned_direct_cents -
          r.stay.unassigned_shared_cents -
          r.stay.unallocated_shared_cents,
        r.business.net_cents,
      );
      assert.equal(r.business.net_cents, -7502);
      return r;
    };
    const original = (
      await db.query<{ r: any }>(
        "select row_to_json(i) r from public.invoices i where id=$1",
        [inv],
      )
    ).rows[0].r;
    await t.test(
      "manual receipts may be horse-only or matched to the historical billing stay",
      async () => {
        assert.equal((await check()).horse.unassigned_received_cents, 3000);
        await link(id(20), ha, null);
        await link(id(20), ha, null);
        let r = await check();
        assert.equal(r.horse.unassigned_received_cents, 0);
        assert.equal(r.stay.unassigned_received_cents, 3000);
        assert.equal(
          r.horse.horses.find((h: any) => h.horse_id === ha).received_cents,
          13000,
        );
        await assert.rejects(link(id(20), hb, null), /already used/);
        await assert.rejects(link(id(21), ha, sb), /billing customer/);
        await assert.rejects(link(id(21), ha, sc), /billing customer/);
        await assert.rejects(
          db.query(
            "select public.set_invoice_reporting_link($1,$2,$3,$4,'Not permitted')",
            [id(21), stayInv, ha, sa],
          ),
          /without a training stay/,
        );
        await link(id(21), ha, sa);
        r = await check();
        assert.equal(r.stay.unassigned_received_cents, 0);
        assert.equal(
          r.stay.stays.find((s: any) => s.stay_id === sa).received_cents,
          13000,
        );
        const feb = (
          await db.query<{ r: any }>(
            "select public.stay_cash_report('2026-02-01','2026-02-28') r",
          )
        ).rows[0].r;
        assert.equal(
          feb.stays.find((s: any) => s.stay_id === sa).received_cents,
          2000,
        );
        assert.deepEqual(
          (
            await db.query<{ r: any }>(
              "select row_to_json(i) r from public.invoices i where id=$1",
              [inv],
            )
          ).rows[0].r,
          original,
        );
        assert.equal(
          (
            await db.query(
              "select * from public.invoice_reporting_links where retired_at is not null",
            )
          ).rows.length,
          1,
        );
      },
    );
    const directRows = [
      { stay_id: sa, amount_cents: 6000 },
      { stay_id: sb, amount_cents: 3000 },
    ];
    const sharedRows = [
      { stay_id: sa, amount_cents: 4000 },
      { stay_id: sb, amount_cents: 2001 },
    ];
    await t.test(
      "partial direct and shared portions allocate exact cents with residual amounts visible",
      async () => {
        await split(id(30), direct, null, ha, directRows);
        await split(id(30), direct, null, ha, directRows);
        await split(id(31), shared, parent, ha, sharedRows);
        const r = await check();
        assert.equal(r.stay.unassigned_direct_cents, 1501);
        assert.equal(r.stay.unassigned_shared_cents, 3000);
        assert.equal(r.stay.unallocated_shared_cents, 1000);
        const a = r.stay.stays.find((s: any) => s.stay_id === sa),
          b = r.stay.stays.find((s: any) => s.stay_id === sb);
        assert.equal(a.direct_cents, 6000);
        assert.equal(a.shared_cents, 4000);
        assert.equal(b.direct_cents, 3000);
        assert.equal(b.shared_cents, 2001);
        assert.equal(
          (await db.query("select * from public.cost_stay_splits")).rows.length,
          2,
        );
      },
    );
    await t.test(
      "over-assignment, wrong horses, duplicate stays, and stale sources cannot partially replace a split",
      async () => {
        await assert.rejects(
          split(id(30), direct, null, ha, [{ stay_id: sa, amount_cents: 1 }]),
          /already used/,
        );
        await assert.rejects(
          split(id(32), direct, null, ha, [
            { stay_id: sa, amount_cents: 10002 },
          ]),
          /cannot exceed/,
        );
        await assert.rejects(
          split(id(32), shared, parent, ha, [
            { stay_id: sa, amount_cents: 6002 },
          ]),
          /cannot exceed/,
        );
        await assert.rejects(
          split(id(32), direct, null, ha, [{ stay_id: sc, amount_cents: 1 }]),
          /source horse/,
        );
        await assert.rejects(
          split(id(32), direct, null, ha, [
            { stay_id: sa, amount_cents: 1 },
            { stay_id: sa, amount_cents: 1 },
          ]),
          /appear once/,
        );
        await assert.rejects(
          split(id(32), shared, null, ha, [{ stay_id: sa, amount_cents: 1 }]),
          /current, non-voided/,
        );
        assert.equal(
          (
            await db.query(
              "select * from public.cost_stay_splits where retired_at is null",
            )
          ).rows.length,
          2,
        );
        await db.exec("reset role");
        await assert.rejects(
          db.query(
            "update public.expenses set amount_cents=10002 where id=$1",
            [direct],
          ),
          /Clear the stay cost/,
        );
        await assert.rejects(
          db.query("update public.expenses set horse_id=$1 where id=$2", [
            hb,
            direct,
          ]),
          /Clear the stay cost/,
        );
        await assert.rejects(
          db.query("update public.training_stays set horse_id=$1 where id=$2", [
            hb,
            sb,
          ]),
          /reporting history/,
        );
        await assert.rejects(
          db.query(
            "update public.training_stays set billing_customer_id=$1 where id=$2",
            [cb, sa],
          ),
          /Clear invoice reporting/,
        );
        await login(db, adminId);
        await check();
      },
    );
    await t.test(
      "replacing the parent shared split automatically removes old stay costs while retaining their audit records",
      async () => {
        await db.query(
          "select public.save_expense_allocation($1,$2,'2026-01-01','2026-01-31',$3::jsonb,'Corrected horse shares')",
          [
            id(40),
            shared,
            JSON.stringify([
              { horse_id: ha, board_days: 1 },
              { horse_id: hb, board_days: 1 },
            ]),
          ],
        );
        const r = await check();
        assert.equal(
          r.stay.stays.reduce((sum: number, s: any) => sum + s.shared_cents, 0),
          0,
        );
        assert.equal(r.stay.unassigned_shared_cents, 9001);
        assert.equal(
          (
            await db.query(
              "select * from public.cost_stay_split_lines where split_id=$1",
              [id(31)],
            )
          ).rows.length,
          2,
        );
        await assert.rejects(
          split(id(41), shared, parent, ha, sharedRows),
          /current, non-voided/,
        );
        await split(id(41), shared, id(40), ha, [
          { stay_id: sa, amount_cents: 4501 },
        ]);
        await check();
      },
    );
    await t.test(
      "revisions and reasoned clears restate reporting without duplicating source money",
      async () => {
        await split(id(50), direct, null, ha, [
          { stay_id: sa, amount_cents: 10001 },
        ]);
        let r = await check();
        assert.equal(r.stay.unassigned_direct_cents, 500);
        assert.equal(
          r.stay.stays.find((s: any) => s.stay_id === sb).direct_cents,
          0,
        );
        await db.query(
          "select public.clear_cost_stay_split($1,null,$2,'Remove mistaken stay split')",
          [direct, ha],
        );
        await db.query(
          "select public.clear_cost_stay_split($1,null,$2,'Repeated clear')",
          [direct, ha],
        );
        r = await check();
        assert.equal(r.stay.unassigned_direct_cents, 10501);
        await db.query(
          "select public.clear_invoice_reporting_link($1,'Remove mistaken income link')",
          [inv],
        );
        await db.query(
          "select public.clear_invoice_reporting_link($1,'Repeated clear')",
          [inv],
        );
        r = await check();
        assert.equal(r.horse.unassigned_received_cents, 3000);
        assert.equal(r.stay.unassigned_received_cents, 3000);
        assert.equal(
          (
            await db.query(
              "select * from public.cost_stay_split_lines where split_id=$1",
              [id(30)],
            )
          ).rows.length,
          2,
        );
        assert.deepEqual(
          (
            await db.query<{ r: any }>(
              "select row_to_json(i) r from public.invoices i where id=$1",
              [inv],
            )
          ).rows[0].r,
          original,
        );
      },
    );
    await t.test(
      "reporting views, history, options, and mutation functions stay private",
      async () => {
        await assert.rejects(
          db.exec("delete from public.cost_stay_split_lines"),
          /permission denied/,
        );
        await assert.rejects(
          db.exec("update public.invoice_reporting_links set retired_at=null"),
          /permission denied/,
        );
        const options = (
          await db.query<{ r: any }>(
            "select public.reporting_assignment_options() r",
          )
        ).rows[0].r;
        assert.equal(options.horses.length, 2);
        assert.equal(options.stays.length, 3);
        await assert.rejects(
          db.exec("select public.stay_cash_report('2026-02-01','2026-01-01')"),
          /valid reporting period/,
        );
        await login(db, outsiderId);
        for (const name of [
          "invoice_reporting_links",
          "cost_stay_splits",
          "cost_stay_split_lines",
          "reporting_receipts",
          "reporting_cost_sources",
          "reporting_stay_costs",
        ])
          assert.equal(
            (await db.query(`select * from public.${name}`)).rows.length,
            0,
          );
        await assert.rejects(bundle(), /Administrator access/);
        await assert.rejects(
          db.exec("select public.reporting_assignment_options()"),
          /Administrator access/,
        );
        await assert.rejects(link(id(60), ha, sa), /Administrator access/);
        await assert.rejects(
          split(id(61), direct, null, ha, directRows),
          /Administrator access/,
        );
        await assert.rejects(
          db.query(
            "select public.clear_invoice_reporting_link($1,'Unauthorized')",
            [inv],
          ),
          /Administrator access/,
        );
        await assert.rejects(
          db.query(
            "select public.clear_cost_stay_split($1,null,$2,'Unauthorized')",
            [direct, ha],
          ),
          /Administrator access/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
