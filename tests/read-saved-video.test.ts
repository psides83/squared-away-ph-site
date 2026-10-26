import { test } from "node:test";
import assert from "node:assert/strict";
import { readSavedVideo } from "../src/lib/read-saved-video.ts";
function clip() {
  const bytes = new Uint8Array(24);
  new DataView(bytes.buffer).setUint32(0, 24);
  for (const [offset, text] of [
    [4, "ftyp"],
    [8, "isom"],
    [16, "isom"],
  ] as const)
    for (let i = 0; i < text.length; i++)
      bytes[offset + i] = text.charCodeAt(i);
  return bytes;
}
const source = { size_bytes: 24, content_type: "video/mp4" };
test("saved video reader streams a bounded clip into temporary memory and reports progress", async () => {
  const bytes = clip(),
    progress: number[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 12));
      controller.enqueue(bytes.slice(12));
      controller.close();
    },
  });
  const response = new Response(stream, {
    headers: {
      "Content-Type": "video/mp4; charset=binary",
      "Content-Length": "24",
    },
  });
  const result = await readSavedVideo(response, source, undefined, (value) =>
    progress.push(value),
  );
  assert.equal(result.type, "video/mp4");
  assert.equal(result.size, 24);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  assert.deepEqual(progress, [50, 100]);
  assert.equal(response.body!.locked, false);
  const encoded = new Response(bytes, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Encoding": "gzip",
      "Content-Length": "999",
    },
  });
  assert.equal((await readSavedVideo(encoded, source)).size, 24);
});
test("saved video reader rejects sign-in pages, wrong metadata, short clips and oversized streams without retaining the rest", async () => {
  for (const response of [
    new Response("Sign in", { headers: { "Content-Type": "text/html" } }),
    new Response("Denied", { status: 403 }),
    new Response(clip(), { headers: { "Content-Type": "video/webm" } }),
  ])
    await assert.rejects(readSavedVideo(response, source), /could not be/);
  let cancelled = 0;
  const open = () =>
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    });
  await assert.rejects(
    readSavedVideo(
      new Response(open(), {
        headers: { "Content-Type": "video/mp4", "Content-Length": "25" },
      }),
      source,
    ),
    /size does not match/,
  );
  assert.equal(cancelled, 1);
  const over = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(16));
      controller.enqueue(new Uint8Array(9));
    },
    cancel() {
      cancelled++;
    },
  });
  const overflowResponse = new Response(over, {
    headers: { "Content-Type": "video/mp4" },
  });
  await assert.rejects(readSavedVideo(overflowResponse, source), /larger than/);
  assert.equal(cancelled, 2);
  assert.equal(overflowResponse.body!.locked, false);
  await assert.rejects(
    readSavedVideo(
      new Response(clip().slice(0, -1), {
        headers: { "Content-Type": "video/mp4" },
      }),
      source,
    ),
    /incomplete/,
  );
  await assert.rejects(
    readSavedVideo(
      new Response(new Uint8Array(24), {
        headers: { "Content-Type": "video/mp4" },
      }),
      source,
    ),
    /MP4/,
  );
  await assert.rejects(
    readSavedVideo(
      new Response(clip(), { headers: { "Content-Type": "video/mp4" } }),
      { ...source, size_bytes: 51 * 1024 * 1024 },
    ),
    /50 MB/,
  );
});
test("saved video reader cancels pending network reads and releases stream locks", async () => {
  let cancelled = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled++;
      },
    }),
    { headers: { "Content-Type": "video/mp4" } },
  );
  const controller = new AbortController();
  const pending = readSavedVideo(response, source, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(cancelled, 1);
  assert.equal(response.body!.locked, false);
  const already = new AbortController();
  already.abort();
  await assert.rejects(
    readSavedVideo(
      new Response(clip(), { headers: { "Content-Type": "video/mp4" } }),
      source,
      already.signal,
    ),
    /cancelled/,
  );
});
