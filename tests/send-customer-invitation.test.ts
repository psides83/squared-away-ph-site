import { test } from "node:test";
import assert from "node:assert/strict";
import { sendCustomerInvitation } from "../src/lib/send-customer-invitation.ts";
import {
  inventoryDatabase,
  login,
  outsiderId,
  adminId,
} from "./helpers/inventory-database.ts";
test("disabled invitation sending performs no reservation or email; previous requests never send twice", async () => {
  let sends = 0,
    reservations = 0;
  const worker = {
    ready: false,
    reserve: async () => {
      reservations++;
      return { send: true, email: "customer@example.com" };
    },
    invite: async () => {
      sends++;
      return true;
    },
    finish: async () => {},
  };
  await assert.rejects(
    sendCustomerInvitation(worker),
    /configured email sender/,
  );
  assert.equal(reservations, 0);
  assert.equal(sends, 0);
  assert.equal(
    await sendCustomerInvitation({
      ...worker,
      ready: true,
      reserve: async () => ({ send: false, email: "customer@example.com" }),
    }),
    "previous",
  );
  assert.equal(sends, 0);
});
test("provider success records acceptance only; uncertain failures are not retried and completion failures stay visible", async () => {
  const states: boolean[] = [];
  let calls = 0;
  const worker = {
    ready: true,
    reserve: async () => ({ send: true, email: "customer@example.com" }),
    invite: async (email: string) => {
      assert.equal(email, "customer@example.com");
      calls++;
      return true;
    },
    finish: async (state: boolean) => {
      states.push(state);
    },
  };
  assert.equal(await sendCustomerInvitation(worker), "accepted");
  assert.deepEqual(states, [true]);
  await assert.rejects(
    sendCustomerInvitation({
      ...worker,
      invite: async () => {
        calls++;
        throw Error("timeout");
      },
    }),
    /provider review/,
  );
  assert.deepEqual(states, [true, false]);
  assert.equal(calls, 2);
  await assert.rejects(
    sendCustomerInvitation({
      ...worker,
      finish: async () => {
        throw Error("result unavailable");
      },
    }),
    /result unavailable/,
  );
});
test("invitation reservations snapshot reviewed saved email, protect exact retries and uncertain outcomes, and grant no access", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name,email) values('Invited customer','Customer@example.com') returning id",
      )
    ).rows[0].id;
    const request = crypto.randomUUID();
    const reserve = async (id = request, email = "customer@example.com") =>
      (
        await db.query<{ r: { send: boolean; state: string; email: string } }>(
          "select begin_customer_invitation($1,$2,$3) r",
          [id, customer, email],
        )
      ).rows[0].r;
    await assert.rejects(
      reserve(request, "stale@example.com"),
      /email changed/,
    );
    assert.equal((await reserve()).send, true);
    assert.equal((await reserve()).send, false);
    await assert.rejects(
      reserve(request, "different@example.com"),
      /different details/,
    );
    await assert.rejects(reserve(crypto.randomUUID()), /earlier attempt/);
    await assert.rejects(
      db.query("select finish_customer_invitation($1,true)", [request]),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query("select finish_customer_invitation($1,false)", [request]);
    await db.query("select finish_customer_invitation($1,true)", [request]);
    await login(db, adminId);
    assert.equal((await reserve()).state, "review");
    assert.equal(
      (await db.query("select * from customer_portal_accounts")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from customer_horse_access")).rows.length,
      0,
    );
    await login(db, outsiderId);
    await assert.rejects(reserve(crypto.randomUUID()), /Administrator access/);
    assert.equal(
      (await db.query("select * from customer_invitation_attempts")).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});
test("existing accounts and daily invitation cap block new reservations before sending", async () => {
  const db = await inventoryDatabase();
  try {
    const customer = (
      await db.query<{ id: string }>(
        "insert into customers(name,email) values('Existing customer','existing@example.com') returning id",
      )
    ).rows[0].id;
    await db.exec("reset role");
    await db.query(
      "insert into auth.users(id,email) values($1,'existing@example.com')",
      [crypto.randomUUID()],
    );
    await login(db, adminId);
    await assert.rejects(
      db.query(
        "select begin_customer_invitation($1,$2,'existing@example.com')",
        [crypto.randomUUID(), customer],
      ),
      /account already exists/,
    );
    await db.query("update customers set email='new@example.com' where id=$1", [
      customer,
    ]);
    await db.exec("reset role");
    await db.query(
      "insert into customer_invitation_attempts(id,customer_id,email,actor,state,completed_at) select gen_random_uuid(),$1,'earlier'||n||'@example.com',$2,'accepted',now() from generate_series(1,20)n",
      [customer, adminId],
    );
    await login(db, adminId);
    await assert.rejects(
      db.query("select begin_customer_invitation($1,$2,'new@example.com')", [
        crypto.randomUUID(),
        customer,
      ]),
      /limit reached/,
    );
  } finally {
    await db.close();
  }
});
