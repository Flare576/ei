
/**
 * Verified execution provenance for a claim sourced from a Cognitive
 * Distance 2+ transcript (GH #100, ADR-038 item 8) — captured at ingestion
 * time from that transcript's own `session_init`, never inferred from
 * current, mutable state. Bolt 004 only classifies against this shape;
 * producing it from a real transcript is Bolt 009's own importer.
 */
export interface AgentProvenance {
  harness: string;
  agent_id: string;
  agent_definition_ref: string;
  /** SHA-256 content hash of the transcript's own `session_init.systemPrompt`
   * (ADR-038 item 8) — a new value for the same `agent_id` is a new,
   * independent baseline, never drift against a prior one. This module
   * never compares revisions across calls; each classification is judged
   * on its own provenance object alone. */
  definition_revision: string;
  mode: string;
}

export type ObservationLensClassification =
  | { lens: "persona" }
  | { lens: "agent"; provenance: AgentProvenance }
  /** Agent-shaped evidence exists but the supplied provenance is
   * incomplete/unverified for this source — distinct from "persona" (D6,
   * Spec §4.5): this is a recoverable data gap, not the structural
   * no-Agent-lens fact below. */
  | { lens: "needs_agent_provenance" };

/**
 * D6 revised (2026-08-19, Flare's ruling): lens classification is driven
 * ENTIRELY by whether verified execution provenance is complete — never by
 * which persona the claim is about. The original version of this file
 * hardcoded `persona.id !== "ei"` as a structural veto, on the assumption
 * that Ei's own persona could never be dispatched as a coding-harness
 * agent. That assumption isn't a permanent architectural fact — it's a
 * fact about the world that a human can change at any time (e.g. by
 * defining an OMP agent using Ei's identity), and the veto would then
 * silently discard genuine, complete provenance instead of recording it.
 * The ruling: this module never tells a caller its claim is "the wrong
 * kind of behavior" for a given persona — worst case on a bad-faith or
 * mistaken caller is a misclassified claim, still recorded, never a
 * refusal. Whether a persona plausibly has a harness operating contract is
 * exactly and only what `isCompleteProvenance` below already checks: no
 * real CD2+ transcript will ever produce complete provenance for a persona
 * that was never dispatched as a coding agent, so that case already
 * resolves to "persona" lens on its own, with no separate identity check
 * needed.
 */

const REQUIRED_PROVENANCE_FIELDS: Array<keyof AgentProvenance> = [
  "harness",
  "agent_id",
  "agent_definition_ref",
  "definition_revision",
  "mode",
];

function isCompleteProvenance(provenance: Partial<AgentProvenance>): provenance is AgentProvenance {
  return REQUIRED_PROVENANCE_FIELDS.every((field) => {
    const value = provenance[field];
    return typeof value === "string" && value.length > 0;
  });
}

/**
 * D6/§4.5's classifier (revised 2026-08-19): lens is decided SOLELY by
 * verified execution provenance completeness — never by `dimension`
 * (dimension is orthogonal — it says what aspect of whichever lens a claim
 * addresses, decided elsewhere) and never by which persona the claim
 * names (see this file's header comment). Provenance is `undefined`/`null`
 * for ordinary in-Ei conversation, where no CD2+ transcript backs the
 * claim at all — that always lands on the Persona lens.
 */
export function classifyObservationLens(
  provenance?: Partial<AgentProvenance> | null
): ObservationLensClassification {
  if (!provenance) {
    return { lens: "persona" };
  }
  if (!isCompleteProvenance(provenance)) {
    return { lens: "needs_agent_provenance" };
  }
  return { lens: "agent", provenance };
}
