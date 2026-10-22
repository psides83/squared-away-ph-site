import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  invoiceHeaderValues,
  paymentValues,
  invoiceStatus,
  securePaymentLink,
} from "../src/lib/invoices.ts";

test("invoice inputs validate dates, positive payments, and safe payment links", () => {
  const form = new FormData();
  form.set("issue_date", "2026-01-02");
  form.set("due_date", "2026-01-01");
  assert.throws(() => invoiceHeaderValues(form), /Due date/);
  form.set("amount", "0");
  assert.throws(() => paymentValues(form), /positive/);
  assert.equal(securePaymentLink("javascript:alert(1)"), null);
  assert.equal(securePaymentLink("https://user:pass@example.com"), null);
  assert.equal(
    securePaymentLink("https://paypal.me/example"),
    "https://paypal.me/example",
  );
  assert.equal(
    invoiceStatus(
      { status: "issued", balance_cents: 1, due_date: "2026-01-01" },
      "2026-01-02",
    ),
    "Overdue",
  );
  assert.equal(
    invoiceStatus(
      { status: "issued", balance_cents: 0, due_date: "2026-01-01" },
      "2026-01-02",
    ),
    "Paid",
  );
  assert.equal(
    invoiceStatus(
      { status: "draft", balance_cents: 0, due_date: "2026-01-01" },
      "2026-01-02",
    ),
    "Draft",
  );
});

test("invoice lifecycle, source reservations, immutable snapshots, and partial payments", async (t) => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into public.customers(name,email,phone) values('Original owner','owner@example.com','555-0100') returning id",
      )
    ).rows[0].id;
    const customer2 = (
      await db.query<{ id: string }>(
        "insert into public.customers(name) values('Another owner') returning id",
      )
    ).rows[0].id;
    const horse = (
      await db.query<{ id: string }>(
        "insert into public.horses(barn_name) values('Billing horse') returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into public.horse_customers(horse_id,customer_id) values($1,$2)",
      [horse, customer],
    );
    const stay = (
      await db.query<{ id: string }>(
        "insert into public.training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,proration,invoice_due_days) values($1,$2,'2026-01-01','2026-01-05',155000,'calendar_days',7) returning id",
        [horse, customer],
      )
    ).rows[0].id;
    const category = (
      await db.query<{ id: string }>(
        "select id from public.expense_categories where name='Vet'",
      )
    ).rows[0].id;
    const expense = (
      await db.query<{ id: string }>(
        "select public.save_expense(null,$1::jsonb) as id",
        [
          JSON.stringify({
            expense_date: "2026-01-03",
            category_id: category,
            horse_id: horse,
            amount_cents: 10000,
            reimbursable: true,
            vendor: "Vet",
          }),
        ],
      )
    ).rows[0].id;
    async function draft(linked = true, request = crypto.randomUUID()) {
      return (
        await db.query<{ id: string }>(
          "select public.create_invoice($1,$2,$3,'2026-01-06','2026-01-13',$4,$5,null) as id",
          [
            request,
            customer,
            linked ? stay : null,
            linked ? "2026-01-01" : null,
            linked ? "2026-01-05" : null,
          ],
        )
      ).rows[0].id;
    }
    async function totals(id: string) {
      const r = (
        await db.query<{
          base_cents: string;
          paid_cents: string;
          balance_cents: string;
          adjustment_cents: string;
          total_cents: string;
        }>("select * from public.invoice_totals where id=$1", [id])
      ).rows[0];
      return {
        base: Number(r.base_cents),
        paid: Number(r.paid_cents),
        balance: Number(r.balance_cents),
        adjustments: Number(r.adjustment_cents),
        total: Number(r.total_cents),
      };
    }
    const invoice = await draft();
    let trainingLine = "";
    await t.test(
      "generation rejects unmarked days, charges worked/rest once, and reserves source days",
      async () => {
        await assert.rejects(
          db.query("select public.add_calendar_training($1)", [invoice]),
          /Classify every/,
        );
        await db.query(
          "select public.set_training_days($1,'2026-01-01','2026-01-02','worked',null)",
          [stay],
        );
        await db.query(
          "select public.set_training_days($1,'2026-01-03','2026-01-03','rest',null)",
          [stay],
        );
        await db.query(
          "select public.set_training_days($1,'2026-01-04','2026-01-05','nonbillable',null)",
          [stay],
        );
        trainingLine = (
          await db.query<{ id: string }>(
            "select public.add_calendar_training($1) as id",
            [invoice],
          )
        ).rows[0].id;
        assert.equal((await totals(invoice)).base, 15000);
        await assert.rejects(
          db.query(
            "select public.set_training_days($1,'2026-01-01','2026-01-01','nonbillable','Change')",
            [stay],
          ),
          /reserved/,
        );
        const second = await draft();
        await assert.rejects(
          db.query("select public.add_calendar_training($1)", [second]),
          /duplicate key/,
        );
        assert.equal(
          (
            await db.query(
              "select * from public.invoice_lines where invoice_id=$1",
              [second],
            )
          ).rows.length,
          0,
        );
        await db.query("select public.remove_invoice_line($1)", [trainingLine]);
        assert.equal(
          (await db.query("select * from public.invoice_day_claims")).rows
            .length,
          0,
        );
        trainingLine = (
          await db.query<{ id: string }>(
            "select public.add_calendar_training($1) as id",
            [invoice],
          )
        ).rows[0].id;
      },
    );
    await t.test(
      "charge-backs preserve original cost, show fees separately, and cannot be billed or changed twice",
      async () => {
        const first = (
          await db.query(
            "select public.add_expense_chargeback($1,$2,500) as id",
            [invoice, expense],
          )
        ).rows;
        assert.deepEqual(
          (
            await db.query(
              "select public.add_expense_chargeback($1,$2,500) as id",
              [invoice, expense],
            )
          ).rows,
          first,
        );
        assert.equal((await totals(invoice)).base, 25500);
        const second = await draft();
        await assert.rejects(
          db.query("select public.add_expense_chargeback($1,$2,0)", [
            second,
            expense,
          ]),
          /duplicate key/,
        );
        await assert.rejects(
          db.query("select public.set_expense_status($1,null,true)", [expense]),
          /reserved/,
        );
        await db.query(
          "select public.set_expense_status($1,'2026-01-04',false)",
          [expense],
        );
        assert.equal(
          (
            await db.query(
              "select amount_cents from public.expenses where id=$1",
              [expense],
            )
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      "finalization assigns one number and freezes customer, business, pricing, and payment instructions",
      async () => {
        await db.exec(
          "update public.business_settings set business_phone='555-0200',payment_instructions='Original instructions'",
        );
        const number = (
          await db.query("select public.finalize_invoice($1) as number", [
            invoice,
          ])
        ).rows;
        assert.deepEqual(
          (
            await db.query("select public.finalize_invoice($1) as number", [
              invoice,
            ])
          ).rows,
          number,
        );
        await db.query(
          "update public.customers set name='Renamed owner',email='new@example.com' where id=$1",
          [customer],
        );
        await db.exec(
          "update public.business_settings set payment_instructions='Changed instructions',business_phone='555-0300'",
        );
        await db.query(
          "update public.training_stays set monthly_rate_cents=999999 where id=$1",
          [stay],
        );
        const snapshots = (
          await db.query<{
            customer_snapshot: { name: string; email: string };
            business_snapshot: { payment_instructions: string };
            issued_total_cents: number;
          }>("select * from public.invoices where id=$1", [invoice])
        ).rows[0];
        assert.equal(snapshots.customer_snapshot.name, "Original owner");
        assert.equal(snapshots.customer_snapshot.email, "owner@example.com");
        assert.equal(
          snapshots.business_snapshot.payment_instructions,
          "Original instructions",
        );
        assert.equal(snapshots.issued_total_cents, 25500);
        await assert.rejects(
          db.query("select public.remove_invoice_line($1)", [trainingLine]),
          /Only draft/,
        );
        await assert.rejects(
          db.query(
            "update public.invoices set issued_total_cents=1 where id=$1",
            [invoice],
          ),
          /permission denied/,
        );
        await assert.rejects(
          db.query(
            "select public.update_invoice_header($1,'2026-01-01','2026-01-01',null)",
            [invoice],
          ),
          /draft/,
        );
      },
    );
    let payment = "";
    await t.test(
      "partial payments derive remaining balance; retries, overpayments, and unsafe credits are handled",
      async () => {
        payment = crypto.randomUUID();
        const record = () =>
          db.query(
            "select public.record_invoice_payment($1,$2,10000,'2026-01-10','venmo','ref',null) as id",
            [payment, invoice],
          );
        const first = (await record()).rows;
        assert.deepEqual((await record()).rows, first);
        assert.deepEqual(await totals(invoice), {
          base: 25500,
          paid: 10000,
          balance: 15500,
          adjustments: 0,
          total: 25500,
        });
        await assert.rejects(
          db.query(
            "select public.record_invoice_payment($1,$2,16000,'2026-01-10','cash',null,null)",
            [crypto.randomUUID(), invoice],
          ),
          /remaining balance/,
        );
        const adjustment = crypto.randomUUID();
        await db.query(
          "select public.adjust_invoice($1,$2,-500,'2026-01-10','Courtesy credit')",
          [adjustment, invoice],
        );
        await db.query(
          "select public.adjust_invoice($1,$2,-500,'2026-01-10','Courtesy credit')",
          [adjustment, invoice],
        );
        assert.deepEqual(await totals(invoice), {
          base: 25500,
          paid: 10000,
          balance: 15000,
          adjustments: -500,
          total: 25000,
        });
        await assert.rejects(
          db.query(
            "select public.adjust_invoice($1,$2,-16000,'2026-01-10','Too much credit')",
            [crypto.randomUUID(), invoice],
          ),
          /below payments/,
        );
        await assert.rejects(
          db.query("select public.void_invoice($1,'Void')", [invoice]),
          /Reverse recorded payments/,
        );
      },
    );
    await t.test(
      "payment reversals retain records and voiding releases linked charges without erasing the bill",
      async () => {
        await db.query(
          "select public.reverse_invoice_payment($1,'Recorded in error')",
          [payment],
        );
        await db.query("select public.reverse_invoice_payment($1,'Retry')", [
          payment,
        ]);
        assert.equal((await totals(invoice)).paid, 0);
        assert.equal((await totals(invoice)).balance, 25000);
        await db.query(
          "select public.void_invoice($1,'Replace with corrected bill')",
          [invoice],
        );
        assert.equal(
          (
            await db.query<{ status: string }>(
              "select status from public.invoices where id=$1",
              [invoice],
            )
          ).rows[0].status,
          "void",
        );
        assert.equal(
          (
            await db.query(
              "select * from public.invoice_lines where invoice_id=$1",
              [invoice],
            )
          ).rows.length,
          2,
        );
        assert.equal(
          (await db.query("select * from public.invoice_expense_claims")).rows
            .length,
          0,
        );
        assert.equal(
          (await db.query("select * from public.invoice_day_claims")).rows
            .length,
          0,
        );
        assert.equal(
          (
            await db.query(
              "select * from public.invoice_payments where invoice_id=$1",
              [invoice],
            )
          ).rows.length,
          1,
        );
        await db.query(
          "select public.set_training_days($1,'2026-01-01','2026-01-01','nonbillable','Now released')",
          [stay],
        );
      },
    );
    await t.test(
      "draft creation and manual lines are retry-safe; totals cannot be negative at finalization",
      async () => {
        const request = crypto.randomUUID();
        const id = await draft(false, request);
        assert.equal(await draft(false, request), id);
        const line = crypto.randomUUID();
        const add = () =>
          db.query(
            "select public.add_invoice_line($1,$2,'Manual credit',-100)",
            [line, id],
          );
        await add();
        await add();
        assert.equal(
          (
            await db.query(
              "select id from public.invoice_lines where invoice_id=$1",
              [id],
            )
          ).rows.length,
          1,
        );
        await assert.rejects(
          db.query("select public.finalize_invoice($1)", [id]),
          /total must be/,
        );
        await assert.rejects(
          db.query(
            "select public.create_invoice($1,$2,$3,'2026-01-06','2026-01-13','2026-01-01','2026-01-05',null)",
            [crypto.randomUUID(), customer2, stay],
          ),
          /selected billing customer/,
        );
      },
    );
    await t.test(
      "non-admin users cannot read totals or call billing mutations",
      async () => {
        await login(db, outsiderId);
        for (const table of [
          "invoices",
          "invoice_lines",
          "invoice_payments",
          "invoice_adjustments",
          "invoice_totals",
          "invoice_day_claims",
          "invoice_expense_claims",
        ])
          assert.deepEqual(
            (await db.query(`select * from public.${table}`)).rows,
            [],
          );
        await assert.rejects(draft(), /Administrator access required/);
        await assert.rejects(
          db.query("select public.finalize_invoice($1)", [invoice]),
          /Administrator access required/,
        );
        await assert.rejects(
          db.query(
            "select public.record_invoice_payment($1,$2,1,'2026-01-10','cash')",
            [crypto.randomUUID(), invoice],
          ),
          /Administrator access required/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
