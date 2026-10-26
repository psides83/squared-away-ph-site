export const videoPreviewLimit = 512 * 1024;
export const videoPreviewEdge = 640;
export function previewDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 32768 ||
    height > 32768
  )
    throw Error("Video dimensions are unavailable.");
  const scale = Math.min(1, videoPreviewEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
/** Read the JPEG frame header before accepting a bounded, generated preview. */
export function validateVideoPreview(bytes: Uint8Array) {
  if (
    bytes.length < 12 ||
    bytes.length > videoPreviewLimit ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    throw Error("Choose a generated JPEG preview up to 512 KB.");
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (length < 8) break;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4],
        width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width < 1 || height < 1 || Math.max(width, height) > videoPreviewEdge)
        break;
      return { width, height };
    }
    offset += length;
  }
  throw Error("The generated preview could not be verified.");
}
