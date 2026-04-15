/**
 * Compress a user-selected image to a data URL that's safe to ship over JSON.
 * iPhone photos are often 4-5 MB; we resample to a max long edge and re-encode
 * as JPEG. Typical result: 150-400 KB per document.
 */
export async function compressImageToDataUrl(
  file: File,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<string> {
  // Target ~150-250 KB per document so all three fit comfortably under the
  // 1 MB per-key KV limit when encoded as base64.
  const maxDim = opts.maxDim ?? 1200;
  const quality = opts.quality ?? 0.72;

  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * ratio);
  const height = Math.round(bitmap.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", quality);
}
