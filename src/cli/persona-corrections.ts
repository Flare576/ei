/**
 * Validated create/update/remove endpoints for persona corrections —
 * `ei create/update/remove persona` (CLI, src/cli.ts) and
 * `ei_create`/`ei_update`/`ei_remove` with entity_type "persona" (MCP,
 * src/cli/mcp.ts).
 *
 * Deliberately NOT folded into the shared SCHEMAS dispatch in
 * corrections-endpoints.ts — mirrors that module's own dedicated quote
 * paths (createQuoteEntity/fixQuoteEntity/relinkQuoteEntity/
 * removeQuoteEntity), which already bypass the shared machinery for a type
 * with a distinct shape. PersonaEntity's nested traits[]/topics[] need
 * structural checks (id uniqueness, id auto-assignment) a flat Zod object
 * doesn't give for free, and this keeps Persona's validation free to harden
 * independently of fact/topic/person. `updatePersonaEntity` shares
 * corrections-endpoints.ts's ADR-029 merge-patch mechanism (deriveSchemaPair,
 * resolvePersonaPatchCandidate) rather than its own hand-rolled copy.
 *
 * Unlike Quote — whose four verbs are each deliberately narrow, because a
 * quote asserts that a real person really said something, so create/fix
 * must verify that text against a resolved source message and relink/remove
 * must assert nothing about it — Persona corrections are full CRUD:
 * personas are authored, disposable-by-design artifacts, so there's no
 * epistemic reason to restrict create/remove. The only restriction is
 * DELETE of a reserved persona (RESERVED_PERSONA_IDS — "ei", "emmet"),
 * rejected SYNCHRONOUSLY in removePersonaEntity below, before the
 * correction is ever queued — see that function's comment for why the
 * check can't just live in Processor.applyCorrectionRecord's drain-time
 * guard. A reserved persona's IDENTITY (display_name, traits, topics, ...)
 * is freely editable through this path; that's expected and desired (Ei
 * self-gendering mid-conversation was the origin of the Reflection
 * feature).
 *
 * `create` keeps the pre-ADR-029 full-body contract: display_name is
 * required, traits/topics default exactly as before. `update` is RFC
 * 7396 JSON Merge Patch (ADR-029): omitting a
 * field leaves it unchanged, `traits: []` genuinely empties the array.
 * `tools`/`model`/`heartbeat_delay_ms`/`context_window_ms`/
 * `include_message_timestamps`/`context_boundary`/`is_paused`/
 * `pause_until`/`is_archived`/`archived_at`/`group_primary`/
 * `groups_visible`/`show_thinking` are gone from BOTH create and update
 * entirely (ADR-031: System Hidden or System Visible — never externally
 * writable).
 */

import { z } from "zod";
import { loadLatestState } from "./retrieval.js";
import { writeCorrection } from "./corrections-writer.js";
import { computePersonaDescriptionEmbedding } from "../core/embedding-service.js";
import { CorrectionValidationError } from "./corrections-endpoints.js";
import { resolvePersonaPatchCandidate, resolveOwnPersona, isParseableIso8601 } from "../core/corrections.js";
import { isReservedPersonaName, isReservedPersonaId, RESERVED_PERSONA_NAMES } from "../core/types/entities.js";
import type { PersonaEntity } from "../core/types/entities.js";
import type { PersonaTrait, PersonaTopic } from "../core/types/data-items.js";
import type { PersonaObservation, EmergentSignal } from "../core/types/signals.js";
import type { CorrectionRecord, MergePatch, CorrectionObservationAdd, CorrectionSignalConfirm, CorrectionSignalDismiss } from "../core/corrections.js";
import { stripControlChars } from "../core/utils/message-refusal.js";
// `personaBaseShape`/`personaTraitSchema`/`personaTopicSchema` and the
// derived create/patch/candidate schemas now live in
// `src/core/entity-schemas.ts` (relocated 2026-08-07, Beta's review
// [I3]) — core's own drain-time candidate validation
// (resolvePersonaPatchCandidate) needs the SAME real Zod schemas this
// CLI layer parses input against, not a hand-maintained shadow of them.
import {
  personaTraitSchema,
  personaTopicSchema,
  personaCreateSchema as personaEntitySchema,
  personaPatchSchema,
  personaCandidateSchema,
  stripHiddenPersonaFields,
  formatValidationIssues,
  type ExternalPersonaEntity,
} from "../core/entity-schemas.js";

const DEFAULT_GROUP = "General";

type PersonaEntityInput = z.infer<typeof personaEntitySchema>;
type PersonaPatchInput = z.infer<typeof personaPatchSchema>;
export { personaCandidateSchema, personaPatchSchema };


/**
 * Server-owned fields silently stripped from the INPUT payload before
 * schema validation on UPDATE — a caller following the documented
 * `ei --id <persona>` -> edit -> `ei update persona` round-trip naturally
 * sends these back unchanged. Wider than corrections-endpoints.ts's
 * ROUND_TRIP_FIELDS (id/type/last_updated/linked_quotes) because
 * lookupById's crossFind spreads the FULL PersonaEntity (plus its own
 * `type: "persona"` discriminator) rather than a narrower projection.
 *
 * Stripping here only controls the INPUT side — a caller can never set
 * these directly. Every one of them is System Visible or System Hidden
 * per ADR-031 and is simply absent from `personaBaseShape`/
 * `personaPatchSchema` entirely, so submitting them is a hard
 * unrecognized-key rejection, not a silent strip-and-ignore — this list
 * exists ONLY for fields a faithful `ei --id` round-trip would otherwise
 * echo back that aren't part of ANY write schema (id/type/entity are
 * structural, not data; is_static/last_heartbeat/description_embedding are
 * always server-computed).
 */
const PERSONA_ROUND_TRIP_FIELDS = [
  "id",
  "type",
  "entity",
  "is_static",
  "last_updated",
  "last_heartbeat",
  "description_embedding",
] as const;

function parsePersonaBody(body: unknown): PersonaEntityInput {
  const result = personaEntitySchema.safeParse(body);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid persona: ${formatValidationIssues(result.error.issues)}`
    );
  }
  return result.data;
}

/** Parses an `ei update persona` body as an RFC 7396 merge PATCH (ADR-029) — see personaPatchSchema's own doc comment for the exact shape and PERSONA_ROUND_TRIP_FIELDS for why the four structural fields are stripped first rather than rejected. */
function parsePersonaPatch(body: unknown): PersonaPatchInput {
  let input: unknown = body;
  if (body && typeof body === "object") {
    const stripped: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const field of PERSONA_ROUND_TRIP_FIELDS) {
      delete stripped[field];
    }
    input = stripped;
  }
  const result = personaPatchSchema.safeParse(input);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid persona update: ${formatValidationIssues(result.error.issues)}`
    );
  }
  return result.data;
}

/** Rejects a reserved display_name on both create and rename-via-update. */
function assertNotReservedName(displayName: string): void {
  if (isReservedPersonaName(displayName)) {
    throw new CorrectionValidationError(
      `Cannot use reserved name "${displayName}" for a persona. Reserved names: ${RESERVED_PERSONA_NAMES.join(", ")}`
    );
  }
}

/** Assign a fresh id to any trait lacking one and stamp a fresh last_updated on every trait, then reject duplicate ids. Used for both create's full trait array and an update patch's `traits` member when present. */
function materializeTraits(traits: z.infer<typeof personaTraitSchema>[], now: string): PersonaTrait[] {
  const materialized: PersonaTrait[] = traits.map((t) => ({ ...t, id: t.id ?? crypto.randomUUID(), last_updated: now }));
  const seen = new Set<string>();
  for (const t of materialized) {
    if (seen.has(t.id)) {
      throw new CorrectionValidationError(`Invalid persona: duplicate trait id "${t.id}"`);
    }
    seen.add(t.id);
  }
  return materialized;
}

/** Assign a fresh id to any topic lacking one and stamp a fresh last_updated on every topic, then reject duplicate ids. Used for both create's full topic array and an update patch's `topics` member when present. */
function materializeTopics(topics: z.infer<typeof personaTopicSchema>[], now: string): PersonaTopic[] {
  const materialized: PersonaTopic[] = topics.map((t) => ({ ...t, id: t.id ?? crypto.randomUUID(), last_updated: now }));
  const seen = new Set<string>();
  for (const t of materialized) {
    if (seen.has(t.id)) {
      throw new CorrectionValidationError(`Invalid persona: duplicate topic id "${t.id}"`);
    }
    seen.add(t.id);
  }
  return materialized;
}

export async function createPersonaEntity(body: unknown): Promise<{ id: string; record: ExternalPersonaEntity }> {
  const parsed = parsePersonaBody(body);
  assertNotReservedName(parsed.display_name);

  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const traits = materializeTraits(parsed.traits, now);
  const topics = materializeTopics(parsed.topics, now);

  // Defaults mirror persona-manager.ts's createPersona placeholder shape
  // for the fields that remain externally writable — `group_primary`/
  // `groups_visible` are no longer caller-settable (ADR-031, System
  // Visible), so every externally created persona simply starts in
  // DEFAULT_GROUP, exactly like the pre-ADR-031 fallback-when-omitted
  // behavior, just unconditional now. `is_paused`/`is_archived` are
  // System Hidden and always `false` at creation — there is no caller
  // value to read anymore. This path builds the full record directly
  // from validated input; there is no generation fallback.
  const record: PersonaEntity = {
    id,
    display_name: parsed.display_name,
    entity: "system",
    aliases: parsed.aliases ?? [parsed.display_name],
    short_description: parsed.short_description,
    long_description: parsed.long_description,
    group_primary: DEFAULT_GROUP,
    groups_visible: [DEFAULT_GROUP],
    traits,
    topics,
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: now,
    avatar_emoji: parsed.avatar_emoji,
    avatar_image: parsed.avatar_image,
    preferred_theme: parsed.preferred_theme,
    notes: parsed.notes,
  };

  if (record.long_description) {
    record.description_embedding = await computePersonaDescriptionEmbedding(record);
  }

  const correction: CorrectionRecord = { op: "upsert", entity_type: "persona", id, record, timestamp: now };
  await writeCorrection(correction);
  // ADR-031: `tools` (along with every other System Hidden Persona field)
  // is absent from the RETURNED copy entirely now, not merely reshaped --
  // see stripHiddenPersonaFields's own doc comment (src/core/entity-
  // schemas.ts). The persisted PersonaEntity (the queued CorrectionRecord
  // above) keeps the flat string[] `tools` shape untouched; only the
  // external response changes.
  return { id, record: stripHiddenPersonaFields(record) };
}

/**
 * `ei update persona` — RFC 7396 JSON Merge Patch (ADR-029). Omitting a
 * field leaves it unchanged (not "resets to its create-time default,"
 * which is GH-82's own named hazard); `traits: []`/`topics: []`
 * genuinely empty those arrays; every other field present sets it. A
 * patch's `traits`/`topics` member, when present, is re-materialized
 * (fresh ids for new entries, fresh `last_updated` for every entry in
 * that member) exactly like create — but ONLY when the caller actually
 * sent that member; an absent one is left as the already-materialized
 * stored array, untouched, which is exactly the point of merge-patch
 * semantics.
 */
export async function updatePersonaEntity(id: string, body: unknown): Promise<ExternalPersonaEntity> {
  const patch = parsePersonaPatch(body);
  if (patch.display_name !== undefined) {
    assertNotReservedName(patch.display_name);
  }

  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  const existing = resolveOwnPersona(state.personas, id);
  if (!existing) {
    throw new Error(`No persona found with id: ${stripControlChars(id)}`);
  }

  const now = new Date().toISOString();
  const patchForMerge: MergePatch<PersonaEntity> = { ...(patch as Record<string, unknown>) };
  if (patch.traits !== undefined) {
    patchForMerge.traits = materializeTraits(patch.traits, now);
  }
  if (patch.topics !== undefined) {
    patchForMerge.topics = materializeTopics(patch.topics, now);
  }

  // Best-effort PREVIEW candidate for this call's own synchronous
  // response — resolvePersonaPatchCandidate throws (nothing written) if
  // the merge cleared a required field, and (as of this call) also
  // recomputes `description_embedding` itself from the merged
  // candidate's own `long_description`. The authoritative merge that
  // actually decides what gets written happens again at drain time
  // (self-drain moments later via writeCorrection, or live-drain ~100ms
  // later in the Processor's own tick), against whichever state is
  // ACTUALLY stored then — ADR-029 clause 1 forbids merging at write
  // time against a snapshot, so the correction queued below carries the
  // raw `patchForMerge` only, never this candidate and never an
  // embedding: a write-time value smuggled through the wire patch could
  // silently overwrite a NEWER description's vector if another write
  // interleaved before this one drained (Beta's review, [I2]) — drain
  // time's own call to resolvePersonaPatchCandidate recomputes it fresh
  // instead.
  const candidate = await resolvePersonaPatchCandidate(existing.entity, patchForMerge);

  const correction: CorrectionRecord = { op: "patch", entity_type: "persona", id, patch: patchForMerge, timestamp: now };
  await writeCorrection(correction);
  // ADR-031: `tools` (along with every other System Hidden Persona field)
  // is absent from the RETURNED copy entirely now -- the persisted
  // record.tools stays the flat string[], untouched by this update since
  // tools is no longer part of any patch; only the external response
  // changes (see stripHiddenPersonaFields's own doc comment).
  return stripHiddenPersonaFields(candidate);
}

export async function removePersonaEntity(id: string): Promise<void> {
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  if (!resolveOwnPersona(state.personas, id)) {
    throw new Error(`No persona found with id: ${stripControlChars(id)}`);
  }

  // CRITICAL: this check MUST run here, synchronously, before
  // writeCorrection is ever called — never only inside
  // Processor.applyCorrectionRecord's drain-time guard. If a live Ei
  // instance is running, `ei remove persona <id>` queues into
  // corrections.json for async pickup ~100ms later; if the ONLY check
  // lived in the drain's apply function, an agent running
  // `ei remove persona ei` would get an immediate "success" from the CLI,
  // then watch the delete silently no-op in the background with no
  // feedback. Throwing here means the correction is never queued at all.
  if (isReservedPersonaId(id)) {
    throw new Error(`Cannot delete reserved persona "${id}" — reserved personas can't be deleted via this CLI/MCP path at all; use the TUI's /archive command instead.`);
  }

  const correction: CorrectionRecord = { op: "remove", entity_type: "persona", id, timestamp: new Date().toISOString() };
  await writeCorrection(correction);
}


// ── Add Observation / Apply Signal (Bolt 008, Spec §4.12) ───────────────────
//
// `ei add observation <personaId>` / MCP `ei_observation_add`, and
// `ei confirm|dismiss signal <personaId> <signalId>` / MCP
// `ei_signal_confirm`/`ei_signal_dismiss` (CLI, src/cli.ts; MCP, src/cli/
// mcp.ts). Same family as create/update/remove above — a validated parse
// here, a CorrectionRecord queued via writeCorrection, and (per D1) never a
// direct call into a live Processor/StateManager method — but Add
// Observation doesn't mint its own id up front the way create does: an
// observation's id is minted at DRAIN time (D1's "collection owns id
// generation" convention), which only self-drain resolves synchronously.
// Apply Signal (confirm/dismiss) mints nothing at all — it is pure
// status-transition bookkeeping on an already-existing signal (D1); it
// never produces or mints any identity-revision proposal. When a live Ei
// instance is running (`writeCorrection`'s "queued" drainMode), Add
// Observation's own return value can only honestly report that the write
// is pending, not its eventual shape — the same asymmetry `ei_quote_create`'s
// own "queued" branch already has to report.
//
// D10 (Sisyphus's ruling on the caller-attribution needs-ruling issue,
// `.sisyphus/issues/persona-signal-caller-attribution-needs-ruling.md`):
// `observer_kind`/`observer_persona_id` below (Add Observation) and
// `actor` (Apply Signal, both confirm/dismiss) are SELF-ATTESTED CALLER
// CLAIMS, not verified identities — neither the CLI nor MCP surface has
// (or gains) an authenticated-caller concept anywhere in this codebase.
// Ei records who the caller SAYS witnessed/is-reviewing, exactly as it
// already trusts every other caller-supplied content field on the
// pre-existing `patch` op (shape/type validation only, no separate
// identity check on what a caller may assert). D11: because
// `observer_persona_id` specifically feeds automatic promotion arithmetic
// (`observationContextKey`/`independentContextCount`,
// `src/core/state/personas.ts`) where `actor` feeds only audit metadata,
// a self-attested `other_persona` Add-Observation claim is excluded from
// that automatic tally entirely — see `PersonaState.independentContextCount`'s
// own doc comment for the mechanics. `actor` is unaffected by D11: pure
// audit metadata on a human review action, feeds no corroboration
// arithmetic, self-attested per this same D10.

const SIGNAL_DIMENSIONS = ["behavior", "voice", "values", "relationship", "identity"] as const;
const SIGNAL_DIRECTIONS = ["novel", "confirms", "challenges"] as const;
const OBSERVER_KINDS = ["human", "subject_self", "other_persona"] as const;

const observationAddBodySchema = z.strictObject({
  subject_person_id: z.string().min(1),
  // D10: self-attested — the caller vouches for who witnessed this; Ei
  // does not independently verify it (see this section's own header
  // comment above).
  observer_kind: z.enum(OBSERVER_KINDS),
  observer_persona_id: z.string().min(1).optional(),
  message_id: z.string().min(1).optional(),
  quote_id: z.string().min(1).optional(),
  observed_at: z.string().min(1).optional(),
  dimension: z.enum(SIGNAL_DIMENSIONS),
  direction: z.enum(SIGNAL_DIRECTIONS),
  claim: z.string().min(1),
  extraction_confidence: z.number().min(0).max(1).optional(),
  // 2026-08-19 ruling: self-attested, same as observer_kind/actor above.
  // Add Observation deliberately skips Scan/Extract's own
  // `classifyObservationLens` gate (this operation supplies attribution
  // directly rather than deriving it from a transcript), so there is no
  // verified-provenance object to check here even in principle — the
  // caller's asserted `lens` is recorded as given, for any persona,
  // including Ei's own. There is no persona-specific carve-out: Ei is not
  // structurally exempt from `lens: "agent"` here or anywhere else in the
  // reducer (`classifyObservationLens` itself no longer gates on persona
  // identity either — see `src/core/utils/persona-signal-lens.ts`'s own
  // header comment). Worst case on a mistaken or bad-faith caller is a
  // misclassified signal, still recorded — never a refusal.
  lens: z.enum(["persona", "agent"]),
}).refine(
  (body) => body.observer_kind !== "other_persona" || Boolean(body.observer_persona_id),
  { message: 'observer_kind "other_persona" requires observer_persona_id' }
).refine(
  // D6 (Beta's Bolt-008-review finding I1): a fabricated non-ISO
  // observed_at (e.g. "fake-day-1") must never reach a queued
  // correction -- it manufactures an independent-context day-bucket for
  // promotion arithmetic downstream. Rejected here, before Add
  // Observation ever calls writeCorrection.
  (body) => body.observed_at === undefined || isParseableIso8601(body.observed_at),
  { message: "observed_at must be a parseable ISO 8601 timestamp" }
);

type ObservationAddBodyInput = z.infer<typeof observationAddBodySchema>;

function parseObservationAddBody(body: unknown): ObservationAddBodyInput {
  const result = observationAddBodySchema.safeParse(body);
  if (!result.success) {
    throw new CorrectionValidationError(`Invalid observation: ${formatValidationIssues(result.error.issues)}`);
  }
  return result.data;
}

/** Apply Signal's own wire body (Bolt 003 D1/R1/AT1) — `actor` only.
 * Never accepts a `delta` (or any of its own member fields at the top
 * level): D1 narrows `signal.confirm`/`signal.dismiss` to pure
 * status-transition bookkeeping, so an object carrying any field
 * outside `actor` is rejected by this `strictObject`'s own unknown-key
 * check, matching this codebase's existing `unrecognized field(s)
 * present` convention. */
const applySignalBodySchema = z.strictObject({
  // D10: self-attested — the caller vouches for who is reviewing this;
  // Ei does not independently verify it (see this section's own header
  // comment above). Pure audit metadata (D11): unaffected by the
  // independence-tally exclusion that applies to Add-Observation's
  // observer_persona_id.
  actor: z.string().min(1),
});

type ApplySignalBodyInput = z.infer<typeof applySignalBodySchema>;

function parseApplySignalBody(body: unknown): ApplySignalBodyInput {
  const result = applySignalBodySchema.safeParse(body);
  if (!result.success) {
    throw new CorrectionValidationError(`Invalid signal disposition: ${formatValidationIssues(result.error.issues)}`);
  }
  return result.data;
}

/**
 * Add Observation (D1, R1/AT1). Asserts a `PersonaObservation` directly,
 * attributed to the caller via `observer_kind`/`observer_persona_id` —
 * §4.6's own resolution rules apply only to conversation EXTRACTION (Bolt
 * 004's Scan/Extract), which this operation skips entirely, so the caller
 * supplies attribution directly rather than having it inferred from a
 * transcript. `message_id`/`observed_at`/`extraction_confidence` default
 * (a synthesized `correction:<uuid>` pointer, drain time, and `1` — a
 * direct assertion rather than an extracted-with-uncertainty claim,
 * respectively) when the caller has no real conversation message to point
 * at; `lens` is required, since Scan/Extract's own classification
 * (`classifyObservationLens`) is what this operation skips.
 *
 * Returns `{status: "queued"}` when a live Ei instance picks this up
 * asynchronously (the observation's minted id isn't knowable yet); after a
 * synchronous self-drain, reloads state and returns the persisted
 * observation (the just-appended entry — self-drain applies exactly one
 * caller-visible mutation to this persona's `observations[]` per call).
 */
export async function addPersonaObservation(
  personaId: string,
  body: unknown
): Promise<{ status: "queued" } | { status: "recorded"; observation: PersonaObservation }> {
  const parsed = parseObservationAddBody(body);

  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  if (!resolveOwnPersona(state.personas, personaId)) {
    throw new Error(`No persona found with id: ${stripControlChars(personaId)}`);
  }
  if (parsed.observer_kind === "other_persona") {
    if (parsed.observer_persona_id === personaId) {
      throw new CorrectionValidationError(`observer_persona_id cannot equal the subject persona — self-testimony is observer_kind "subject_self"`);
    }
    const observer = resolveOwnPersona(state.personas, parsed.observer_persona_id!);
    if (!observer || observer.entity.is_archived) {
      throw new CorrectionValidationError(`observer_persona_id "${stripControlChars(parsed.observer_persona_id!)}" does not resolve to an active persona`);
    }
  }

  const now = new Date().toISOString();
  const correction: CorrectionObservationAdd = {
    op: "observation.add",
    entity_type: "persona",
    id: personaId,
    lens: parsed.lens,
    observation: {
      subject_person_id: parsed.subject_person_id,
      observer_kind: parsed.observer_kind,
      observer_persona_id: parsed.observer_kind === "other_persona" ? parsed.observer_persona_id : undefined,
      message_id: parsed.message_id ?? `correction:${crypto.randomUUID()}`,
      quote_id: parsed.quote_id,
      observed_at: parsed.observed_at ?? now,
      dimension: parsed.dimension,
      direction: parsed.direction,
      claim: parsed.claim,
      extraction_confidence: parsed.extraction_confidence ?? 1,
    },
    timestamp: now,
  };

  const { drainMode } = await writeCorrection(correction);
  if (drainMode === "queued") {
    return { status: "queued" };
  }

  const drained = await loadLatestState();
  const observations = drained?.personas[personaId]?.observations ?? [];
  const observation = observations[observations.length - 1];
  if (!observation) {
    throw new Error(`Observation for persona ${stripControlChars(personaId)} did not persist after self-drain`);
  }
  return { status: "recorded", observation };
}

/**
 * Apply Signal (Bolt 003 D1/D5, R1/R2/R6/R7, AT1/AT2/AT6/AT7 — narrows
 * Bolt 008's original D2-D5/R2-R5 delta-accepting shape). Never accepts
 * or applies an identity delta, for either lens or any caller (D1): the
 * body schema itself (`applySignalBodySchema`) already rejects a
 * `delta`/unrecognized field as an `unrecognized field(s) present`
 * error before this function ever runs, so there is no delta to check
 * or materialize here. The only refusal left to decide at DRAIN time
 * (against whichever state is actually stored then, per ADR-029's own
 * timing guarantee) is terminal status — this function's own
 * synchronous check is limited to persona existence, matching the
 * `update`/`remove` endpoints' own division of labor between a fast
 * synchronous usage error and the authoritative drain-time decision.
 *
 * Returns `{status: "queued"}` when a live Ei instance picks this up
 * asynchronously; after a synchronous self-drain, reloads state and
 * returns the (now-transitioned) persisted signal, or re-throws whatever
 * refusal `PersonaState.signal_confirm`/`signal_dismiss` raised.
 */
export async function applyPersonaSignal(
  personaId: string,
  signalId: string,
  disposition: "confirm" | "dismiss",
  body: unknown
): Promise<{ status: "queued" } | { status: "recorded"; signal: EmergentSignal }> {
  const parsed = parseApplySignalBody(body);

  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  if (!resolveOwnPersona(state.personas, personaId)) {
    throw new Error(`No persona found with id: ${stripControlChars(personaId)}`);
  }

  const now = new Date().toISOString();
  const correction: CorrectionSignalConfirm | CorrectionSignalDismiss = disposition === "confirm"
    ? { op: "signal.confirm", entity_type: "persona", id: personaId, signal_id: signalId, actor: parsed.actor, timestamp: now }
    : { op: "signal.dismiss", entity_type: "persona", id: personaId, signal_id: signalId, actor: parsed.actor, timestamp: now };

  const { drainMode } = await writeCorrection(correction);
  if (drainMode === "queued") {
    return { status: "queued" };
  }

  const drained = await loadLatestState();
  const signals = drained?.personas[personaId]?.signals;
  const signal = signals ? [...signals.persona, ...signals.agent].find((s) => s.id === signalId) : undefined;
  if (!signal) {
    throw new Error(`Signal ${stripControlChars(signalId)} not found on persona ${stripControlChars(personaId)} after drain`);
  }
  return { status: "recorded", signal };
}
