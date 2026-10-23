import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recoveryOrigin,
  recoveryEmail,
  recoveryToken,
  newPassword,
  sendRecovery,
  changeRecoveredPassword,
} from "../src/lib/password-recovery.ts";
test("recovery only uses a configured safe origin and a recovery token, never a supplied redirect", () => {
  assert.equal(
    recoveryOrigin("https://example.com/", true),
    "https://example.com",
  );
  assert.equal(
    recoveryOrigin("http://localhost:3100", false),
    "http://localhost:3100",
  );
  for (const origin of [
    undefined,
    "invalid",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com/?next=elsewhere",
    "https://example.com/#fragment",
    "http://example.com",
    "http://localhost:3100",
    "https://localhost",
  ])
    assert.throws(() => recoveryOrigin(origin, true));
  assert.equal(recoveryToken("a".repeat(64), "recovery"), "a".repeat(64));
  for (const [token, type] of [
    [null, "recovery"],
    ["short", "recovery"],
    ["a".repeat(64), "invite"],
    ["a".repeat(64), "signup"],
    ["x".repeat(257), "recovery"],
    ["https://evil.test/token", "recovery"],
  ])
    assert.throws(() => recoveryToken(token, type));
});
test("email and passwords validate without trimming password characters or leaking account state", async () => {
  const f = new FormData();
  f.set("email", " customer@example.com ");
  assert.equal(recoveryEmail(f), "customer@example.com");
  f.set("email", "bad");
  assert.throws(() => recoveryEmail(f));
  const password = "  long passphrase  ";
  f.set("password", password);
  f.set("confirmation", password);
  assert.equal(newPassword(f), password);
  f.set("confirmation", "different value");
  assert.throws(() => newPassword(f), /match/);
  for (const p of ["short", "x".repeat(129)]) {
    f.set("password", p);
    f.set("confirmation", p);
    assert.throws(() => newPassword(f), /12 and 128/);
  }
  let captured: unknown;
  await sendRecovery(
    {
      resetPasswordForEmail: async (email, options) => {
        captured = { email, options };
        return { error: { message: "Unknown account" } };
      },
    },
    "customer@example.com",
    "https://example.com",
  );
  assert.deepEqual(captured, {
    email: "customer@example.com",
    options: { redirectTo: "https://example.com/auth/recovery" },
  });
  await assert.doesNotReject(
    sendRecovery(
      {
        resetPasswordForEmail: async () => {
          throw Error("Provider failure");
        },
      },
      "unknown@example.com",
      "https://example.com",
    ),
  );
});
test("password changes require provider-verified identity and never sign out before a successful update", async () => {
  const calls: string[] = [];
  const auth = {
    getUser: async () => ({ data: { user: { id: "account" } }, error: null }),
    updateUser: async (data: { password: string }) => {
      assert.equal(data.password, "a long passphrase");
      calls.push("update");
      return { error: null };
    },
    signOut: async (options: { scope: "global" }) => {
      assert.equal(options.scope, "global");
      calls.push("signout");
      return { error: null };
    },
  };
  await assert.rejects(
    changeRecoveredPassword(
      { ...auth, getUser: async () => ({ data: { user: null }, error: null }) },
      "a long passphrase",
    ),
    /expired/,
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    changeRecoveredPassword(
      {
        ...auth,
        updateUser: async () => ({
          error: { message: "Provider detail should not reach UI" },
        }),
      },
      "a long passphrase",
    ),
    /could not be updated/,
  );
  assert.deepEqual(calls, []);
  await changeRecoveredPassword(auth, "a long passphrase");
  assert.deepEqual(calls, ["update", "signout"]);
  await assert.doesNotReject(
    changeRecoveredPassword(
      {
        ...auth,
        signOut: async () => {
          throw Error("Network failure after password saved");
        },
      },
      "a long passphrase",
    ),
  );
});
