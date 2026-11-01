import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import type { ManualServiceOptions } from "../src/lib/manual-service-periods.ts";
import { manualServicePeriodValues } from "../src/lib/manual-service-periods.ts";
import type { ServiceProfitability } from "../src/lib/service-profitability.ts";
import type { EntityMargins } from "../src/lib/service-assignments.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const c = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Owner') returning id",
    )
  ).rows[0].id;
  const h = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('Rio') returning id",
    )
  ).rows[0].id;
  const stay = (
    await db.query<{ id: string }>(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,'2026-01-01','2026-01-31',0) returning id",
      [h, c],
    )
  ).rows[0].id;
  const invoice = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,null,'2026-03-01','2026-03-08',null,null)",
    [invoice, c],
  );
  await db.query(
    "select set_invoice_reporting_link($1,$2,$3,$4,'Horse and stay')",
    [crypto.randomUUID(), invoice, h, stay],
  );
  const line = async (service: string, amount = 1001) => {
    const id = crypto.randomUUID();
    await db.query("select add_invoice_line($1,$2,'Manual service',$3,$4)", [
      id,
      invoice,
      amount,
      service,
    ]);
    return id;
  };
  const options = async (page = 1) =>
    (
      await db.query<{ r: ManualServiceOptions }>(
        "select manual_service_reporting($1,$2) r",
        [invoice, page],
      )
    ).rows[0].r;
  const save = async (
    id: string,
    request = crypto.randomUUID(),
    current: string | null = null,
    from = "2026-01-01",
    to = "2026-01-03",
    clear = false,
    token?: string,
  ) => {
    const l = (await options()).lines.find((x) => x.id === id)!;
    const source = clear ? l.current : l;
    return db.query(
      "select set_manual_service_period($1,$2,$3,$4,$5,$6,$7,$8,'Reviewed source dates',$9,$10)",
      [
        request,
        id,
        current,
        source!.horse_id,
        source!.stay_id,
        source!.amount_cents,
        from,
        to,
        clear,
        token ?? (clear ? l.current!.source_token : l.source_token),
      ],
    );
  };
  const report = async (from = "2026-01-01", to = "2026-01-03") =>
    (
      await db.query<{ r: ServiceProfitability }>(
        "select service_profitability($1,$2) r",
        [from, to],
      )
    ).rows[0].r;
  return { db, c, h, stay, invoice, line, options, save, report };
}
test("manual training follows fully classified worked/rest days, rejects stale editors and invalidates changed classifications without changing bills", async () => {
  const { db, stay, invoice, line, options, save, report } = await fixture();
  try {
    const id = await line("training");
    await assert.rejects(save(id), /Classify every/);
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-01','worked')",
      [stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-02','2026-01-02','rest')",
      [stay],
    );
    await db.query(
      "select set_training_days($1,'2026-01-03','2026-01-03','nonbillable')",
      [stay],
    );
    const token = (await options()).lines[0].source_token!;
    const req = crypto.randomUUID();
    await save(id, req);
    await save(id, req);
    assert.equal(
      (await report()).services.find((x) => x.service === "training")
        ?.draft_cents,
      1001,
    );
    await db.query("select finalize_invoice($1)", [invoice]);
    assert.equal(
      (await report("2026-01-01", "2026-01-01")).services.find(
        (x) => x.service === "training",
      )?.gross_cents,
      501,
    );
    assert.equal(
      (await report("2026-01-02", "2026-01-02")).services.find(
        (x) => x.service === "training",
      )?.gross_cents,
      500,
    );
    assert.equal(
      (await report("2026-01-03", "2026-01-03")).services.find(
        (x) => x.service === "training",
      )?.gross_cents,
      0,
    );
    const entity = (
      await db.query<{ r: EntityMargins }>(
        "select service_entity_margins('2026-01-01','2026-01-03','stay') r",
      )
    ).rows[0].r;
    assert.equal(entity.rows[0].stay_id, stay);
    assert.equal(
      entity.rows[0].services.find((x) => x.service === "training")
        ?.gross_cents,
      1001,
    );
    await db.query(
      "select set_training_days($1,'2026-01-02','2026-01-02','nonbillable')",
      [stay],
    );
    assert.equal((await options()).lines[0].valid, false);
    assert.equal((await report()).unsupported_revenue_count, 1);
    await assert.rejects(
      save(
        id,
        crypto.randomUUID(),
        req,
        "2026-01-01",
        "2026-01-03",
        false,
        token,
      ),
      /changed/,
    );
    const next = crypto.randomUUID();
    await save(id, next, req);
    assert.equal(
      (await report("2026-01-01", "2026-01-01")).services.find(
        (x) => x.service === "training",
      )?.gross_cents,
      1001,
    );
    await save(id, req, null, "2026-01-01", "2026-01-03", false, token);
    assert.equal((await options()).lines[0].current?.id, next);
    await db.query(
      "select set_training_days($1,'2026-01-01','2026-01-01','nonbillable')",
      [stay],
    );
    await assert.rejects(save(id, crypto.randomUUID(), next), /No worked/);
    assert.equal(
      (await db.query("select * from invoice_day_claims")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select issued_total_cents n from invoices where id=$1",
          [invoice],
        )
      ).rows[0].n,
      1001,
    );
  } finally {
    await db.close();
  }
});
test("manual board charges and credits use signed calendar days and reviewed invoice attribution in business, horse, stay and combined reports", async () => {
  const { db, stay, invoice, line, save, report } = await fixture();
  try {
    const a = await line("boarding"),
      b = await line("boarding", -101);
    await save(a);
    await save(b);
    await db.query("select finalize_invoice($1)", [invoice]);
    let r = await report();
    assert.equal(
      r.services.find((x) => x.service === "board")?.gross_cents,
      900,
    );
    for (const d of ["01", "02", "03"])
      assert.equal(
        (await report(`2026-01-${d}`, `2026-01-${d}`)).services.find(
          (x) => x.service === "board",
        )?.gross_cents,
        300,
      );
    const adj = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-51,'2026-03-04','Board credit')",
      [adj, invoice],
    );
    await db.query(
      "select set_adjustment_reporting($1,$2,null,0,0,51,0,'Board')",
      [crypto.randomUUID(), adj],
    );
    r = await report();
    assert.equal(
      r.services.find((x) => x.service === "board")?.adjustment_cents,
      -51,
    );
    assert.equal(r.unresolved_adjustment_count, 0);
    for (const scope of ["horse", "stay"]) {
      const e = (
        await db.query<{ r: EntityMargins }>(
          "select service_entity_margins('2026-01-01','2026-01-03',$1) r",
          [scope],
        )
      ).rows[0].r;
      assert.equal(
        e.rows[0].services.find((x) => x.service === "board")?.gross_cents,
        900,
      );
      const combined = (
        await db.query<{ r: { rows: { net_cents: number }[] } }>(
          "select combined_entity_profitability('2026-01-01','2026-01-03',$1) r",
          [scope],
        )
      ).rows[0].r;
      assert.equal(combined.rows[0].net_cents, 849);
    }
    assert.equal(
      (await db.query("select * from invoice_boarding_claims")).rows.length,
      0,
    );
    await db.query(
      "update training_stays set arrival_date='2026-01-02' where id=$1",
      [stay],
    );
    assert.ok((await report()).unsupported_revenue_count > 0);
  } finally {
    await db.close();
  }
});
test("manual service reviews retain clear/delete history, guard source identity and provide complete paging with administrator-only access", async () => {
  const { db, h, invoice, line, options, save } = await fixture();
  try {
    const id = await line("boarding");
    const req = crypto.randomUUID();
    await save(id, req);
    await assert.rejects(
      save(id, req, null, "2026-01-02", "2026-01-03"),
      /different values/,
    );
    const clear = crypto.randomUUID();
    await save(id, clear, req, "2026-01-01", "2026-01-03", true);
    await save(id, req);
    assert.equal((await options()).lines[0].valid, false);
    await db.query("select remove_invoice_line($1)", [id]);
    assert.equal((await options()).count, 0);
    const history = (
      await db.query<{ n: number }>(
        "select count(*)::integer n from manual_service_periods where line_id=$1",
        [id],
      )
    ).rows[0].n;
    assert.equal(history, 2);
    for (let n = 0; n < 27; n++) await line("boarding");
    assert.equal((await options()).count, 27);
    assert.equal((await options()).lines.length, 25);
    assert.equal((await options(2)).lines.length, 2);
    await assert.rejects(options(0), /valid page/);
    await assert.rejects(
      db.query("select * from manual_service_sources"),
      /permission denied/,
    );
    await login(db, outsiderId);
    await assert.rejects(options(), /Administrator/);
    assert.equal(
      (await db.query("select * from manual_service_periods")).rows.length,
      0,
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(options(), /permission denied/);
  } finally {
    await db.close();
  }
});
test("manual service input retains signed cents and an exact source token", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    line_id: crypto.randomUUID(),
    horse_id: crypto.randomUUID(),
    amount_cents: "-101",
    from: "2026-01-01",
    to: "2026-01-03",
    reason: "Review",
    source_token: "a".repeat(32),
  }))
    f.set(k, v);
  assert.equal(manualServicePeriodValues(f).p_amount, -101);
  f.set("source_token", "old");
  assert.throws(() => manualServicePeriodValues(f));
});
