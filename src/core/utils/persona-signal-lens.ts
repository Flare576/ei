import type { PersonaEntity } from "../types/entities.js";

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
 * D6 (Spec §4.5/§4.16): a Persona with no harness operating contract
 * structurally never produces an Agent-lens signal, regardless of content.
 * Ei's own persona (the reserved id "ei") is the only current instance —
 * named explicitly by the Spec, not inferred from `is_static`/aliases/any
 * other heuristic that could accidentally match a user-created persona.
 */
export function personaHasHarnessOperatingContract(persona: PersonaEntity): boolean {
  return persona.id !== "ei";
}

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
 * D6/§4.5's classifier: lens is decided by verified execution provenance,
 * never by `dimension` (dimension is orthogonal — it says what aspect of
 * whichever lens a claim addresses, decided elsewhere). Provenance is
 * `undefined`/`null` for ordinary in-Ei conversation, where no CD2+
 * transcript backs the claim at all — those always land on the Persona
 * lens, the same as a Persona with no harness contract.
 */
export function classifyObservationLens(
  persona: PersonaEntity,
  provenance?: Partial<AgentProvenance> | null
): ObservationLensClassification {
  if (!personaHasHarnessOperatingContract(persona)) {
    return { lens: "persona" };
  }
  if (!provenance) {
    return { lens: "persona" };
  }
  if (!isCompleteProvenance(provenance)) {
    return { lens: "needs_agent_provenance" };
  }
  return { lens: "agent", provenance };
}
