/**
 * Corrections Queue — external write path for CLI/MCP tools.
 *
 * Ei's CLI and MCP server are read-only against a snapshot of state.json —
 * they never hold the live StateManager the running TUI/daemon owns, so
 * they can't safely mutate state.json directly (the running instance's
 * next debounced save would silently clobber the write with its stale
 * in-memory copy).
 *
 * corrections.json is the queue that closes this gap. External writers
 * (ei_update / ei_create / ei_remove) append fully-formed CorrectionRecords
 * here under an advisory lock. Two consumers drain it:
 *   - The running Processor, once per runLoop tick (near-instant, ~100ms).
 *   - The CLI itself, self-draining directly into state.json when it
 *     detects no live instance is running (see src/cli/corrections-io.ts).
 *
 * Every CorrectionRecord is a complete, ready-to-apply entity — including
 * a pre-computed embedding and (for creates) a pre-assigned id — so
 * draining is a pure apply, never a fetch-then-merge.
 */

import type { HumanEntity, Fact, Topic, Person, Quote, PersonaEntity, StorageState } from "./types.js";
import { isReservedPersonaId } from "./types.js";
import { withLock, atomicWrite } from "../storage/file-lock.js";

export type CorrectableType = "fact" | "topic" | "person" | "quote" | "persona";
export type CorrectableEntity = Fact | Topic | Person | Quote | PersonaEntity;
export const CORRECTABLE_TYPES: CorrectableType[] = ["fact", "topic", "person", "quote", "persona"];

export interface CorrectionUpsert {
  op: "upsert";
  entity_type: CorrectableType;
  id: string;
  record: CorrectableEntity;
  timestamp: string;
}

export interface CorrectionRemove {
  op: "remove";
  entity_type: CorrectableType;
  id: string;
  timestamp: string;
}

export type CorrectionRecord = CorrectionUpsert | CorrectionRemove;

/**
 * Runtime shape validation for a CorrectionRecord read back from
 * corrections.json. The TypeScript union is compile-time only — every
 * record actually enters the system via `JSON.parse(...) as CorrectionRecord`
 * in readCorrections(), so a malformed-but-valid-JSON record (bad `op`,
 * mismatched `record.id`, missing `record` on an upsert) is otherwise
 * silently trusted. Both consumers (CLI read-merge/self-drain via
 * applyCorrectionToHuman, and Processor.applyCorrectionRecord) call this
 * before mutating anything — it throws, never coerces, so a malformed `op`
 * can never be silently treated as its sibling operation.
 */
export function assertValidCorrection(value: unknown): asserts value is CorrectionRecord {
  if (!value || typeof value !== "object") {
    throw new Error(`Malformed correction record: expected an object, got ${JSON.stringify(value)}`);
  }
  if (!("op" in value) || (value.op !== "upsert" && value.op !== "remove")) {
    throw new Error(`Malformed correction record: op must be "upsert" or "remove", got ${JSON.stringify("op" in value ? value.op : undefined)}`);
  }
  if (!("entity_type" in value) || !CORRECTABLE_TYPES.includes(value.entity_type as CorrectableType)) {
    throw new Error(`Malformed correction record: entity_type must be one of ${CORRECTABLE_TYPES.join(", ")}, got ${JSON.stringify("entity_type" in value ? value.entity_type : undefined)}`);
  }
  if (!("id" in value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`Malformed correction record: id must be a non-empty string, got ${JSON.stringify("id" in value ? value.id : undefined)}`);
  }
  if (value.op === "upsert") {
    if (!("record" in value) || !value.record || typeof value.record !== "object") {
      throw new Error(`Malformed correction record: upsert requires a record object`);
    }
    if (!("id" in value.record) || value.record.id !== value.id) {
      throw new Error(`Malformed correction record: record.id (${JSON.stringify("id" in value.record ? value.record.id : undefined)}) must equal wrapper id (${JSON.stringify(value.id)})`);
    }
  }
}

/**
 * Read pending corrections without a lock. Returns [] if the file doesn't
 * exist or is empty. fs/promises is imported dynamically, not statically —
 * this module is transitively bundled into Web's browser build via
 * src/core/processor.ts, and a static `import { readFile } from "fs/promises"`
 * fails Vite's rollup build (no named exports on the browser-externalized
 * stub), not just at runtime.
 */
export async function readCorrections(correctionsPath: string): Promise<CorrectionRecord[]> {
  const { readFile } = await import(/* @vite-ignore */ "fs/promises");
  let text: string;
  try {
    text = await readFile(correctionsPath, "utf-8");
  } catch {
    return [];
  }
  if (!text) return [];
  return JSON.parse(text) as CorrectionRecord[];
}

/**
 * Append one correction under lock (read-modify-write — corrections.json
 * is a JSON array, not an append-only log, so concurrent writers must
 * serialize through the same lock rather than racing on a blind append).
 */
export async function appendCorrection(
  correctionsPath: string,
  record: CorrectionRecord
): Promise<void> {
  await withLock(correctionsPath, async () => {
    const existing = await readCorrections(correctionsPath);
    existing.push(record);
    await atomicWrite(correctionsPath, JSON.stringify(existing, null, 2));
  });
}

/**
 * Merge a person's `name` from its primary identifier, replicating the
 * invariant HumanState.person_upsert enforces on the live-write path
 * (CONTRACTS.md "Person Identifiers — name Sync Rule"). Both consumers of
 * this module (Live's StateManager and the CLI's self-drain) must produce
 * an identical HumanEntity for a given corrections.json, so the formula
 * is centralized here rather than re-derived at each call site.
 */
function syncPersonName(person: Person): Person {
  const identifiers = person.identifiers ?? [];
  const primary = identifiers.find((i) => i.is_primary) ?? identifiers[0];
  return primary ? { ...person, name: primary.value } : person;
}

/**
 * Resolve the target array for a CorrectableType. Throws on anything
 * other than the 4 known types — corrections.json is external input from
 * CLI/MCP tools (potentially LLM-driven), and a malformed entity_type must
 * never silently fall through to the people array. Live's Processor
 * already enforces this (applyCorrectionRecord); this is the equivalent
 * guard for the CLI read-merge and self-drain paths.
 */
function getCorrectableArray(human: HumanEntity, entityType: string): Array<{ id: string }> {
  if (entityType === "fact") return human.facts;
  if (entityType === "topic") return human.topics;
  if (entityType === "person") return human.people;
  if (entityType === "quote") return human.quotes;
  throw new Error(`Unrecognized correction entity_type: ${entityType}`);
}

/**
 * Apply one correction to a HumanEntity in place, mirroring the exact
 * upsert/remove semantics of HumanState (src/core/state/human.ts) —
 * replace-by-id for upsert, splice + orphaned quote-reference cleanup for
 * remove (for all 3 types, matching fact_remove/topic_remove/person_remove
 * in HumanState — not just person). Used by both the CLI's read-merge
 * (materializing a corrected view without a StateManager) and its
 * self-drain (writing corrections straight into state.json when no live
 * instance is running).
 */
export function applyCorrectionToHuman(human: HumanEntity, correction: CorrectionRecord): void {
  assertValidCorrection(correction);
  const array = getCorrectableArray(human, correction.entity_type);

  if (correction.op === "remove") {
    const idx = array.findIndex((item) => item.id === correction.id);
    if (idx < 0) return;
    array.splice(idx, 1);
    human.quotes.forEach((q) => {
      q.data_item_ids = q.data_item_ids.filter((itemId) => itemId !== correction.id);
    });
    human.last_updated = new Date().toISOString();
    return;
  }

  const record = correction.entity_type === "person"
    ? syncPersonName(correction.record as Person)
    : correction.record;
  const idx = array.findIndex((item) => item.id === correction.id);
  if (idx >= 0) {
    array[idx] = record;
  } else {
    array.push(record);
  }
  human.last_updated = new Date().toISOString();
}

/** Apply every pending correction to a HumanEntity, in file order (later records for the same id win). */
export function applyCorrectionsToHuman(human: HumanEntity, corrections: CorrectionRecord[]): void {
  for (const correction of corrections) {
    applyCorrectionToHuman(human, correction);
  }
}

/**
 * Apply one correction to a StorageState's personas map in place. Personas
 * live outside HumanEntity — src/core/types/integrations.ts's StorageState.personas
 * is a top-level `Record<id, {entity, messages}>` — so they need their own
 * apply function rather than routing through getCorrectableArray/
 * applyCorrectionToHuman, which only ever resolve arrays on HumanEntity.
 *
 * The reserved-persona delete guard here is defense-in-depth for a
 * hand-edited corrections.json: the primary guard is the SYNCHRONOUS check
 * in src/cli/persona-corrections.ts's removePersonaEntity, which runs
 * before a correction is ever queued (so a live-drained rejection here can
 * never surface as a silent no-op after an apparent CLI success).
 */
export function applyCorrectionToPersonas(personas: StorageState["personas"], correction: CorrectionRecord): void {
  assertValidCorrection(correction);
  if (correction.op === "remove") {
    if (isReservedPersonaId(correction.id)) {
      throw new Error(`Cannot delete reserved persona "${correction.id}". Use archive instead.`);
    }
    delete personas[correction.id];
    return;
  }
  personas[correction.id] = {
    entity: correction.record as PersonaEntity,
    messages: personas[correction.id]?.messages ?? [],
  };
}

/** Route one correction to its target: the personas map for entity_type "persona", the HumanEntity for everything else. */
export function applyCorrectionToState(state: StorageState, correction: CorrectionRecord): void {
  if (correction.entity_type === "persona") {
    applyCorrectionToPersonas(state.personas, correction);
  } else {
    applyCorrectionToHuman(state.human, correction);
  }
}

/** Apply every pending correction to a StorageState, in file order (later records for the same id win). */
export function applyCorrectionsToState(state: StorageState, corrections: CorrectionRecord[]): void {
  for (const correction of corrections) {
    applyCorrectionToState(state, correction);
  }
}
