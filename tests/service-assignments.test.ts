import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  serviceAssignmentValues,
  type AssignmentOptions,
  type EntityMargins,
} from "../src/lib/service-assignments.ts";
import type { ServiceProfitability } from "../src/lib/service-profitability.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const c = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Owner') returning id",
    )
  ).rows[0].id;
  const horse = async (name: string) =>
    (
      await db.query<{ id: string }>(
        "insert into horses(barn_name) values($1) returning id",
        [name],
      )
    ).rows[0].id;
  const a = await horse("Alpha"),
    b = await horse("Bravo");
  const stay = async (h: string, from: string, to: string) =>
    (
      await db.query<{ id: string }>(
        "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents,proration) values($1,$2,$3,$4,0,'calendar_days') returning id",
        [h, c, from, to],
      )
    ).rows[0].id;
  const sa = await stay(a, "2026-01-15", "2026-01-31"),
    sb = await stay(b, "2026-02-01", "2026-02-05");
  const category = (
    await db.query<{ id: string }>(
      "select id from expense_categories where name='Boarding / facility'",
    )
  ).rows[0].id;
  const expense = (
    await db.query<{ id: string }>("select save_expense(null,$1,$2) id", [
      {
        category_id: category,
        expense_date: "2026-03-10",
        paid_on: "2026-03-10",
        amount_cents: 2001,
        vendor: "Facility",
        reimbursable: false,
      },
      crypto.randomUUID(),
    ])
  ).rows[0].id;
  const parent = crypto.randomUUID();
  await db.query(
    "select set_service_cost_allocation($1,$2,null,1001,1000,0,'2026-01-01','2026-02-28','Business cost',false)",
    [parent, expense],
  );
  const rows = [
    {
      service: "training",
      horse_id: a,
      stay_id: sa,
      amount_cents: 600,
      covered_from: "2026-01-15",
      covered_to: "2026-01-31",
    },
    {
      service: "board",
      horse_id: a,
      stay_id: sa,
      amount_cents: 500,
      covered_from: "2026-01-20",
      covered_to: "2026-01-31",
    },
    {
      service: "training",
      horse_id: b,
      stay_id: null,
      amount_cents: 200,
      covered_from: "2026-02-01",
      covered_to: "2026-02-05",
    },
    {
      service: "board",
      horse_id: b,
      stay_id: sb,
      amount_cents: 300,
      covered_from: "2026-02-01",
      covered_to: "2026-02-05",
    },
  ];
  const set = (
    id: string,
    current: string | null,
    data: unknown = rows,
    clear = false,
    p = parent,
  ) =>
    db.query("select set_service_assignments($1,$2,$3,$4,$5,'Reviewed',$6)", [
      id,
      expense,
      p,
      current,
      data,
      clear,
    ]);
  const business = async (from = "2026-01-01", to = "2026-02-28") =>
    (
      await db.query<{ r: ServiceProfitability }>(
        "select service_profitability($1,$2) r",
        [from, to],
      )
    ).rows[0].r;
  const scoped = async (
    scope = "horse",
    from = "2026-01-01",
    to = "2026-02-28",
    page = 1,
  ) =>
    (
      await db.query<{ r: EntityMargins }>(
        "select service_entity_margins($1,$2,$3,$4) r",
        [from, to, scope, page],
      )
    ).rows[0].r;
  const options = async () =>
    (
      await db.query<{ r: AssignmentOptions }>(
        "select service_assignment_options($1) r",
        [expense],
      )
    ).rows[0].r;
  return {
    db,
    c,
    a,
    b,
    sa,
    sb,
    horse,
    stay,
    expense,
    parent,
    category,
    rows,
    set,
    business,
    scoped,
    options,
  };
}
function reconcile(r: EntityMargins) {
  for (const s of r.business_services) {
    const a = r.assigned_totals.find((x) => x.service === s.service),
      u = r.unassigned.find((x) => x.service === s.service);
    for (const key of [
      "gross_cents",
      "draft_cents",
      "adjustment_cents",
      "cost_cents",
    ] as const)
      assert.equal(
        (a?.[key] ?? 0) + (u?.[key] ?? 0),
        s[key],
        `${r.scope} ${s.service} ${key}`,
      );
  }
}
test("manual horse/stay portions use distinct dates, leave explicit remainders and reconcile every cent across business and scoped periods", async () => {
  const f = await fixture();
  const { db, expense, parent, a, b, sa, sb, business, scoped, set, options } =
    f;
  try {
    const before = (
      await db.query<{ r: unknown }>(
        "select financial_report_bundle('2026-01-01','2026-03-31') r",
      )
    ).rows[0].r;
    const id = crypto.randomUUID();
    await set(id, null);
    await set(id, null);
    assert.equal((await options()).current!.valid, true);
    const jan = await business("2026-01-01", "2026-01-31"),
      feb = await business("2026-02-01", "2026-02-28");
    assert.deepEqual(
      jan.services.map((x) => x.cost_cents),
      [717, 616],
    );
    assert.deepEqual(
      feb.services.map((x) => x.cost_cents),
      [284, 384],
    );
    assert.deepEqual(
      (await business()).services.map((x) => x.cost_cents),
      [1001, 1000],
    );
    for (const scope of ["horse", "stay"]) {
      for (const [from, to] of [
        ["2026-01-01", "2026-02-28"],
        ["2026-01-15", "2026-01-17"],
        ["2026-02-01", "2026-02-02"],
      ])
        reconcile(await scoped(scope, from, to));
    }
    const horses = await scoped();
    assert.equal(horses.count, 2);
    assert.deepEqual(
      horses.rows
        .find((x) => x.entity_id === a)!
        .services.map((x) => x.cost_cents),
      [600, 500],
    );
    assert.deepEqual(
      horses.rows
        .find((x) => x.entity_id === b)!
        .services.map((x) => x.cost_cents),
      [200, 300],
    );
    assert.deepEqual(
      horses.unassigned.map((x) => x.cost_cents),
      [201, 200],
    );
    const stays = await scoped("stay");
    assert.equal(
      stays.rows.find((x) => x.entity_id === sa)!.services[0].cost_cents,
      600,
    );
    assert.equal(
      stays.rows.find((x) => x.entity_id === sb)!.services[0].cost_cents,
      0,
    );
    assert.deepEqual(
      stays.unassigned.map((x) => x.cost_cents),
      [401, 200],
    );
    const after = (
      await db.query<{ r: unknown }>(
        "select financial_report_bundle('2026-01-01','2026-03-31') r",
      )
    ).rows[0].r;
    assert.deepEqual(after, before);
    assert.equal(
      (await db.query("select * from inventory_movements")).rows.length,
      0,
    );
    await assert.rejects(set(crypto.randomUUID(), null), /Assignments changed/);
    await assert.rejects(set(id, null, []), /different values/);
    const clear = crypto.randomUUID();
    await set(clear, id, [], true);
    await set(id, null);
    assert.equal((await options()).current!.cleared, true);
    assert.deepEqual(
      (await scoped()).unassigned.map((x) => x.cost_cents),
      [1001, 1000],
    );
    reconcile(await scoped());
    assert.equal(
      (
        await db.query(
          "select id from service_assignment_reviews where expense_id=$1",
          [expense],
        )
      ).rows.length,
      2,
    );
    await assert.rejects(
      db.query("delete from service_assignment_lines"),
      /permission denied/,
    );
    await login(db, outsiderId);
    assert.equal(
      (await db.query("select * from service_assignment_reviews")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from valid_service_assignments")).rows.length,
      0,
    );
    await assert.rejects(options(), /Administrator/);
    await assert.rejects(scoped(), /Administrator/);
    await assert.rejects(
      set(crypto.randomUUID(), clear, [], true, parent),
      /Administrator/,
    );
    await assert.rejects(
      db.query("select * from dated_service_costs"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
test("caps and date/horse guards reject invalid portions atomically; changed parent revisions invalidate rather than remap assignments", async () => {
  const f = await fixture();
  const {
    db,
    a,
    b,
    sa,
    expense,
    parent,
    category,
    rows,
    set,
    scoped,
    options,
  } = f;
  try {
    await assert.rejects(
      set(crypto.randomUUID(), null, [{ ...rows[0], amount_cents: 1002 }]),
      /cannot exceed/,
    );
    await assert.rejects(
      set(crypto.randomUUID(), null, [
        { ...rows[0], covered_from: "2025-12-31" },
      ]),
      /dates must fit/,
    );
    await assert.rejects(
      set(crypto.randomUUID(), null, [
        { ...rows[0], covered_from: "2026-01-01" },
      ]),
      /dates must fit/,
    );
    await assert.rejects(
      set(crypto.randomUUID(), null, [
        { ...rows[0], horse_id: b, stay_id: sa },
      ]),
      /dates must fit/,
    );
    assert.equal(
      (await db.query("select * from service_assignment_reviews")).rows.length,
      0,
    );
    const id = crypto.randomUUID();
    await set(id, null);
    const revised = crypto.randomUUID();
    await db.query(
      "select set_service_cost_allocation($1,$2,$3,500,1501,0,'2026-01-01','2026-02-28','New business split',false)",
      [revised, expense, parent],
    );
    assert.equal((await options()).current!.valid, false);
    assert.equal((await scoped()).invalid_assignment_count, 1);
    assert.equal((await f.business()).invalid_assignment_count, 1);
    assert.equal((await scoped()).rows.length, 0);
    await assert.rejects(
      set(crypto.randomUUID(), id),
      /current business service split/,
    );
    await set(id, null);
    assert.equal((await scoped()).invalid_assignment_count, 1);
    assert.equal((await f.business()).invalid_assignment_count, 1);
    await set(crypto.randomUUID(), id, [], true);
    assert.equal((await scoped()).invalid_assignment_count, 0);
    reconcile(await scoped());
    // A direct-horse source cannot be assigned to another horse.
    await db.query("select save_expense($1,$2,$3)", [
      expense,
      {
        category_id: category,
        expense_date: "2026-03-10",
        paid_on: "2026-03-10",
        amount_cents: 2001,
        vendor: "Facility",
        reimbursable: false,
        horse_id: a,
      },
      crypto.randomUUID(),
    ]);
    const current = (await options()).current!.id;
    await assert.rejects(
      set(
        crypto.randomUUID(),
        current,
        [{ ...rows[3], amount_cents: 100 }],
        false,
        revised,
      ),
      /expense horse/,
    );
  } finally {
    await db.close();
  }
});
test("assignment input validates explicit positive money, source identities and covered dates without inferring cost shares", () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: crypto.randomUUID(),
    expense_id: crypto.randomUUID(),
    parent_id: crypto.randomUUID(),
    reason: "Review",
  }))
    f.set(k, v);
  const row = {
    service: "board",
    horse_id: crypto.randomUUID(),
    stay_id: "",
    amount: "1.01",
    covered_from: "2026-01-01",
    covered_to: "2026-01-02",
  };
  f.set("rows", JSON.stringify([row]));
  assert.equal(serviceAssignmentValues(f).p_rows[0].amount_cents, 101);
  f.set("rows", JSON.stringify([{ ...row, amount: "0" }]));
  assert.throws(() => serviceAssignmentValues(f));
  f.set("clear", "yes");
  f.set("rows", "[]");
  assert.equal(serviceAssignmentValues(f).p_rows.length, 0);
});
test("scoped saved revenue and signed adjustments follow invoice stays", async () => {
  const f = await fixture();
  const { db, c, a, b, sa, sb, set, scoped } = f;
  try {
    async function bill(
      stay: string,
      from: string,
      to: string,
      rate: number,
      boardRate: number,
      mode: string,
    ) {
      await db.query(
        "update training_stays set monthly_rate_cents=$2,boarding_billing=$3,boarding_monthly_cents=$4 where id=$1",
        [stay, rate, mode, mode === "separate_monthly" ? boardRate : null],
      );
      await db.query(
        "select set_package_reporting($1,$2,null,0,$3,'Revenue split')",
        [crypto.randomUUID(), stay, mode === "included" ? boardRate : 0],
      );
      const i = crypto.randomUUID();
      await db.query(
        "select create_invoice($1,$2,$3,'2026-03-01','2026-03-08',$4,$5)",
        [i, c, stay, from, to],
      );
      await db.query("select set_training_days($1,$2,$3,'worked',null)", [
        stay,
        from,
        to,
      ]);
      await db.query("select add_calendar_training($1)", [i]);
      if (mode === "separate_monthly")
        await db.query("select add_monthly_service($1,'boarding')", [i]);
      return i;
    }
    const ia = await bill(
        sa,
        "2026-01-15",
        "2026-01-31",
        3100,
        1000,
        "included",
      ),
      ib = await bill(
        sb,
        "2026-02-01",
        "2026-02-05",
        2800,
        2800,
        "separate_monthly",
      );
    await set(crypto.randomUUID(), null);
    let r = await scoped();
    assert.equal(
      r.rows.find((x) => x.entity_id === a)!.services[0].draft_cents,
      1152,
    );
    reconcile(r);
    await db.query("select finalize_invoice($1)", [ia]);
    await db.query("select finalize_invoice($1)", [ib]);
    const adj = crypto.randomUUID();
    await db.query(
      "select adjust_invoice($1,$2,-101,'2026-04-01','Adjustment')",
      [adj, ia],
    );
    assert.equal((await scoped()).unresolved_adjustment_count, 1);
    await db.query(
      "select set_adjustment_reporting($1,$2,null,61,0,40,0,'Reviewed categories')",
      [crypto.randomUUID(), adj],
    );
    r = await scoped();
    reconcile(r);
    assert.equal(
      r.rows.find((x) => x.entity_id === a)!.services[0].gross_cents,
      1152,
    );
    assert.equal(
      r.rows.find((x) => x.entity_id === a)!.services[0].adjustment_cents,
      -61,
    );
    assert.equal(
      r.rows.find((x) => x.entity_id === b)!.services[1].gross_cents,
      500,
    );
    reconcile(await scoped("stay"));
    reconcile(await scoped("horse", "2026-01-15", "2026-01-20"));
    await db.query("select void_invoice($1,'Void')", [ia]);
    r = await scoped();
    assert.equal(
      r.rows.find((x) => x.entity_id === a)!.services[0].gross_cents,
      0,
    );
    reconcile(r);
  } finally {
    await db.close();
  }
});
test("report pages retain complete totals and changed stay dates invalidate cost reviews", async () => {
  const f = await fixture();
  const { db, c, a, expense, parent, horse, stay, options, set, scoped } = f;
  try {
    const rows = [];
    for (let n = 0; n < 26; n++) {
      const h = await horse(`Owner horse ${String(n).padStart(2, "0")}`);
      rows.push({
        service: "board",
        horse_id: h,
        stay_id: null,
        amount_cents: 1,
        covered_from: "2026-01-01",
        covered_to: "2026-01-01",
      });
    }
    const id = crypto.randomUUID();
    await set(id, null, rows);
    const first = await scoped(),
      second = await scoped("horse", "2026-01-01", "2026-02-28", 2);
    assert.equal(first.count, 26);
    assert.equal(first.rows.length, 25);
    assert.equal(second.rows.length, 1);
    assert.equal(
      first.assigned_totals.find((x) => x.service === "board")!.cost_cents,
      26,
    );
    reconcile(first);
    reconcile(second);
    assert.equal((await scoped("stay")).count, 0);
    reconcile(await scoped("stay"));
    const extra = await horse("Stay cost horse");
    const s = await stay(extra, "2026-01-01", "2026-01-31");
    const revised = crypto.randomUUID();
    await set(revised, id, [
      {
        service: "training",
        horse_id: extra,
        stay_id: s,
        amount_cents: 100,
        covered_from: "2026-01-01",
        covered_to: "2026-01-31",
      },
    ]);
    await db.query(
      "update training_stays set departure_date='2026-01-20' where id=$1",
      [s],
    );
    assert.equal((await options()).current!.valid, false);
    assert.equal((await scoped()).invalid_assignment_count, 1);
    assert.equal((await f.business()).invalid_assignment_count, 1);
    assert.equal((await scoped()).assigned_totals.length, 0);
    reconcile(await scoped());
    await assert.rejects(
      db.query(
        "select service_entity_margins('2026-02-01','2026-01-01','horse',1)",
      ),
      /valid dates/,
    );
    await assert.rejects(scoped("customer"), /valid scope/);
  } finally {
    await db.close();
  }
});
