import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
test("expense follow-up separates original costs, fees, invoice balances, and split boarding claims", async () => {
  const db = await inventoryDatabase();
  try {
    const customers = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('First owner'),('Second owner') returning id",
      )
    ).rows;
    const horse = (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values('Horse') returning id",
      )
    ).rows[0].id;
    for (const c of customers)
      await db.query(
        "insert into horse_customers(horse_id,customer_id) values($1,$2)",
        [horse, c.id],
      );
    const stays: string[] = [];
    for (const [i, from, to] of [
      [0, "2026-01-01", "2026-01-31"],
      [1, "2026-02-01", "2026-02-28"],
    ] as const)
      stays.push(
        (
          await db.query<{ id: string }>(
            "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,boarding_billing) values($1,$2,$3,$4,0,'at_cost') returning id",
            [horse, customers[i].id, from, to],
          )
        ).rows[0].id,
      );
    const category = (
      await db.query<{ id: string }>(
        "select id from expense_categories where name='Vet'",
      )
    ).rows[0].id;
    async function expense(amount: number, reimbursable: boolean) {
      return (
        await db.query<{ id: string }>(
          "select save_expense(null,$1::jsonb) id",
          [
            JSON.stringify({
              expense_date: "2026-01-15",
              horse_id: horse,
              category_id: category,
              amount_cents: amount,
              reimbursable,
              vendor: "Provider",
            }),
          ],
        )
      ).rows[0].id;
    }
    async function invoice(i: number) {
      const id = crypto.randomUUID();
      await db.query("select create_invoice($1,$2,$3,$4,$4,$5,$4)", [
        id,
        customers[i].id,
        stays[i],
        i === 0 ? "2026-01-31" : "2026-02-28",
        i === 0 ? "2026-01-01" : "2026-02-01",
      ]);
      return id;
    }
    type Row = {
      expense_id: string;
      receipt_count: number;
      draft_cost_cents: number;
      issued_cost_cents: number;
      invoices: {
        id: string;
        balance_cents: number;
        charge_cents: number;
        cost_cents: number;
      }[];
    };
    async function follow(ids: string[]) {
      return (
        await db.query<{ result: Row[] }>(
          "select expense_followup($1::uuid[]) result",
          [ids],
        )
      ).rows[0].result;
    }
    const full = await expense(10000, true),
      split = await expense(20000, false),
      unbilled = await expense(5000, true);
    await db.query(
      "insert into expense_receipts(expense_id,object_path,file_name,content_type,size_bytes) values($1,$2,'receipt.pdf','application/pdf',100)",
      [full, `${full}/receipt.pdf`],
    );
    const fullInvoice = await invoice(0);
    await db.query("select add_expense_chargeback($1,$2,2500)", [
      fullInvoice,
      full,
    ]);
    await db.query("select add_expense_chargeback($1,$2,2500)", [
      fullInvoice,
      full,
    ]);
    let row = (await follow([full, full]))[0];
    assert.equal(Number(row.draft_cost_cents), 10000);
    assert.equal(row.invoices.length, 1);
    assert.equal(Number(row.receipt_count), 1);
    await db.query("select finalize_invoice($1)", [fullInvoice]);
    await db.query(
      "select record_invoice_payment($1,$2,2500,'2026-02-01','cash')",
      [crypto.randomUUID(), fullInvoice],
    );
    row = (await follow([full]))[0];
    assert.equal(Number(row.issued_cost_cents), 10000);
    assert.equal(Number(row.draft_cost_cents), 0);
    assert.equal(Number(row.invoices[0].charge_cents), 12500);
    assert.equal(Number(row.invoices[0].balance_cents), 10000);
    const revision = crypto.randomUUID();
    await db.query(
      "select save_cost_stay_split($1,$2,null,$3,$4::jsonb,'Reviewed portions')",
      [
        revision,
        split,
        horse,
        JSON.stringify([
          { stay_id: stays[0], amount_cents: 6000 },
          { stay_id: stays[1], amount_cents: 4000 },
        ]),
      ],
    );
    const boardDraft = await invoice(0),
      boardIssued = await invoice(1);
    await db.query("select add_actual_boarding($1,$2)", [boardDraft, revision]);
    await db.query("select add_actual_boarding($1,$2)", [
      boardIssued,
      revision,
    ]);
    await db.query("select finalize_invoice($1)", [boardIssued]);
    row = (await follow([split]))[0];
    assert.equal(Number(row.draft_cost_cents), 6000);
    assert.equal(Number(row.issued_cost_cents), 4000);
    assert.equal(row.invoices.length, 2);
    await db.query("select void_invoice($1,'Correct this bill')", [
      boardIssued,
    ]);
    row = (await follow([split]))[0];
    assert.equal(Number(row.issued_cost_cents), 0);
    assert.equal(row.invoices.length, 1);
    assert.deepEqual((await follow([unbilled]))[0].invoices, []);
    assert.deepEqual(await follow([]), []);
    await assert.rejects(follow(Array(101).fill(full)), /at most 100/);
    await login(db, outsiderId);
    await assert.rejects(follow([full]), /Administrator/);
  } finally {
    await db.close();
  }
});
