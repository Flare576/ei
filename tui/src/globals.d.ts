/**
 * TUI global type augmentations.
 *
 * TUI's lib config omits "DOM" because this is a terminal app, but the shared
 * src files use `typeof document !== "undefined"` guards for runtime detection.
 * Without a DOM lib declaration, TypeScript emits TS2584 for those checks.
 *
 * Additionally, @types/node pulls in undici-types which types Response.json()
 * as Promise<unknown>, while the DOM lib types it as Promise<any>. The stricter
 * undici typing causes TS18046 in shared src files that call response.json().
 */

// Allow `typeof document` checks in shared src files (never actually accessed in TUI)
declare var document: unknown;

// Override undici-types' strict Response.json() -> Promise<unknown> back to any,
// matching the DOM lib behavior that the shared src files were written against.
interface Body {
  json(): Promise<any>;
}

interface Response {
  json(): Promise<any>;
}

// Stubs for browser IndexedDB globals referenced in src/storage/indexed.ts.
// That file is browser-only but is re-exported from src/storage/index.ts,
// so TypeScript compiles it even when run under the TUI (no DOM lib).
declare var indexedDB: { open(name: string, version?: number): IDBOpenDBRequest };

declare class IDBDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(store: string, mode?: string): { objectStore(name: string): IDBObjectStore };
  close(): void;
}

declare class IDBObjectStore {
  get(key: string): IDBRequest;
  put(value: unknown, key?: string): IDBRequest;
  delete(key: string): IDBRequest;
}

declare class IDBOpenDBRequest {
  result: IDBDatabase;
  error: unknown;
  onupgradeneeded: ((event: any) => void) | null;
  onsuccess: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
}

declare class IDBRequest {
  result: any;
  error: unknown;
  onsuccess: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
}
