/**
 * OMP (oh-my-pi) Cognitive-Distance-2+ Sub-Agent Transcript Ingestion Types
 *
 * D1 (Bolt 009, Spec §4.13): OMP's session model is tree-shaped, not the
 * flat single-session shape `IPiReader` exposes — this contract is
 * deliberately its own, never a reuse of `pi/types.ts`'s shape, even though
 * the two integrations share a JSONL entry format and a lazy-Node-module
 * loading pattern for browser safety.
 */

import type { AgentProvenance } from "../../core/utils/persona-signal-lens.js";

// ============================================================================
// Reader Contract
// ============================================================================

/**
 * One CD2+ transcript file located under a session directory, as returned
 * by `listTranscripts` — before its content has been parsed. `cd` is
 * computed from directory depth (D2), never from the filename's own
 * dot-count. `label` is read off the filename's last dot-segment (the
 * segment after the final `.`, or the whole stem for a CD2 file with no
 * dot) — display-only, never used for CD math.
 */
export interface OmpTranscriptRecord {
  path: string;
  cd: number;
  label: string;
}

export interface OmpMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/**
 * Provenance derived from a transcript's own `session_init` event (D3,
 * Spec §4.13's field table). `harness`/`mode` are always populated
 * (constants, implicit in using this reader at all); `agent_id`/
 * `agent_definition_ref`/`definition_revision` are `undefined` whenever
 * the source data they're sourced from (`session_init` itself, its
 * `.agent`, its `.systemPrompt`, respectively) is missing — never
 * populated by inference. A structural subset of `Partial<AgentProvenance>`
 * so it forwards directly into `classifyObservationLens`/
 * `queuePersonaSignalScan` without reshaping.
 */
export interface OmpProvenance extends Partial<AgentProvenance> {
  harness: "omp";
  mode: "delegated";
}

/** One parsed CD2+ transcript, as returned by `readTranscript`. */
export interface OmpSession {
  path: string;
  provenance: OmpProvenance;
  messages: OmpMessage[];
  firstMessageAt: string | null;
  lastMessageAt: string | null;
}

// ============================================================================
// Human Settings Shape
// ============================================================================

/**
 * Stored under human.settings.omp.
 *
 * WARNING: ADDING A NEW FIELD HERE?
 * If it is runtime-managed (not user-editable), also preserve it in
 * settingsFromYAML() in tui/src/util/yaml-settings.ts or /settings will
 * wipe it. D6 (this Bolt): no settings-UI toggle exists for `omp` at all,
 * so it is not a key that parser knows about — every field here already
 * round-trips untouched via that function's own `{ ...original, ... }`
 * merge, which never lists `omp` as one of the keys it overwrites.
 */
export interface OmpSettings {
  integration?: boolean;
  polling_interval_ms?: number;
  extraction_model?: string;
  last_sync?: string;
  /** transcript path -> ISO timestamp this transcript was imported at. */
  processed_sessions?: Record<string, string>;
}
