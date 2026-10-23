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
 * One CD2+ transcript file located under a session tree's sibling directory, as returned
 * by `listTrees` — before its content has been parsed. `cd` is
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

/**
 * One session tree, as returned by `listTrees` — before any file has been
 * opened. `id` is the UUID segment of the root session file's name.
 * `transcripts` are the `.jsonl` files under the root file's sibling
 * directory. `newestMtimeMs` is the newest mtime over the root file and every
 * file under that directory, whatever its kind.
 */
export interface OmpTree {
  id: string;
  rootPath: string;
  transcripts: OmpTranscriptRecord[];
  newestMtimeMs: number;
}

export interface OmpMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** The persona named on the entry itself (main sessions); absent when the entry has none. */
  agent?: string;
  /** Who a user-role line came from: the parent agent or the human; absent when the line carries none. */
  attribution?: "agent" | "user";
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

/** One parsed transcript file, as returned by `readTranscript`. */
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
 * `integration`, `polling_interval_ms` and `extraction_model` are the keys
 * /settings edits (a plain `omp` block like the other integrations').
 * settingsFromYAML() carries every other field over from the live settings, so
 * a new runtime-managed field here needs no change there.
 */
export interface OmpSettings {
  integration?: boolean;
  polling_interval_ms?: number;
  extraction_model?: string;
  last_sync?: string;
  /**
   * Session tree id (the root session's UUID) -> the ISO time the tree's last
   * completed pass was planned at. One key per tree, none for a sub-agent
   * transcript; entries keyed by a transcript path from earlier versions are
   * ignored.
   */
  processed_sessions?: Record<string, string>;
  /**
   * The tree being imported block by block, written after each block's scans are
   * queued and cleared in the same write that records the tree's watermark.
   * `planned_at` is the pass's original planning time; `done` lists the members
   * whose scans were queued: a sub-agent transcript's key, or a main-session
   * canonical agent name with its transcript (never a persona, whose grouping can
   * change); a member with nothing to import is never listed.
   */
  current_tree?: { tree: string; planned_at: string; done: string[] };
}
