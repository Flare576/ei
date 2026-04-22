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
 * StorageState where human item arrays and persona entities are shallow-copied with
 * encoded embedding fields. This prevents the live in-memory state from being
 * corrupted with base64 strings.
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

const HUMAN_ITEM_KEYS = ["facts", "topics", "people", "quotes"] as const;

export function encodeAllEmbeddings(state: StorageState): StorageState {
  const raw = state as unknown as Record<string, unknown>;

  const human = raw["human"] as Record<string, unknown> | undefined;
  let encodedHuman = human;
  if (human) {
    encodedHuman = { ...human };
    for (const key of HUMAN_ITEM_KEYS) {
      const items = human[key];
      if (Array.isArray(items)) {
        (encodedHuman as Record<string, unknown>)[key] = items.map((item: Record<string, unknown>) => {
          if (!Array.isArray(item.embedding) || item.embedding.length === 0) return item;
          return { ...item, embedding: encodeEmbedding(item.embedding as number[]) };
        });
      }
    }
  }

  const personas = raw["personas"] as Record<string, unknown> | undefined;
  let encodedPersonas = personas;
  if (personas) {
    encodedPersonas = {};
    for (const [id, data] of Object.entries(personas)) {
      const d = data as Record<string, unknown>;
      const entity = d["entity"] as Record<string, unknown> | undefined;
      if (!entity || !Array.isArray(entity["description_embedding"]) || (entity["description_embedding"] as unknown[]).length === 0) {
        (encodedPersonas as Record<string, unknown>)[id] = data;
      } else {
        (encodedPersonas as Record<string, unknown>)[id] = {
          ...d,
          entity: { ...entity, description_embedding: encodeEmbedding(entity["description_embedding"] as number[]) },
        };
      }
    }
  }

  return { ...state, human: encodedHuman as unknown as StorageState["human"], personas: encodedPersonas as unknown as StorageState["personas"] };
}

export function decodeAllEmbeddings(state: StorageState): StorageState {
  const raw = state as unknown as Record<string, unknown>;

  const human = raw["human"] as Record<string, unknown> | undefined;
  let decodedHuman = human;
  if (human) {
    decodedHuman = { ...human };
    for (const key of HUMAN_ITEM_KEYS) {
      const items = human[key];
      if (Array.isArray(items)) {
        (decodedHuman as Record<string, unknown>)[key] = items.map((item: Record<string, unknown>) => {
          if (item.embedding === undefined || Array.isArray(item.embedding)) return item;
          return { ...item, embedding: decodeEmbedding(item.embedding) };
        });
      }
    }
  }

  const personas = raw["personas"] as Record<string, unknown> | undefined;
  let decodedPersonas = personas;
  if (personas) {
    decodedPersonas = {};
    for (const [id, data] of Object.entries(personas)) {
      const d = data as Record<string, unknown>;
      const entity = d["entity"] as Record<string, unknown> | undefined;
      if (!entity || entity["description_embedding"] === undefined || Array.isArray(entity["description_embedding"])) {
        (decodedPersonas as Record<string, unknown>)[id] = data;
      } else {
        (decodedPersonas as Record<string, unknown>)[id] = {
          ...d,
          entity: { ...entity, description_embedding: decodeEmbedding(entity["description_embedding"]) },
        };
      }
    }
  }

  return { ...state, human: decodedHuman as unknown as StorageState["human"], personas: decodedPersonas as unknown as StorageState["personas"] };
}
