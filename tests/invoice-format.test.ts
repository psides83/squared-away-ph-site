import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  businessSettingsValues,
  settingsFormValues,
  stayServiceFormDefaults,
} from "../src/lib/business-settings.ts";

test("feed and board defaults preserve cents, blank values, zero rates and existing stay terms", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    default_billing_day: "1",
    default_proration: "calendar_days",
    default_invoice_due_days: "0",
    default_feed_monthly_rate: "225.75",
    default_boarding_monthly_rate: "0",
  }))
    form.set(key, value);
  const settings = businessSettingsValues(form);
  assert.equal(settings.default_feed_monthly_cents, 22575);
  assert.equal(settings.default_boarding_monthly_cents, 0);
  assert.equal(
    settingsFormValues(settings).default_feed_monthly_rate,
    "225.75",
  );
  assert.deepEqual(stayServiceFormDefaults(undefined, settings), {
    feedMode: "separate_monthly",
    feedCents: 22575,
    boardingMode: "separate_monthly",
    boardingCents: 0,
  });
  assert.deepEqual(
    stayServiceFormDefaults(
      {
        feed_billing: "included",
        feed_monthly_cents: null,
        boarding_billing: "at_cost",
        boarding_monthly_cents: null,
      },
      settings,
    ),
    {
      feedMode: "included",
      feedCents: null,
      boardingMode: "at_cost",
      boardingCents: null,
    },
  );
  for (const field of [
    "default_feed_monthly_rate",
    "default_boarding_monthly_rate",
  ]) {
    const original = form.get(field)!;
    for (const bad of ["-1", "1.001", "1000000.01", "NaN"]) {
      form.set(field, bad);
      assert.throws(() => businessSettingsValues(form));
    }
    form.set(field, "");
    assert.equal(
      businessSettingsValues(form)[
        field === "default_feed_monthly_rate"
          ? "default_feed_monthly_cents"
          : "default_boarding_monthly_cents"
      ],
      null,
    );
    form.set(field, original);
  }
});

type Line = { id: string; description: string; amount_cents: number };
type Preview = { style: string; lines: Line[] };
type Portal = {
  lines: Line[];
  total_cents: number;
  base_cents: number;
  paid_cents: number;
  balance_cents: number;
  customer: { invoice_presentation?: string };
  adjustments: unknown[];
};
test("customer invoice formats preserve internal details and snapshot combined services only", async (t) => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name,email,invoice_presentation) values('Combined customer','combined@example.com','combined_services') returning id",
      )
    ).rows[0].id;
    const other = (
      await db.query<{ id: string }>(
        "insert into customers(name) values('Other customer') returning id",
      )
    ).rows[0].id;
    async function create(c = customer) {
      return (
        await db.query<{ id: string }>(
          "select create_invoice($1,$2,null,'2026-01-01','2026-01-01',null,null) id",
          [crypto.randomUUID(), c],
        )
      ).rows[0].id;
    }
    const invoice = await create();
    async function line(
      amount: number,
      category: string,
      description = category,
    ) {
      return db.query("select add_invoice_line($1,$2,$3,$4,$5)", [
        crypto.randomUUID(),
        invoice,
        description,
        amount,
        category,
      ]);
    }
    await line(100000, "training", "Training amount");
    await line(20000, "feed", "Feed amount");
    await line(30000, "boarding", "Board amount");
    await line(-1000, "feed", "Feed credit");
    await line(15000, "other", "Vet charge");
    async function preview(id = invoice) {
      return (
        await db.query<{ result: Preview }>(
          "select admin_invoice_presentation($1) result",
          [id],
        )
      ).rows[0].result;
    }
    await t.test(
      "combined preview keeps other charges separate and matches financial totals",
      async () => {
        const p = await preview();
        assert.equal(p.style, "combined_services");
        assert.equal(p.lines.length, 2);
        assert.equal(
          p.lines.find((l) => l.id === "combined-services")?.amount_cents,
          149000,
        );
        assert.equal(
          p.lines.find((l) => l.description === "Vet charge")?.amount_cents,
          15000,
        );
        assert.equal(
          (
            await db.query("select id from invoice_lines where invoice_id=$1", [
              invoice,
            ])
          ).rows.length,
          5,
        );
        assert.equal(
          p.lines.reduce((sum, l) => sum + l.amount_cents, 0),
          164000,
        );
        await db.query(
          "update customers set invoice_presentation='itemized' where id=$1",
          [customer],
        );
        assert.equal((await preview()).lines.length, 5);
        await db.query(
          "update customers set invoice_presentation='combined_services' where id=$1",
          [customer],
        );
        await db.query("select finalize_invoice($1)", [invoice]);
        await db.query(
          "update customers set invoice_presentation='itemized' where id=$1",
          [customer],
        );
        assert.equal((await preview()).style, "combined_services");
        assert.equal((await preview()).lines.length, 2);
        const next = await create();
        await db.query(
          "select add_invoice_line($1,$2,'Unclassified manual line',100)",
          [crypto.randomUUID(), next],
        );
        assert.equal((await preview(next)).style, "itemized");
      },
    );
    await t.test(
      "generated training and service charges receive categories without description guessing",
      async () => {
        const id = await create();
        await db.exec("reset role");
        await db.query(
          "insert into invoice_lines(invoice_id,description,amount_cents,kind,source_snapshot) values($1,'Generated training',100,'training','{}'),($1,'Generated feed',200,'service','{\"service\":\"feed\"}'),($1,'Generated boarding',300,'service','{\"service\":\"boarding\"}')",
          [id],
        );
        await login(db, adminId);
        const categories = (
          await db.query<{ billing_category: string }>(
            "select billing_category from invoice_lines where invoice_id=$1 order by amount_cents",
            [id],
          )
        ).rows.map((r) => r.billing_category);
        assert.deepEqual(categories, ["training", "feed", "boarding"]);
        await assert.rejects(
          db.query("select add_invoice_line($1,$2,'Bad category',1,'vet')", [
            crypto.randomUUID(),
            id,
          ]),
          /valid charge category/,
        );
        await assert.rejects(
          db.query(
            "update business_settings set default_feed_monthly_cents=-1",
          ),
          /check constraint/,
        );
      },
    );
    await t.test(
      "previously issued invoices without a saved format remain itemized",
      async () => {
        await db.exec("reset role");
        const legacy = (
          await db.query<{ id: string }>(
            "insert into invoices(id,customer_id,status,issue_date,due_date,issued_total_cents,customer_snapshot) values(gen_random_uuid(),$1,'issued','2026-01-01','2026-01-01',300,'{\"name\":\"Legacy customer\"}') returning id",
            [customer],
          )
        ).rows[0].id;
        await db.query(
          "insert into invoice_lines(invoice_id,description,amount_cents,kind,billing_category) values($1,'Old training',100,'manual','training'),($1,'Old feed',200,'manual','feed')",
          [legacy],
        );
        await login(db, adminId);
        await db.query(
          "update customers set invoice_presentation='combined_services' where id=$1",
          [customer],
        );
        assert.equal((await preview(legacy)).style, "itemized");
        assert.equal((await preview(legacy)).lines.length, 2);
        await db.query(
          "update customers set invoice_presentation='itemized' where id=$1",
          [customer],
        );
      },
    );
    const portalUser = "a0000000-0000-4000-8000-000000000001";
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email) values($1,'combined@example.com')",
      [portalUser],
    );
    await login(db, adminId);
    await db.query(
      "select grant_customer_portal($1,$2,'combined@example.com','Owner approved')",
      [crypto.randomUUID(), customer],
    );
    const foreign = await create(other);
    await db.query("select add_invoice_line($1,$2,'Other bill',100)", [
      crypto.randomUUID(),
      foreign,
    ]);
    await db.query("select finalize_invoice($1)", [foreign]);
    await t.test(
      "customer portal receives only grouped service amounts and their own invoices",
      async () => {
        await login(db, portalUser);
        const p = (
          await db.query<{ result: Portal }>(
            "select portal_invoice($1) result",
            [invoice],
          )
        ).rows[0].result;
        assert.equal(p.customer.invoice_presentation, "combined_services");
        assert.equal(p.lines.length, 2);
        assert.equal(p.base_cents, 164000);
        assert.equal(p.total_cents, 164000);
        assert.equal(
          p.lines.some((l) => l.description === "Feed amount"),
          false,
        );
        assert.equal(
          p.lines.some((l) => l.description === "Vet charge"),
          true,
        );
        assert.equal(
          (
            await db.query<{ result: Portal | null }>(
              "select portal_invoice($1) result",
              [foreign],
            )
          ).rows[0].result,
          null,
        );
        await assert.rejects(
          db.query("select invoice_display_lines($1,false)", [invoice]),
          /permission denied/,
        );
        await assert.rejects(
          db.query("select admin_invoice_presentation($1)", [invoice]),
          /Administrator/,
        );
      },
    );
    await t.test(
      "payments and later adjustments do not change the original display snapshot or billing totals",
      async () => {
        await login(db, adminId);
        await db.query(
          "select record_invoice_payment($1,$2,40000,'2026-01-02','cash')",
          [crypto.randomUUID(), invoice],
        );
        await db.query(
          "select adjust_invoice($1,$2,-4000,'2026-01-02','Reviewed correction')",
          [crypto.randomUUID(), invoice],
        );
        await login(db, portalUser);
        const p = (
          await db.query<{ result: Portal }>(
            "select portal_invoice($1) result",
            [invoice],
          )
        ).rows[0].result;
        assert.equal(p.lines.length, 2);
        assert.equal(p.total_cents, 160000);
        assert.equal(p.paid_cents, 40000);
        assert.equal(p.balance_cents, 120000);
        assert.equal(p.adjustments.length, 1);
        await login(db, outsiderId);
        await assert.rejects(
          db.query("select admin_invoice_presentation($1)", [invoice]),
          /Administrator/,
        );
      },
    );
  } finally {
    await db.close();
  }
});
