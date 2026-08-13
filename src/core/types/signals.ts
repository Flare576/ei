/**
 * PersonaObservation / EmergentSignal types (GH #97, Bolt 003)
 * Source of truth: CONTRACTS.md
 *
 * These are the durable, attributed replacement for the old append-only
 * Persona-linked Person "living identity log" (see GH #97's body). This
 * Bolt (persona-emergence-signals-003) defines the data shape and its
 * persistence/hydration contract only — no classification, matching, or
 * promotion logic lives here (that's Bolt 004), and no CLI/MCP write
 * surface (that's Bolt 008).
 */

/** Who is testifying about the subject Persona. */
export type ObserverKind = "human" | "subject_self" | "other_persona";

/** What aspect of either lens (Persona identity / Agent operating-contract)
 * a claim addresses. Orthogonal to lens — lens classification is a Bolt 004
 * concern, not encoded here. */
export type SignalDimension = "behavior" | "voice" | "values" | "relationship" | "identity";

/** How a single observation relates to the current understanding of the subject. */
export type SignalDirection = "novel" | "confirms" | "challenges";

/** Lifecycle state of an EmergentSignal. `superseded` is set on a dismissed
 * signal only once a reopen (Bolt 004's own D9/R5) actually creates a
 * replacement candidate that cites it via `supersedes_signal_id`. */
export type SignalStatus = "candidate" | "recurring" | "reviewed" | "dismissed" | "superseded";

/** Actor + timestamp pair recording a human review action (D3). Written
 * only by Bolt 008's confirm/dismiss operations, never by automatic
 * promotion logic. */
export interface SignalAudit {
  actor: string;
  timestamp: string;
}

/**
 * Compact, attributed testimony with source pointers — GH #97's own schema,
 * plus `id` (D1: a new stable identifier, since `EmergentSignal.evidence_ids`
 * needs a durable target to reference and GH #97's own sketch didn't list
 * one explicitly).
 */
export interface PersonaObservation {
  id: string;
  subject_person_id: string;
  subject_persona_id: string;
  observer_kind: ObserverKind;
  observer_persona_id?: string;
  message_id: string;
  quote_id?: string;
  observed_at: string;
  dimension: SignalDimension;
  direction: SignalDirection;
  claim: string;
  extraction_confidence: number;
  /** True only when this observation was minted by Bolt 008's Add
   * Observation write surface (`applyObservationAddToState`, the sole
   * caller that sets it) rather than the extraction pipeline's own
   * Scan/Extract step — provenance metadata, never accepted as a
   * caller-supplied field on the wire (`CorrectionObservationAdd.observation`
   * omits it), same "derived from execution context, never a retrofit body
   * field" discipline ADR-031 already applies to `learned_by`/
   * `last_changed_by`. Bolt 008 D11: an `other_persona` observation with
   * this set is excluded from `PersonaState`'s automatic candidate→
   * recurring independence tally (`independentContextCount`) — a bare,
   * self-attested `observer_persona_id` claim with no analyzed-message
   * anchor is weaker evidence than an extraction-derived one and must not
   * drive automatic promotion on its own strength (Sisyphus's ruling,
   * `.sisyphus/issues/persona-signal-caller-attribution-needs-ruling.md`).
   * Absent/`false` for every extraction-produced observation. */
  direct_write?: boolean;
  /** Verified execution provenance (Bolt 009, ADR-038 item 8) — mirrors
   * `AgentProvenance` (`core/utils/persona-signal-lens.ts`) field-for-field,
   * but optional here: set only when `classifyObservationLens` resolved
   * this observation to its `{lens: "agent", provenance}` branch, and
   * persisted at that same moment by the Scan handler
   * (`handlePersonaSignalScan`). An ordinary in-Ei, extraction-produced
   * observation, or one classified to the Persona lens, carries none of
   * these fields — never populated by inference, never caller-supplied on
   * the wire. Stint-level holistic review, Bucket 1 finding I1
   * (2026-08-11): these five fields previously reached
   * `classifyObservationLens` as transient queue-request data only,
   * never persisted here, so nothing survived past the queued request. */
  harness?: string;
  agent_id?: string;
  agent_definition_ref?: string;
  definition_revision?: string;
  mode?: string;
}

/**
 * A bounded, reviewable grouping of corroborating or contradictory
 * observations — GH #97's own schema, plus the D3 audit/lifecycle fields.
 * `evidence_ids` resolves against a `PersonaObservation.id`, never against
 * `message_id`/`quote_id` directly.
 */
export interface EmergentSignal {
  /** Stable identifier, minted by the state module's `signal_add` at write
   * time — same minting convention as `PersonaObservation.id`, never
   * caller-supplied (D5). `supersedes_signal_id` names another signal's
   * `id` field directly. */
  id: string;
  subject_persona_id: string;
  claim: string;
  dimension: SignalDimension;
  status: SignalStatus;
  evidence_ids: string[];
  first_observed_at: string;
  last_observed_at: string;
  observer_kinds: ObserverKind[];
  recurrence_count: number;
  /** Set only on a signal created by reopening a dismissed one (Bolt 004's
   * own D9/R5 reads and writes this field) — the dismissed signal's own id. */
  supersedes_signal_id?: string;
  /** Set at heartbeat candidate-list assembly time (Bolt 005's own D2/R2
   * reads and writes this field). */
  last_surfaced_at?: string | null;
  /** D3 audit fields — written only by Bolt 008's confirm/dismiss operations. */
  reviewed_by?: SignalAudit;
  dismissed_by?: SignalAudit;
}

/** Persona-lens signal — identical shape to `EmergentSignal`; the bucket it
 * lives in (`signals.persona`) is what carries the lens distinction. */
export type PersonaSignal = EmergentSignal;

/** Agent-lens signal — identical shape to `EmergentSignal`; the bucket it
 * lives in (`signals.agent`) is what carries the lens distinction. */
export type AgentSignal = EmergentSignal;

/** The two non-overlapping lens buckets a persona's signals live in (D2). */
export interface PersonaSignalCollections {
  persona: PersonaSignal[];
  agent: AgentSignal[];
}
