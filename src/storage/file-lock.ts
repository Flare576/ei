/**
 * File-based advisory locking + atomic writes, shared by any Storage
 * implementation (and CLI tooling) that needs to serialize writes to a
 * JSON file on disk without a database.
 *
 * Extracted from tui/src/storage/file.ts so the CLI's corrections.json
 * writer/drainer can use identical lock semantics instead of forking a
 * second implementation.
 *
 * fs/promises is imported dynamically per-function, not statically at
 * module scope: this module is transitively imported by src/core/corrections.ts
 * -> src/core/processor.ts, which Web's Vite build bundles for the browser.
 * A static `import { readFile } from "fs/promises"` makes rollup try to
 * resolve named exports against Vite's browser-externalized stub, which
 * has none — that's a hard build failure, not a runtime one (same pattern
 * already used in src/cli.ts and src/cli/install.ts for this exact reason).
 */

const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_DELAY_MS = 50;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function getLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

/**
 * Acquire an advisory lock on filePath. Stale locks (older than
 * LOCK_TIMEOUT_MS) are broken automatically. Returns false if the lock
 * could not be acquired within LOCK_TIMEOUT_MS.
 */
export async function acquireLock(filePath: string): Promise<boolean> {
  const { readFile, writeFile, unlink } = await import(/* @vite-ignore */ "fs/promises");
  const lockPath = getLockPath(filePath);
  const startTime = Date.now();

  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    // readFile throws ENOENT when the lock is absent — treated the same as
    // "lock vanished mid-read" below: proceed straight to acquire.
    let lockContent: string | null = null;
    try {
      lockContent = await readFile(lockPath, "utf-8");
    } catch {
      lockContent = null;
    }

    if (lockContent !== null) {
      const lockTime = parseInt(lockContent, 10);
      if (!isNaN(lockTime) && Date.now() - lockTime > LOCK_TIMEOUT_MS) {
        try {
          await unlink(lockPath);
        } catch {}
      } else {
        await delay(LOCK_RETRY_DELAY_MS);
        continue;
      }
    }

    try {
      // "wx" = exclusive create, fails with EEXIST if the path already
      // exists. Without this flag, two callers that both observed the lock
      // as absent (the check above) could both reach this writeFile and
      // both succeed — writeFile has no atomicity of its own, it just
      // overwrites. "wx" makes the write itself the atomic test-and-set:
      // only one caller can win it, the other gets EEXIST and falls into
      // the catch below to retry from the top of the loop.
      await writeFile(lockPath, Date.now().toString(), { flag: "wx" });
      return true;
    } catch {
      await delay(LOCK_RETRY_DELAY_MS);
    }
  }

  return false;
}

export async function releaseLock(filePath: string): Promise<void> {
  const { unlink } = await import(/* @vite-ignore */ "fs/promises");
  const lockPath = getLockPath(filePath);
  try {
    await unlink(lockPath);
  } catch {}
}

/**
 * Run fn() while holding filePath's advisory lock. Throws
 * STORAGE_LOCK_TIMEOUT if the lock can't be acquired in time.
 */
export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const acquired = await acquireLock(filePath);
  if (!acquired) {
    throw new Error("STORAGE_LOCK_TIMEOUT: Could not acquire file lock");
  }
  try {
    return await fn();
  } finally {
    await releaseLock(filePath);
  }
}

/** Write content to filePath via temp-file + rename, so readers never see a partial write. */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const { writeFile, rename, unlink } = await import(/* @vite-ignore */ "fs/promises");
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(tempPath, content);
    await rename(tempPath, filePath);
  } catch (e) {
    try {
      await unlink(tempPath);
    } catch {}
    throw e;
  }
}
