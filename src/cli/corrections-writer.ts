/**
 * CLI-side write path for ei_update / ei_create / ei_remove.
 *
 * Every correction is appended to corrections.json under lock. If a live
 * Ei instance (TUI or future daemon, #76) holds ei.lock, that's the only
 * thing this module does — the running Processor drains corrections.json
 * on its own runLoop tick (~100ms).
 *
 * If no live instance holds the lock, this module self-drains directly
 * into state.json instead of leaving the correction to wait indefinitely
 * for a TUI session that may not start for days. This is safe specifically
 * because "no live instance" means nothing holds an in-memory StateManager
 * that could later overwrite the write with a stale copy — the hazard
 * corrections.json exists to avoid only applies while an instance is live.
 *
 * Sync users are a distinct case from "no state.json": on clean TUI exit,
 * state.json is renamed to state.backup.json and pushed to the remote
 * store (see moveToBackup() in tui/src/storage/file.ts and the ceremony
 * around RemoteSync). A missing state.json with a present state.backup.json
 * is NOT an error — it means the next TUI launch will pull remote state
 * fresh, and self-draining into a hand-rolled state.json here would create
 * a conflicting local state the next launch has to reconcile. In that case
 * the correction queues in corrections.json and waits for the next TUI
 * session, same as if a live instance's runLoop just hadn't ticked yet.
 */

import { join } from "path";
import { readFile, access } from "fs/promises";
import { getDataPath } from "./retrieval.js";
import { withLock, atomicWrite } from "../storage/file-lock.js";
import { appendCorrection, readCorrections, applyCorrectionsToStateWithMerges, resolveMergedEmbedding } from "../core/corrections.js";
import type { CorrectionRecord, QuoteCorrectionSkip, QuoteCorrectionMerge } from "../core/corrections.js";
import type { PersonaLinkRefusal } from "../core/utils/identifier-utils.js";
import { encodeAllEmbeddings, decodeAllEmbeddings } from "../storage/embeddings.js";
import type { StorageState } from "../core/types.js";

const STATE_FILE = "state.json";
const BACKUP_FILE = "state.backup.json";
const LOCK_FILE = "ei.lock";
const CORRECTIONS_FILE = "corrections.json";

export function getCorrectionsPath(): string {
  return join(getDataPath(), CORRECTIONS_FILE);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** True if a live Ei instance (TUI or daemon) currently holds ei.lock. */
async function isLiveInstanceRunning(): Promise<boolean> {
  const lockPath = join(getDataPath(), LOCK_FILE);
  let lockText: string;
  try {
    lockText = await readFile(lockPath, "utf-8");
  } catch {
    return false;
  }
  let lock: { pid: number };
  try {
    lock = JSON.parse(lockText) as { pid: number };
  } catch {
    return false;
  }
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which branch of writeCorrection() actually ran, so a caller can tell an
 * authoritative result from one that hasn't happened yet (I8,
 * .sisyphus/reviews/wave-2-quote-attestation.md):
 *   - `"self"`: this call itself validated and applied the record (plus
 *     every pre-existing pending correction) synchronously. `skipped` is
 *     final here — if this call's own record isn't in it, it applied.
 *   - `"queued"`: the record was only appended (live instance running, or
 *     backup-only/sync-pending) — `skipped` is always `[]` on this branch
 *     because nothing has been validated yet, not because nothing was
 *     declined. A live Processor drains and validates corrections.json on
 *     its own loop, in its own process (src/core/processor.ts); that
 *     outcome is not observable synchronously from here — re-deriving it
 *     via a fresh loadLatestState() overlay is a genuine race, since the
 *     live Processor can drain and clear the queue between this call
 *     returning and any such follow-up read. Callers must report an
 *     honest "queued, not yet confirmed" outcome for this branch instead
 *     of attempting any further verification.
 */
export interface WriteCorrectionResult {
  skipped: QuoteCorrectionSkip[];
  /**
   * Every quote.create/quote.fix merge (ADR-030) this self-drain
   * performed, across the whole batch — always `[]` on the "queued"
   * branch, for the identical reason `skipped` is: a queued write has
   * not been evaluated yet, so it cannot have merged (or been declined)
   * synchronously. createQuoteEntity/fixQuoteEntity look up THIS call's
   * own record by attempt_id, exactly as they already do against
   * `skipped`.
   */
  merged: QuoteCorrectionMerge[];
  /**
   * Every Person-entity Ei Persona link this self-drain declined to
   * create, across the whole batch (ADR-006/ADR-010) — always `[]` on the
   * "queued" branch for the same reason `skipped`/`merged` are: a queued
   * write is validated later, by the live drain, against state this call
   * never sees. A caller looks up its own outcome by `personId`, the same
   * way create/fixQuoteEntity look theirs up by `attempt_id`.
   */
  personLinkRefusals: PersonaLinkRefusal[];
  drainMode: "self" | "queued";
}

/**
 * Apply a correction. Appends to corrections.json for a live-drained
 * pickup, or self-drains straight into state.json when nothing is running
 * to pick it up. Throws if neither state.json nor state.backup.json exist
 * (no Ei data at this EI_DATA_PATH — misconfiguration, not a sync gap).
 *
 * Returns every Quote correction skipped during this call's self-drain
 * (wrong shape, forbidden key, marker misuse, or a stale relink target)
 * alongside `drainMode` — see WriteCorrectionResult above for what each
 * value means and why a caller must treat them differently.
 */
export async function writeCorrection(record: CorrectionRecord): Promise<WriteCorrectionResult> {
  const dataPath = getDataPath();
  const correctionsPath = join(dataPath, CORRECTIONS_FILE);

  if (await isLiveInstanceRunning()) {
    await appendCorrection(correctionsPath, record);
    return { skipped: [], merged: [], personLinkRefusals: [], drainMode: "queued" };
  }

  const statePath = join(dataPath, STATE_FILE);
  const stateExists = await pathExists(statePath);

  if (!stateExists) {
    const backupExists = await pathExists(join(dataPath, BACKUP_FILE));
    if (!backupExists) {
      throw new Error(`No Ei data found at ${dataPath}. Is EI_DATA_PATH set correctly?`);
    }
    // Sync user, TUI currently closed — state.json will reappear on next
    // TUI launch (pulled from remote). Queue for that drain instead of
    // fabricating a local state.json that would conflict with the pull.
    await appendCorrection(correctionsPath, record);
    return { skipped: [], merged: [], personLinkRefusals: [], drainMode: "queued" };
  }

  // No live instance and state.json exists — safe to self-drain directly.
  // Re-check liveness after acquiring the lock to shrink the race window
  // where a TUI/daemon starts between the check above and the write below.
  return await withLock(statePath, async (): Promise<WriteCorrectionResult> => {
    if (await isLiveInstanceRunning()) {
      await appendCorrection(correctionsPath, record);
      return { skipped: [], merged: [], personLinkRefusals: [], drainMode: "queued" };
    }

    // Read pending corrections, apply them (plus the new record), and clear
    // the queue — all under correctionsPath's own lock, not just statePath's.
    // Locking only statePath here left a window where a concurrent
    // appendCorrection() (which locks correctionsPath, not statePath) could
    // write a new record between our unlocked read and our unconditional
    // "[]" clear, silently discarding it. Nesting the correctionsPath lock
    // inside statePath's serializes against every other writer of that file.
    return await withLock(correctionsPath, async (): Promise<WriteCorrectionResult> => {
      const text = await readFile(statePath, "utf-8");
      const state = decodeAllEmbeddings(JSON.parse(text) as StorageState);

      const pending = await readCorrections(correctionsPath);
      // Authoritative drain-time cardinality check (ADR-006/ADR-010): this
      // validates the merged candidate against the state just read from
      // disk, not a stale snapshot taken before queueing — see corrections.ts's
      // applyCorrectionsToStateWithMerges doc comment.
      const { skipped, merged, personLinkRefusals } = await applyCorrectionsToStateWithMerges(state, [...pending, record]);
      // I2: a widened merge's embedding may only be pickMergedEmbedding's
      // best-effort placeholder (QuoteCorrectionMerge.embeddingStale) --
      // recompute it against the actual persisted union text before this
      // is written to disk. `m.quote` is the exact same object reference
      // already sitting in `state.human.quotes` (applyQuoteOperation's
      // merge branches never clone it), so mutating it here also updates
      // the record about to be persisted.
      for (const m of merged) {
        if (m.embeddingStale) {
          m.quote.embedding = await resolveMergedEmbedding(m);
        }
      }
      state.timestamp = new Date().toISOString();

      // State write happens before the queue clear: if we crash in between,
      // the next run still sees the pending records in corrections.json and
      // safely re-applies them (upsert/remove are idempotent by id).
      await atomicWrite(statePath, JSON.stringify(encodeAllEmbeddings(state), null, 2));
      await atomicWrite(correctionsPath, "[]");
      return { skipped, merged, personLinkRefusals, drainMode: "self" };
    });
  });
}
