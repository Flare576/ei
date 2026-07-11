import { join, dirname } from "path";
import { mkdir, rename, unlink } from "fs/promises";

const LOCAL_STATE_FILE = "local.json";

/**
 * Per-machine local state, stored at `$EI_DATA_PATH/local.json`.
 *
 * Unlike `state.json`, this file is NEVER synced or merged across machines —
 * it holds install/version bookkeeping that is intrinsically tied to this
 * one install (e.g. "which harness version's onboarding/install steps have
 * already run here"). Do not add synced settings or secrets to this shape.
 */
export interface LocalState {
  installed_version?: string;
}

/**
 * Read local.json. Null-safe: a missing file or unparseable JSON both
 * resolve to `{}` — this must never throw, since it runs on every launch
 * before anything else about the data path is guaranteed to be set up.
 */
export async function readLocalState(dataPath: string): Promise<LocalState> {
  try {
    const file = Bun.file(join(dataPath, LOCAL_STATE_FILE));
    if (!(await file.exists())) return {};
    const text = await file.text();
    return JSON.parse(text) as LocalState;
  } catch {
    return {};
  }
}

/**
 * Read-merge-write `patch` into local.json. Writes atomically via a
 * temp-file-then-rename so a concurrent reader never observes a partially
 * written file, and unrelated existing keys are preserved.
 */
export async function writeLocalState(dataPath: string, patch: Partial<LocalState>): Promise<void> {
  const targetPath = join(dataPath, LOCAL_STATE_FILE);
  await mkdir(dirname(targetPath), { recursive: true });

  const current = await readLocalState(dataPath);
  const merged: LocalState = { ...current, ...patch };

  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    await Bun.write(tempPath, JSON.stringify(merged, null, 2));
    await rename(tempPath, targetPath);
  } catch (e) {
    try {
      await unlink(tempPath);
    } catch {
      // Temp file was never created, or is already gone — fine.
    }
    throw e;
  }
}

/** Convenience: read only the `installed_version` stamp. */
export async function getInstalledVersion(dataPath: string): Promise<string | undefined> {
  return (await readLocalState(dataPath)).installed_version;
}

/** Convenience: stamp `installed_version`, preserving other local.json keys. */
export async function setInstalledVersion(dataPath: string, version: string): Promise<void> {
  await writeLocalState(dataPath, { installed_version: version });
}
