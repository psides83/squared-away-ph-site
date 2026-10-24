export const videoLimit = 50 * 1024 * 1024;
export function videoType(bytes: Uint8Array): {
  mime: string;
  extension: string;
} {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 16 && ascii(4, 8) === "ftyp") {
    const size = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0);
    if (size < 16 || size > bytes.length)
      throw Error("The video container header could not be read.");
    const brand = ascii(8, 12);
    if (brand === "qt  ") return { mime: "video/quicktime", extension: "mov" };
    const allowed = [
      "isom",
      "iso2",
      "iso3",
      "iso4",
      "iso5",
      "iso6",
      "mp41",
      "mp42",
      "avc1",
      "dash",
      "M4V ",
      "MSNV",
    ];
    const brands = [brand];
    for (let n = 16; n + 4 <= size; n += 4) brands.push(ascii(n, n + 4));
    if (brands.some((b) => allowed.includes(b)))
      return { mime: "video/mp4", extension: "mp4" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3 &&
    ascii(4, Math.min(bytes.length, 4096)).includes("webm")
  )
    return { mime: "video/webm", extension: "webm" };
  throw Error(
    "Choose an MP4, MOV, or WebM video. This file header is not supported.",
  );
}
export function videoSize(size: number) {
  if (!Number.isInteger(size) || size < 1 || size > videoLimit)
    throw Error("Choose a nonempty video up to 50 MB.");
  return size;
}
export function resumableEndpoint(value: string) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw Error("Video storage connection is invalid.");
  if (/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname))
    url.hostname = url.hostname.replace(".supabase.co", ".storage.supabase.co");
  return `${url.origin}/storage/v1/upload/resumable`;
}

/** Check every transfer request before adding a fresh signed upload token. */
export function safeVideoTransferUrl(value: string, endpoint: string) {
  try {
    const url = new URL(value),
      base = new URL(endpoint);
    return (
      url.origin === base.origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === base.pathname ||
        url.pathname.startsWith(`${base.pathname}/`))
    );
  } catch {
    return false;
  }
}
export function videoDigest(bytes: ArrayBuffer) {
  return crypto.subtle
    .digest("SHA-256", bytes)
    .then((hash) =>
      Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    );
}
export type PendingVideoTransfer = {
  id: string;
  horse_id: string;
  title: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
};
export function verifyVideoReselection(
  file: { size: number },
  mime: string,
  sha256: string,
  pending: PendingVideoTransfer,
) {
  if (
    file.size !== pending.size_bytes ||
    mime !== pending.content_type ||
    sha256 !== pending.sha256
  )
    throw Error(
      "This is a different video. Select the original file to resume this upload.",
    );
}

export function videoTransferFingerprint(
  user: string,
  id: string,
  sha256: string,
) {
  return `saph-video:${user}:${id}:${sha256}`;
}
export function matchingVideoTransfer<
  T extends {
    size: number | null;
    uploadUrl: string | null;
    parallelUploadUrls: string[] | null;
    creationTime: string;
    metadata: Record<string, string>;
  },
>(
  entries: T[],
  endpoint: string,
  path: string,
  size: number,
  now = Date.now(),
): T | undefined {
  return entries.find(
    (entry) =>
      entry.size === size &&
      !entry.parallelUploadUrls &&
      entry.uploadUrl &&
      entry.metadata.bucketName === "horse-videos" &&
      entry.metadata.objectName === path &&
      safeVideoTransferUrl(entry.uploadUrl, endpoint) &&
      Number.isFinite(Date.parse(entry.creationTime)) &&
      now - Date.parse(entry.creationTime) >= 0 &&
      now - Date.parse(entry.creationTime) < 24 * 60 * 60 * 1000,
  );
}
