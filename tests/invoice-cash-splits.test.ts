import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventoryDatabase,
  login,
  adminId,
  outsiderId,
} from "./helpers/inventory-database.ts";
import {
  cashSplitValues,
  type CashSplitOptions,
} from "../src/lib/invoice-cash-splits.ts";
async function fixture() {
  const db = await inventoryDatabase();
  const c = (
    await db.query<{ id: string }>(
      "insert into customers(name) values('Split customer') returning id",
    )
  ).rows[0].id;
  const horses = (
    await db.query<{ id: string }>(
      "insert into horses(barn_name) values('First horse'),('Second horse') returning id",
    )
  ).rows.map((x) => x.id);
  const stay = (
    await db.query<{ id: string }>(
      "insert into training_stays(horse_id,billing_customer_id,arrival_date,departure_date,monthly_rate_cents) values($1,$2,'2020-01-01','2020-01-31',0) returning id",
      [horses[0], c],
    )
  ).rows[0].id;
  const inv = crypto.randomUUID();
  await db.query(
    "select create_invoice($1,$2,null,'2020-01-01','2020-01-10',null,null)",
    [inv, c],
  );
  await db.query(
    "select add_invoice_line($1,$2,'Manual invoice',1001,'other')",
    [crypto.randomUUID(), inv],
  );
  const opts = async () =>
    (
      await db.query<{ r: CashSplitOptions }>(
        "select invoice_cash_split_options($1) r",
        [inv],
      )
    ).rows[0].r;
  const rows = [
    { horse_id: horses[0], stay_id: stay, amount_cents: 600 },
    { horse_id: horses[1], stay_id: null, amount_cents: 300 },
  ];
  const save = async (
    r = rows,
    clear = false,
    request = crypto.randomUUID(),
  ) => {
    const o = await opts();
    const params = [
      request,
      inv,
      o.current?.id ?? null,
      clear ? o.current!.source_token : o.source!.source_token,
      clear ? [] : r,
      "Reviewed cash allocation",
      clear,
    ];
    await db.query(
      "select set_invoice_cash_split($1,$2,$3,$4,$5,$6,$7)",
      params,
    );
    return params;
  };
  const pay = async (
    n = 501,
    date = "2020-01-02",
    id = crypto.randomUUID(),
  ) => {
    await db.query("select record_invoice_payment($1,$2,$3,$4,'cash')", [
      id,
      inv,
      n,
      date,
    ]);
    return id;
  };
  const issue = () => db.query("select finalize_invoice($1)", [inv]);
  return { db, c, horses, stay, inv, opts, rows, save, pay, issue };
}
test("invoice dollar weights split payments and refunds with exact per-event pennies and an unassigned remainder, preserving business totals", async () => {
  const f = await fixture();
  try {
    await f.save();
    await f.issue();
    assert.equal((await f.opts()).current!.valid, true);
    const payment = await f.pay();
    await f.db.query(
      "select record_invoice_refund($1,$2,1,'2020-01-03','reopen','cash','Partial refund')",
      [crypto.randomUUID(), payment],
    );
    const parts = (
      await f.db.query<{
        horse_id: string | null;
        stay_id: string | null;
        n: string;
      }>(
        "select horse_id,stay_id,sum(amount_cents) n from reporting_receipts group by horse_id,stay_id",
      )
    ).rows;
    const amount = (h: string | null) =>
      Number(parts.find((x) => x.horse_id === h)?.n ?? 0);
    assert.equal(amount(f.horses[0]), 299);
    assert.equal(amount(f.horses[1]), 150);
    assert.equal(amount(null), 51);
    const business = (
      await f.db.query<{
        r: {
          received_cents: number;
          customer_refunds_cents: number;
          net_cents: number;
        };
      }>("select cash_report('2020-01-01','2020-01-31') r")
    ).rows[0].r;
    assert.equal(business.received_cents, 501);
    assert.equal(business.customer_refunds_cents, 1);
    assert.equal(business.net_cents, 500);
    const stay = (
      await f.db.query<{
        r: {
          stays: { stay_id: string; received_cents: number }[];
          unassigned_received_cents: number;
        };
      }>("select stay_cash_report('2020-01-01','2020-01-31') r")
    ).rows[0].r;
    assert.equal(
      stay.stays.find((x) => x.stay_id === f.stay)!.received_cents,
      299,
    );
    assert.equal(stay.unassigned_received_cents, 201);
    assert.equal(
      (await f.db.query("select * from invoice_payments")).rows.length,
      1,
    );
    assert.equal(
      (await f.db.query("select * from invoice_lines")).rows.length,
      1,
    );
    await f.pay(500, "2020-02-01");
    assert.equal(
      Number(
        (
          await f.db.query<{ n: string }>(
            "select sum(amount_cents) n from reporting_receipts where paid_on='2020-02-01'",
          )
        ).rows[0].n,
      ),
      500,
    );
  } finally {
    await f.db.close();
  }
});
test("stale charge changes move cash to unassigned instead of silently using the legacy single-horse match; edit/clear and late retries retain history", async () => {
  const f = await fixture();
  try {
    await f.db.query(
      "select set_invoice_reporting_link($1,$2,$3,null,'Service attribution')",
      [crypto.randomUUID(), f.inv, f.horses[0]],
    );
    const first = await f.save();
    await f.issue();
    await f.pay();
    await f.db.query(
      "select adjust_invoice($1,$2,-1,'2020-01-04','Charge correction')",
      [crypto.randomUUID(), f.inv],
    );
    assert.equal((await f.opts()).current!.valid, false);
    assert.equal(
      Number(
        (
          await f.db.query<{ n: string }>(
            "select sum(amount_cents) n from reporting_receipts where horse_id is null",
          )
        ).rows[0].n,
      ),
      501,
    );
    const stale = [...first];
    stale[0] = crypto.randomUUID();
    stale[2] = first[0];
    await assert.rejects(
      f.db.query("select set_invoice_cash_split($1,$2,$3,$4,$5,$6,$7)", stale),
      /charges or customer changed/,
    );
    await f.save([
      { horse_id: f.horses[1], stay_id: null, amount_cents: 1000 },
    ]);
    await f.db.query(
      "select set_invoice_cash_split($1,$2,$3,$4,$5,$6,$7)",
      first,
    );
    assert.equal(
      (
        await f.db.query<{ horse_id: string }>(
          "select horse_id from reporting_receipts",
        )
      ).rows[0].horse_id,
      f.horses[1],
    );
    await f.save([], true);
    assert.equal(
      (
        await f.db.query<{ horse_id: string }>(
          "select horse_id from reporting_receipts",
        )
      ).rows[0].horse_id,
      f.horses[0],
    );
    await f.db.query(
      "select set_invoice_cash_split($1,$2,$3,$4,$5,$6,$7)",
      first,
    );
    assert.equal((await f.opts()).current!.cleared, true);
    assert.equal((await f.opts()).history.length, 3);
    assert.equal(
      (
        await f.db.query<{ horse_id: string }>(
          "select horse_id from invoice_reporting_links where retired_at is null",
        )
      ).rows[0].horse_id,
      f.horses[0],
    );
  } finally {
    await f.db.close();
  }
});
test("stays must match the selected horse and invoice customer; invalidated relationships cannot inherit cash and history prevents horse reassignment", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.save([{ horse_id: f.horses[1], stay_id: f.stay, amount_cents: 1001 }]),
      /stay for this horse/,
    );
    await assert.rejects(f.save([...f.rows, f.rows[0]]), /combination once/);
    await assert.rejects(
      f.save([{ horse_id: f.horses[0], stay_id: null, amount_cents: 1002 }]),
      /cannot exceed/,
    );
    await f.save();
    await f.issue();
    await f.pay();
    await f.db.exec("reset role");
    const other = (
      await f.db.query<{ id: string }>(
        "insert into customers(name) values('Other customer') returning id",
      )
    ).rows[0].id;
    await f.db.query(
      "update training_stays set billing_customer_id=$2 where id=$1",
      [f.stay, other],
    );
    await login(f.db, adminId);
    assert.equal((await f.opts()).current!.valid, false);
    assert.equal(
      (
        await f.db.query(
          "select * from reporting_receipts where horse_id is not null",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      f.db.query("update training_stays set horse_id=$2 where id=$1", [
        f.stay,
        f.horses[1],
      ]),
      /history cannot be reassigned/,
    );
  } finally {
    await f.db.close();
  }
});
test("signed largest-remainder allocation is stable for matching payment/refund amounts and reversals use actual transaction dates", async () => {
  const f = await fixture();
  try {
    await f.save([
      { horse_id: f.horses[0], stay_id: null, amount_cents: 500 },
      { horse_id: f.horses[1], stay_id: null, amount_cents: 501 },
    ]);
    await f.issue();
    const payment = await f.pay(1);
    const refund = payment;
    await f.db.query(
      "select record_invoice_refund($1,$2,1,'2020-01-03','reopen','cash','Returned')",
      [refund, payment],
    );
    assert.equal(
      Number(
        (
          await f.db.query<{ n: string }>(
            "select sum(amount_cents) n from reporting_receipts",
          )
        ).rows[0].n,
      ),
      0,
    );
    const amounts = (
      await f.db.query<{ horse_id: string; n: string }>(
        "select horse_id,sum(amount_cents) n from reporting_receipts group by horse_id",
      )
    ).rows;
    assert.equal(amounts.length, 1);
    assert.equal(amounts[0].horse_id, f.horses[1]);
    assert.equal(Number(amounts[0].n), 0);
    await f.db.query("select reverse_invoice_refund($1,'Mistaken refund')", [
      refund,
    ]);
    assert.equal(
      Number(
        (
          await f.db.query<{ n: string }>(
            "select sum(amount_cents) n from reporting_receipts",
          )
        ).rows[0].n,
      ),
      1,
    );
    await f.db.query("select reverse_invoice_payment($1,'Mistaken payment')", [
      payment,
    ]);
    assert.equal(
      (await f.db.query("select * from reporting_receipts")).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("advance cash and its refund stay unassigned and applying credits does not duplicate receipt attribution", async () => {
  const f = await fixture();
  try {
    await f.save();
    await f.issue();
    const credit = crypto.randomUUID();
    await f.db.query(
      "select record_customer_credit($1,$2,'advance',null,300,'2020-01-02','cash','Advance')",
      [credit, f.c],
    );
    await f.db.query(
      "select apply_customer_credit($1,$2,$3,100,'2020-01-03')",
      [crypto.randomUUID(), credit, f.inv],
    );
    await f.db.query(
      "select record_customer_credit_refund($1,$2,50,'2020-01-04','cash','Unused advance')",
      [crypto.randomUUID(), credit],
    );
    const receipts = (
      await f.db.query<{ horse_id: string | null; amount_cents: number }>(
        "select horse_id,amount_cents from reporting_receipts",
      )
    ).rows;
    assert.equal(receipts.length, 2);
    assert.equal(
      receipts.every((x) => x.horse_id === null),
      true,
    );
    assert.equal(
      receipts.reduce((n, r) => n + r.amount_cents, 0),
      250,
    );
  } finally {
    await f.db.close();
  }
});
test("cash split writes and private history are administrator-only; unsafe inputs and automatic stay invoices are denied", async () => {
  const f = await fixture();
  try {
    await f.save();
    await assert.rejects(
      f.db.query("delete from invoice_cash_splits"),
      /permission denied/,
    );
    await assert.rejects(
      f.db.query("delete from invoice_cash_split_lines"),
      /permission denied/,
    );
    const bound = crypto.randomUUID();
    await f.db.query(
      "select create_invoice($1,$2,$3,'2020-01-01','2020-01-10','2020-01-01','2020-01-31')",
      [bound, f.c, f.stay],
    );
    assert.equal(
      (
        await f.db.query<{ r: CashSplitOptions }>(
          "select invoice_cash_split_options($1) r",
          [bound],
        )
      ).rows[0].r.source,
      null,
    );
    await login(f.db, outsiderId);
    await assert.rejects(f.opts(), /Administrator/);
    assert.equal(
      (await f.db.query("select * from invoice_cash_splits")).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("select * from reporting_receipts")).rows.length,
      0,
    );
    assert.equal(
      (await f.db.query("select * from valid_invoice_cash_splits")).rows.length,
      0,
    );
    await assert.rejects(
      f.db.query(
        "select set_invoice_cash_split($1,$2,null,$3,'[]','Denied',false)",
        [crypto.randomUUID(), f.inv, "a".repeat(32)],
      ),
      /Administrator/,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(f.opts(), /permission denied/);
  } finally {
    await f.db.close();
  }
});
test("cash allocation form requires exact positive cents, unique combinations and current evidence", () => {
  const id = crypto.randomUUID(),
    f = new FormData();
  for (const [k, v] of Object.entries({
    request_id: id,
    invoice_id: id,
    source_token: "a".repeat(32),
    reason: "Review",
    rows: JSON.stringify([{ horse_id: id, stay_id: null, amount_cents: 123 }]),
  }))
    f.set(k, v);
  assert.equal(cashSplitValues(f).p_rows[0].amount_cents, 123);
  f.set("rows", JSON.stringify([{ horse_id: id, amount_cents: 1.5 }]));
  assert.throws(() => cashSplitValues(f), /whole-cent/);
  f.set("rows", "[]");
  assert.throws(() => cashSplitValues(f), /one to fifty/);
  f.set("clear", "yes");
  assert.equal(cashSplitValues(f).p_clear, true);
});

test("cash refunds of invoice-funded account credit follow the reviewed split without counting credit transfer as new cash", async () => {
  const f = await fixture();
  try {
    await f.issue();
    const payment = await f.pay(1001);
    const credit = crypto.randomUUID();
    await f.db.query(
      "select record_customer_credit($1,$2,'invoice',$3,101,'2020-01-03',null,'Unused services')",
      [credit, f.c, payment],
    );
    await f.save([
      { horse_id: f.horses[0], stay_id: f.stay, amount_cents: 600 },
      { horse_id: f.horses[1], stay_id: null, amount_cents: 300 },
    ]);
    await f.db.query(
      "select record_customer_credit_refund($1,$2,101,'2020-01-04','cash','Returned credit')",
      [crypto.randomUUID(), credit],
    );
    const parts = (
      await f.db.query<{ horse_id: string; n: string }>(
        "select horse_id,sum(amount_cents) n from reporting_receipts group by horse_id",
      )
    ).rows;
    assert.equal(Number(parts.find((x) => x.horse_id === f.horses[0])!.n), 600);
    assert.equal(Number(parts.find((x) => x.horse_id === f.horses[1])!.n), 300);
    assert.equal(parts.length, 2);
  } finally {
    await f.db.close();
  }
});

test("failed or stale cash revisions leave the active split intact and direct RPC validation cannot be bypassed", async () => {
  const f = await fixture();
  try {
    const first = await f.save(),
      o = await f.opts();
    for (const rows of [
      [],
      Array.from({ length: 51 }, () => f.rows[0]),
      [{ horse_id: "not-a-uuid", stay_id: null, amount_cents: 1 }],
      [{ horse_id: f.horses[0], stay_id: null, amount_cents: 0 }],
      [{ horse_id: f.horses[0], stay_id: null, amount_cents: 1.5 }],
    ])
      await assert.rejects(
        f.db.query(
          "select set_invoice_cash_split($1,$2,$3,$4,$5,'Invalid attempt',false)",
          [
            crypto.randomUUID(),
            f.inv,
            o.current!.id,
            o.source!.source_token,
            rows,
          ],
        ),
      );
    const bad = [...first];
    bad[0] = crypto.randomUUID();
    await assert.rejects(
      f.db.query("select set_invoice_cash_split($1,$2,$3,$4,$5,$6,$7)", bad),
      /cash split changed/,
    );
    const changed = [...first];
    changed[5] = "Changed request";
    await assert.rejects(
      f.db.query(
        "select set_invoice_cash_split($1,$2,$3,$4,$5,$6,$7)",
        changed,
      ),
      /different values/,
    );
    assert.equal((await f.opts()).current!.id, first[0]);
    assert.equal((await f.opts()).history.length, 1);
  } finally {
    await f.db.close();
  }
});
