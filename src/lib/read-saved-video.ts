import { videoSize, videoType } from "./horse-video.ts";
/** Read a known saved clip into temporary memory, with a strict decoded-byte limit. */
export async function readSavedVideo(
  response: Response,
  source: { size_bytes: number; content_type: string },
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const expected = videoSize(source.size_bytes);
  const invalid = (message: string): never => {
    void response.body?.cancel().catch(() => {});
    throw Error(message);
  };
  if (signal?.aborted) invalid("Video read cancelled.");
  if (!response.ok)
    invalid(
      "The saved video could not be read. Refresh the file and try again.",
    );
  const type = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (type !== source.content_type)
    invalid(
      "The saved video could not be verified. Refresh the file or sign in again.",
    );
  const encoding = response.headers.get("Content-Encoding");
  const length = response.headers.get("Content-Length");
  if (length && (!encoding || encoding.toLowerCase() === "identity")) {
    const declared = Number(length);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > expected)
      invalid("The saved video size does not match its record.");
  }
  if (!response.body)
    throw Error("This browser could not read the saved video.");
  const reader = response.body.getReader(),
    chunks: BlobPart[] = [];
  let total = 0,
    last = -1;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw Error("Video read cancelled.");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw Error("Video read cancelled.");
      if (done) break;
      total += value.byteLength;
      if (total > expected)
        throw Error("The saved video is larger than its record.");
      chunks.push(value);
      const percent = Math.round((total * 100) / expected);
      if (percent !== last) {
        last = percent;
        onProgress?.(percent);
      }
    }
    if (total !== expected)
      throw Error("The video read was incomplete. Please try again.");
    const clip = new Blob(chunks, { type: source.content_type });
    const bytes = new Uint8Array(await clip.slice(0, 65536).arrayBuffer());
    if (signal?.aborted) throw Error("Video read cancelled.");
    const header = videoType(bytes);
    if (header.mime !== source.content_type)
      throw Error("The saved video type does not match its record.");
    return clip;
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
