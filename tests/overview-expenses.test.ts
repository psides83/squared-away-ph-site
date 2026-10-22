import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import { expenseFilters, expenseListHref } from "../src/lib/expense-filters.ts";
const id = (n: number) =>
  `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("expense filters validate dates and keep literal search and filters across pages", () => {
  assert.throws(() => expenseFilters({ from: "2026-02-30" }), /valid date/);
  assert.throws(
    () => expenseFilters({ from: "2026-02-01", to: "2026-01-01" }),
    /start date/,
  );
  assert.throws(() => expenseFilters({ status: "other" }), /valid status/);
  assert.throws(() => expenseFilters({ horse: "not-a-horse" }), /valid record/);
  const f = expenseFilters({ horse: "shared", q: "  hay & 10%  ", page: "2" });
  assert.equal(f.p_shared, true);
  assert.equal(f.p_horse, null);
  assert.equal(f.p_query, "hay & 10%");
  assert.equal(f.p_page, 2);
  const url = new URL(
    expenseListHref({ horse: "shared", q: "hay & 10%", status: "unpaid" }, 2),
    "https://example.com",
  );
  assert.equal(url.searchParams.get("q"), "hay & 10%");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("status"), "unpaid");
});

test("expense search combines literal text, direct assignment, dates, categories, status, and exact pagination", async () => {
  const db = await inventoryDatabase();
  try {
    await db.exec(`reset role;
      insert into public.horses(id,barn_name) values('${id(1)}','Search horse');
      insert into public.expenses(id,expense_date,paid_on,horse_id,category_id,vendor,notes,amount_cents)
        select '${id(2)}','2026-01-01','2026-01-02','${id(1)}',id,'Feed Store','Literal 10% supplement',1000 from public.expense_categories where name='Feed';
      insert into public.expenses(expense_date,category_id,vendor,amount_cents)
        select '2026-01-31',id,'Shared Hay',200 from public.expense_categories where name='Hay';
      insert into public.expenses(expense_date,paid_on,category_id,vendor,amount_cents,voided_at)
        select '2026-01-31','2026-01-31',id,'Voided',500,now() from public.expense_categories where name='Hay';
      insert into public.expenses(expense_date,category_id,vendor,amount_cents)
        select '2026-02-01',id,'Later',100 from public.expense_categories where name='Other';
      insert into public.expenses(expense_date,category_id,vendor,amount_cents)
        select '2025-01-01',id,'Page test',1 from public.expense_categories cross join generate_series(1,26) where name='Other';
    `);
    await login(db, adminId);
    const search = async (p: Parameters<typeof expenseFilters>[0]) => {
      const f = expenseFilters(p);
      return (
        await db.query<{ r: any }>(
          "select public.search_expenses($1,$2,$3,$4,$5,$6,$7,$8) r",
          Object.values(f),
        )
      ).rows[0].r;
    };
    let r = await search({ from: "2026-01-01", to: "2026-01-31" });
    assert.equal(r.total, 3);
    assert.equal((await search({ q: "10%" })).total, 1);
    assert.equal((await search({ q: "%" })).total, 1);
    assert.equal((await search({ q: "',or(true)" })).total, 0);
    assert.equal((await search({ q: "feed store" })).total, 1);
    assert.equal(
      (
        await search({
          horse: id(1),
          status: "paid",
          from: "2026-01-01",
          to: "2026-01-01",
        })
      ).total,
      1,
    );
    assert.equal((await search({ horse: "shared", status: "paid" })).total, 0);
    assert.equal((await search({ status: "voided" })).total, 1);
    assert.equal(
      (await search({ from: "2026-01-01", status: "unpaid" })).total,
      2,
    );
    const category = (
      await db.query<{ id: string }>(
        "select id from public.expense_categories where name='Feed'",
      )
    ).rows[0].id;
    assert.equal((await search({ category })).total, 1);
    const first = await search({ q: "Page test", page: "1" }),
      second = await search({ q: "Page test", page: "2" });
    assert.equal(first.total, 26);
    assert.equal(first.rows.length, 25);
    assert.equal(second.rows.length, 1);
    assert.equal(
      new Set([...first.rows, ...second.rows].map((r: any) => r.id)).size,
      26,
    );
    await assert.rejects(
      db.exec("select public.search_expenses(p_status=>'invalid')"),
      /valid expense filters/,
    );
    await login(db, outsiderId);
    await assert.rejects(search({}), /Administrator access/);
  } finally {
    await db.close();
  }
});

test("financial overview uses Chicago month dates and excludes voids, reversed payments, and future receipts", async () => {
  const db = await inventoryDatabase();
  try {
    const day = (
      await db.query<{ d: string }>(
        "select to_char((now() at time zone 'America/Chicago')::date,'YYYY-MM-DD') d",
      )
    ).rows[0].d;
    await db.exec(`reset role;
      insert into public.customers(id,name) values('${id(1)}','Dashboard customer');
      insert into public.horses(id,barn_name) values('${id(2)}','Dashboard horse');
      insert into public.invoices(id,customer_id,status,issue_date,due_date,issued_total_cents,issued_at) values
        ('${id(3)}','${id(1)}','issued','2020-01-01','2020-01-02',10000,now()),
        ('${id(4)}','${id(1)}','draft','2020-01-01','2020-01-02',90000,null);
      insert into public.invoice_payments(id,invoice_id,paid_on,amount_cents,method,reversed_at) values
        (gen_random_uuid(),'${id(3)}','${day}',3000,'cash',null),
        (gen_random_uuid(),'${id(3)}','${day}',500,'cash',now()),
        (gen_random_uuid(),'${id(3)}','${day}'::date+1,1000,'cash',null);
      insert into public.expenses(expense_date,paid_on,category_id,amount_cents)
        select '${day}','${day}',id,1000 from public.expense_categories where name='Other';
      insert into public.expenses(expense_date,paid_on,category_id,amount_cents,voided_at)
        select '${day}','${day}',id,9000,now() from public.expense_categories where name='Other';
      insert into public.training_entries(horse_id,kind,entry_date,title,notes)
        values('${id(2)}','note','${day}','Progress update','Private details');
    `);
    await login(db, adminId);
    const read = async () =>
      (await db.query<{ r: any }>("select public.admin_financial_overview() r"))
        .rows[0].r;
    const r = await read();
    assert.equal(r.as_of, day);
    assert.equal(r.month_from, `${day.slice(0, 7)}-01`);
    assert.equal(r.received_cents, 3000);
    assert.equal(r.spent_cents, 1000);
    assert.equal(r.net_cents, 2000);
    assert.equal(r.outstanding_cents, 6000);
    assert.equal(r.overdue_cents, 6000);
    assert.equal(r.outstanding_count, 1);
    assert.equal(r.overdue_count, 1);
    assert.equal(r.recent.length, 8);
    assert.ok(
      r.recent.some(
        (e: any) =>
          e.kind === "training" && e.detail.includes("Progress update"),
      ),
    );
    assert.ok(r.recent.some((e: any) => e.label === "Payment reversed"));
    for (const e of r.recent) {
      assert.ok(e.href.startsWith("/admin/"));
      assert.ok(!JSON.stringify(e).includes("Private details"));
    }
    await login(db, outsiderId);
    await assert.rejects(read(), /Administrator access/);
  } finally {
    await db.close();
  }
});
