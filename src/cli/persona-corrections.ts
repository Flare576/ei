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
 * required, traits/topics/external_reflection_only default exactly as
 * before. `update` is RFC 7396 JSON Merge Patch (ADR-029): omitting a
 * field leaves it unchanged, `traits: []` genuinely empties the array,
 * and `pending_update: null` is the only legal way to clear a pending
 * Critic proposal (non-null content is rejected at parse time — Clearable,
 * never settable, per ADR-014's narrow-what-a-caller-may-assert
 * discipline). `tools`/`model`/`heartbeat_delay_ms`/`context_window_ms`/
 * `include_message_timestamps`/`context_boundary`/`is_paused`/
 * `pause_until`/`is_archived`/`archived_at`/`group_primary`/
 * `groups_visible` are gone from BOTH create and update entirely
 * (ADR-031: System Hidden or System Visible — never externally writable).
 */

import { z } from "zod";
import { loadLatestState } from "./retrieval.js";
import { writeCorrection } from "./corrections-writer.js";
import { computePersonaDescriptionEmbedding } from "../core/embedding-service.js";
import { CorrectionValidationError } from "./corrections-endpoints.js";
import { resolvePersonaPatchCandidate } from "../core/corrections.js";
import { isReservedPersonaName, isReservedPersonaId, RESERVED_PERSONA_NAMES } from "../core/types/entities.js";
import type { PersonaEntity } from "../core/types/entities.js";
import type { PersonaTrait, PersonaTopic } from "../core/types/data-items.js";
import type { CorrectionRecord, MergePatch } from "../core/corrections.js";
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
 * `pending_update` is deliberately ABSENT from this list (Must-Have 5,
 * corrected from the pre-ADR-029 behavior recorded below) — it is now a
 * legal PATCH member in its own right (see personaPatchSchema above), so
 * silently stripping it here would mean a caller's explicit
 * `pending_update: null` never reaches the schema at all, defeating the
 * one supported way to clear it.
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
      `Invalid persona: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
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
      `Invalid persona update: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
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
    external_reflection_only: parsed.external_reflection_only,
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
 * genuinely empty those arrays; `pending_update: null` clears a pending
 * Critic proposal; every other field present sets it. A patch's
 * `traits`/`topics` member, when present, is re-materialized (fresh ids
 * for new entries, fresh `last_updated` for every entry in that member)
 * exactly like create — but ONLY when the caller actually sent that
 * member; an absent one is left as the already-materialized stored array,
 * untouched, which is exactly the point of merge-patch semantics.
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
  const existing = state.personas[id];
  if (!existing) {
    throw new Error(`No persona found with id: ${id}`);
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
  if (!state.personas[id]) {
    throw new Error(`No persona found with id: ${id}`);
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
