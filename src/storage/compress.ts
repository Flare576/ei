/**
 * Gzip compression utilities for storage.
 *
 * Uses the native CompressionStream/DecompressionStream API, available in
 * both modern browsers and Bun (no external dependencies).
 *
 * Compressed output is base64-encoded so it can be stored as a plain string
 * (LocalStorage, remote API body, etc.).
 *
 * FileStorage deliberately does NOT use these — uncompressed JSON on disk
 * stays human-readable and debuggable.
 */

export async function compress(json: string): Promise<string> {
  const encoder = new TextEncoder();
  const input = encoder.encode(json);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  // btoa needs a binary string — convert byte-by-byte
  let binary = "";
  for (let i = 0; i < merged.length; i++) {
    binary += String.fromCharCode(merged[i]);
  }
  return btoa(binary);
}

export async function decompress(b64: string): Promise<string> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(merged);
}

/** Returns true if the string looks like a base64-encoded gzip payload. */
export function isCompressed(value: string): boolean {
  // gzip magic bytes are 0x1f 0x8b — base64-encoded that starts with "H4sI"
  return value.startsWith("H4sI");
}
