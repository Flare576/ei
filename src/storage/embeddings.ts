/**
 * Embedding serialization utilities.
 *
 * At runtime, embeddings are `number[]` (384-dim float vectors).
 * In storage, they are base64-encoded Float32Array binary blobs — identical data,
 * ~75% smaller than JSON float arrays, and still compressible by gzip for sync/LocalStorage.
 *
 * Format on disk/in LocalStorage:
 *   "embedding": "AAAAAAAA..."   // btoa(Float32Array.buffer)
 *
 * Format in memory (unchanged — nothing outside storage layer sees strings):
 *   embedding: [0.0234567, -0.0891234, ...]
 *
 * Backward compatibility: if a stored embedding is already a number[] (old format),
 * decodeEmbedding returns it as-is. Mixed old/new files are handled transparently.
 *
 * IMPORTANT: encodeAllEmbeddings does NOT mutate the input state. It returns a new
 * StorageState where human item arrays are shallow-copied with encoded embedding fields.
 * This prevents the live in-memory state from being corrupted with base64 strings.
 */

import type { StorageState } from "../core/types.js";

// ---------------------------------------------------------------------------
// Encode: number[] → base64 string
// ---------------------------------------------------------------------------

function encodeEmbedding(embedding: number[]): string {
  const buffer = new Float32Array(embedding).buffer;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Decode: base64 string → number[]  (no-op if already number[])
// ---------------------------------------------------------------------------

function decodeEmbedding(value: unknown): number[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value as number[]; // backward compat
  if (typeof value !== "string") return undefined;

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Array.from(new Float32Array(bytes.buffer));
}

// ---------------------------------------------------------------------------
// Walk the entire StorageState and encode/decode all embedding fields
// ---------------------------------------------------------------------------

const HUMAN_ITEM_KEYS = ["facts", "traits", "topics", "people", "quotes"] as const;

/**
 * Returns a new StorageState with embeddings encoded as base64 strings.
 * Does NOT mutate the input — human item arrays are shallow-copied.
 */
export function encodeAllEmbeddings(state: StorageState): StorageState {
  const human = (state as unknown as Record<string, unknown>)["human"] as Record<string, unknown> | undefined;
  if (!human) return state;

  const encodedHuman: Record<string, unknown> = { ...human };
  for (const key of HUMAN_ITEM_KEYS) {
    const items = human[key];
    if (Array.isArray(items)) {
      encodedHuman[key] = items.map((item: Record<string, unknown>) => {
        if (!Array.isArray(item.embedding) || item.embedding.length === 0) return item;
        return { ...item, embedding: encodeEmbedding(item.embedding as number[]) };
      });
    }
  }

  return { ...state, human: encodedHuman as unknown as StorageState["human"] };
}

/**
 * Returns a new StorageState with embeddings decoded from base64 to number[].
 * Does NOT mutate the input — human item arrays are shallow-copied.
 */
export function decodeAllEmbeddings(state: StorageState): StorageState {
  const human = (state as unknown as Record<string, unknown>)["human"] as Record<string, unknown> | undefined;
  if (!human) return state;

  const decodedHuman: Record<string, unknown> = { ...human };
  for (const key of HUMAN_ITEM_KEYS) {
    const items = human[key];
    if (Array.isArray(items)) {
      decodedHuman[key] = items.map((item: Record<string, unknown>) => {
        if (item.embedding === undefined || Array.isArray(item.embedding)) return item;
        return { ...item, embedding: decodeEmbedding(item.embedding) };
      });
    }
  }

  return { ...state, human: decodedHuman as unknown as StorageState["human"] };
}
