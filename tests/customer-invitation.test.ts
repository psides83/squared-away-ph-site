import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  invitationToken,
  acceptInvitation,
} from "../src/lib/customer-invitation.ts";

test("invitation accepts only bounded invite hashes and rejects reset/signup and redirect-shaped input before provider calls", async () => {
  const hash = "a".repeat(64);
  assert.equal(invitationToken(hash, "invite"), hash);
  let calls = 0;
  const auth = {
    verifyOtp: async () => {
      calls++;
      return { data: { user: { id: "invited" }, session: {} }, error: null };
    },
  };
  for (const [token, type] of [
    [null, "invite"],
    ["short", "invite"],
    ["a".repeat(257), "invite"],
    ["https://evil.test/token", "invite"],
    [hash, "recovery"],
    [hash, "signup"],
    [hash, "email"],
    [hash, null],
  ]) {
    await assert.rejects(
      acceptInvitation(auth, token, type),
      /invalid or expired/,
    );
  }
  assert.equal(calls, 0);
  let input: unknown;
  await acceptInvitation(
    {
      verifyOtp: async (value) => {
        input = value;
        return { data: { user: { id: "invited" }, session: {} }, error: null };
      },
    },
    hash,
    "invite",
  );
  assert.deepEqual(input, { token_hash: hash, type: "invite" });
});

test("expired, used, provider-failed and sessionless invitations share a safe failure without exposing provider details", async () => {
  const hash = "b".repeat(64);
  for (const result of [
    {
      data: { user: null, session: null },
      error: { message: "Private provider detail" },
    },
    { data: { user: { id: "invited" }, session: null }, error: null },
    { data: { user: null, session: {} }, error: null },
  ])
    await assert.rejects(
      acceptInvitation({ verifyOtp: async () => result }, hash, "invite"),
      /^Error: This invitation is invalid or expired\. Contact the business owner for a new invitation\.$/,
    );
  await assert.rejects(
    acceptInvitation(
      {
        verifyOtp: async () => {
          throw Error("Private network detail");
        },
      },
      hash,
      "invite",
    ),
    /invitation is invalid or expired/,
  );
});

test("invite landing is non-consuming and private; submission uses fixed destinations without customer-access writes", () => {
  const page = readFileSync(
    new URL("../src/app/auth/invite/page.tsx", import.meta.url),
    "utf8",
  );
  const action = readFileSync(
    new URL("../src/app/invitation-actions.ts", import.meta.url),
    "utf8",
  );
  const proxy = readFileSync(
    new URL("../src/proxy.ts", import.meta.url),
    "utf8",
  );
  const template = readFileSync(
    new URL("../supabase/templates/invite.html", import.meta.url),
    "utf8",
  );
  assert.ok(!page.includes("verifyOtp"));
  assert.ok(page.includes("action={confirmInvitation}"));
  assert.ok(
    action.includes('"/auth/invite?error=invalid" : "/reset-password"'),
  );
  assert.ok(!action.includes(".rpc("));
  assert.ok(!action.includes(".from("));
  assert.ok(proxy.includes('"/auth/invite"'));
  assert.ok(
    template.includes(
      "/auth/invite?token_hash={{ .TokenHash }}&amp;type=invite",
    ),
  );
});
