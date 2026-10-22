import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { preparedReceipt, attachReceipt } from "../src/lib/receipt-storage.ts";
function fakeStorage({ uploadFails = false, metadataFails = false } = {}) {
  const paths = new Set<string>();
  const metadata = new Map<string, unknown>();
  const events: string[] = [];
  return {
    paths,
    metadata,
    events,
    db: {
      from(table: string) {
        assert.equal(table, "expense_receipts");
        let path = "";
        return {
          select() {
            return this;
          },
          eq(_key: string, value: string) {
            path = value;
            return this;
          },
          async maybeSingle() {
            return { data: metadata.get(path) ?? null, error: null };
          },
          async insert(row: { object_path: string }) {
            events.push("metadata");
            if (metadataFails) return { error: { message: "failed" } };
            metadata.set(row.object_path, { id: "receipt" });
            return { error: null };
          },
        };
      },
      storage: {
        from(bucket: string) {
          assert.equal(bucket, "expense-receipts");
          return {
            async upload(path: string) {
              events.push("upload");
              if (uploadFails) return { error: { message: "failed" } };
              paths.add(path);
              return { error: null };
            },
            async remove(list: string[]) {
              events.push("cleanup");
              for (const path of list) paths.delete(path);
              return { error: null };
            },
          };
        },
      },
    } as unknown as SupabaseClient,
  };
}
const file = () =>
  new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])],
    "receipt.png",
    { type: "image/png" },
  );
test("receipts validate before persistence and identical attachments are repeat-safe", async () => {
  assert.equal(await preparedReceipt(null), null);
  await assert.rejects(
    preparedReceipt(new File(["not a receipt"], "bad.jpg")),
    /JPEG|PNG|WebP|PDF/,
  );
  await assert.rejects(
    preparedReceipt(new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.png")),
    /3 MB/,
  );
  const receipt = (await preparedReceipt(file()))!;
  const mock = fakeStorage();
  await attachReceipt(mock.db, "expense", receipt);
  await attachReceipt(mock.db, "expense", receipt);
  assert.equal(mock.paths.size, 1);
  assert.equal(mock.metadata.size, 1);
  assert.deepEqual(mock.events, ["upload", "metadata"]);
  assert.match([...mock.paths][0], /^expense\/[a-f0-9]{64}\.png$/);
});
test("receipt upload failure leaves purchase recovery explicit and metadata failure cleans up", async () => {
  const receipt = (await preparedReceipt(file()))!;
  const upload = fakeStorage({ uploadFails: true });
  await assert.rejects(
    attachReceipt(upload.db, "saved-expense", receipt),
    /expense is saved/,
  );
  assert.equal(upload.metadata.size, 0);
  const metadata = fakeStorage({ metadataFails: true });
  await assert.rejects(
    attachReceipt(metadata.db, "saved-expense", receipt),
    /expense is saved/,
  );
  assert.equal(metadata.paths.size, 0);
  assert.deepEqual(metadata.events, ["upload", "metadata", "cleanup"]);
});
