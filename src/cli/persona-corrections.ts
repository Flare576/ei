/**
 * Validated create/update/remove endpoints for persona corrections —
 * `ei create/update/remove persona` (CLI, src/cli.ts) and
 * `ei_create`/`ei_update`/`ei_remove` with entity_type "persona" (MCP,
 * src/cli/mcp.ts).
 *
 * Deliberately NOT folded into the shared SCHEMAS dispatch in
 * corrections-endpoints.ts — mirrors that module's own updateQuoteEntity,
 * which already bypasses the shared machinery for a type with a distinct
 * shape. PersonaEntity's nested traits[]/topics[] need structural checks
 * (id uniqueness, id auto-assignment) a flat Zod object doesn't give for
 * free, and this keeps Persona's validation free to harden independently
 * of fact/topic/person.
 *
 * Unlike Quote (update-only — quotes are records of external reality that
 * can't be fabricated or destroyed), Persona corrections are full CRUD:
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
 * Update/create use the same full-object round-trip semantics as
 * fact/topic/person in corrections-endpoints.ts: read the full record,
 * touch only the field you mean to change, write the WHOLE thing back.
 * There are no separate trait/topic sub-endpoints.
 */

import { z } from "zod";
import { loadLatestState } from "./retrieval.js";
import { writeCorrection } from "./corrections-writer.js";
import { computePersonaDescriptionEmbedding } from "../core/embedding-service.js";
import { CorrectionValidationError } from "./corrections-endpoints.js";
import { isReservedPersonaName, isReservedPersonaId, RESERVED_PERSONA_NAMES } from "../core/types/entities.js";
import { NOTES_MAX } from "../core/tools/builtin/persona-notes.js";
import type { PersonaEntity } from "../core/types/entities.js";
import type { PersonaTrait, PersonaTopic } from "../core/types/data-items.js";
import type { CorrectionRecord } from "../core/corrections.js";

const DEFAULT_GROUP = "General";

// Optional DataItemBase metadata pass-through fields a persisted PersonaTrait
// commonly carries (mirrors corrections-endpoints.ts's `metaFields`,
// duplicated rather than imported — it's private there, and this keeps this
// module's only dependency on corrections-endpoints.ts to
// CorrectionValidationError). Accepted and passed through unchanged; never
// validated beyond shape since they're opaque bookkeeping, not
// caller-authored content.
const traitMetaFields = {
  learned_on: z.string().optional(),
  last_mentioned: z.string().optional(),
  learned_by: z.string().optional(),
  last_changed_by: z.string().optional(),
  interested_personas: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  persona_groups: z.array(z.string()).optional(),
  rewrite_length_floor: z.number().optional(),
  embedding: z.array(z.number()).optional(),
};

// `id` is auto-assigned below when absent (never required from a caller
// authoring a brand-new trait/topic). `last_updated` is accepted-but-always-
// overwritten — declaring it here (rather than omitting it) means a caller
// round-tripping an unmodified trait/topic from `ei --id <persona>` isn't
// rejected by strictObject for including a field it never meant to
// hand-author; materializeTraits/materializeTopics below stamp a fresh
// value on every write regardless of what's supplied, the same "server
// always refreshes this" treatment PersonaState.update gives the entity's
// own last_updated.
const personaTraitSchema = z.strictObject({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string(),
  sentiment: z.number().min(-1).max(1),
  strength: z.number().min(0).max(1).optional(),
  last_updated: z.string().optional(),
  ...traitMetaFields,
});

const personaTopicSchema = z.strictObject({
  id: z.string().optional(),
  name: z.string().min(1),
  perspective: z.string(),
  approach: z.string(),
  personal_stake: z.string(),
  sentiment: z.number().min(-1).max(1),
  exposure_current: z.number().min(0).max(1),
  exposure_desired: z.number().min(0).max(1),
  last_updated: z.string().optional(),
});

// No minimum trait/topic count is enforced here on purpose — that floor
// (coding-harness-reflect's "3 traits minimum") exists only as skill-level
// AGENT guidance today, not a server-side gate, so a single "add one trait"
// edit is never blocked.
const personaEntitySchema = z.strictObject({
  display_name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  short_description: z.string().optional(),
  long_description: z.string().optional(),
  model: z.string().optional(),
  group_primary: z.string().nullable().optional(),
  groups_visible: z.array(z.string()).optional(),
  traits: z.array(personaTraitSchema).default([]),
  topics: z.array(personaTopicSchema).default([]),
  is_paused: z.boolean().default(false),
  pause_until: z.string().optional(),
  is_archived: z.boolean().default(false),
  archived_at: z.string().optional(),
  heartbeat_delay_ms: z.number().optional(),
  context_window_ms: z.number().optional(),
  include_message_timestamps: z.boolean().optional(),
  context_boundary: z.string().optional(),
  tools: z.array(z.string()).optional(),
  avatar_emoji: z.string().optional(),
  avatar_image: z.string().optional(),
  preferred_theme: z.string().optional(),
  notes: z.array(z.string()).max(NOTES_MAX).optional(),
});

type PersonaEntityInput = z.infer<typeof personaEntitySchema>;

/**
 * Server-owned fields silently stripped before schema validation on
 * UPDATE — a caller following the documented `ei --id <persona>` -> edit ->
 * `ei update persona` round-trip naturally sends these back unchanged.
 * Wider than corrections-endpoints.ts's ROUND_TRIP_FIELDS (id/type/
 * last_updated/linked_quotes) because lookupById's crossFind spreads the
 * FULL PersonaEntity (plus its own `type: "persona"` discriminator) rather
 * than a narrower projection: `entity` is a fixed literal, `is_static` is
 * explicitly read-only (distinguishes built-in structural personas — never
 * flippable via this path, so it must round-trip silently rather than
 * error), and last_heartbeat/last_extraction/description_embedding/
 * pending_update/reflection_last_asked are all written only by the live
 * Processor/ceremony pipeline, never by a human or external agent. Any
 * OTHER unknown key still fails validation — this is a narrow allowlist.
 */
const PERSONA_ROUND_TRIP_FIELDS = [
  "id",
  "type",
  "entity",
  "is_static",
  "last_updated",
  "last_heartbeat",
  "last_extraction",
  "description_embedding",
  "pending_update",
  "reflection_last_asked",
] as const;

function parsePersonaBody(body: unknown, mode: "create" | "update"): PersonaEntityInput {
  let input: unknown = body;
  if (mode === "update" && body && typeof body === "object") {
    const stripped: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const field of PERSONA_ROUND_TRIP_FIELDS) {
      delete stripped[field];
    }
    input = stripped;
  }
  const result = personaEntitySchema.safeParse(input);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid persona: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
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

/** Assign a fresh id to any trait lacking one and stamp a fresh last_updated on every trait, then reject duplicate ids. */
function materializeTraits(traits: PersonaEntityInput["traits"], now: string): PersonaTrait[] {
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

/** Assign a fresh id to any topic lacking one and stamp a fresh last_updated on every topic, then reject duplicate ids. */
function materializeTopics(topics: PersonaEntityInput["topics"], now: string): PersonaTopic[] {
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

/**
 * Strip `description_embedding` before handing a just-written record back
 * to a caller — mirrors corrections-endpoints.ts's stripEmbedding,
 * duplicated locally (not imported: that helper is private there, and
 * PersonaEntity's embedding field has a different name — description_
 * embedding, not embedding — so it isn't a drop-in reuse anyway).
 */
function stripPersonaEmbedding(record: PersonaEntity): PersonaEntity {
  const { description_embedding, ...rest } = record;
  void description_embedding;
  return rest as PersonaEntity;
}

export async function createPersonaEntity(body: unknown): Promise<{ id: string; record: PersonaEntity }> {
  const parsed = parsePersonaBody(body, "create");
  assertNotReservedName(parsed.display_name);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const traits = materializeTraits(parsed.traits, now);
  const topics = materializeTopics(parsed.topics, now);

  // Defaults mirror persona-manager.ts's createPersona placeholder shape
  // exactly (lines 55-71) for consistency between the live-app creation
  // path and this headless one — minus its orchestratePersonaGeneration
  // call, which is a live-app-only LLM auto-generation side effect
  // inappropriate for a headless external CLI/MCP call. This path builds
  // the full record directly from validated input; there is no generation
  // fallback.
  const record: PersonaEntity = {
    id,
    display_name: parsed.display_name,
    entity: "system",
    aliases: parsed.aliases ?? [parsed.display_name],
    short_description: parsed.short_description,
    long_description: parsed.long_description,
    model: parsed.model,
    group_primary: parsed.group_primary ?? DEFAULT_GROUP,
    groups_visible: parsed.groups_visible ?? [DEFAULT_GROUP],
    traits,
    topics,
    tools: parsed.tools && parsed.tools.length > 0 ? parsed.tools : undefined,
    is_paused: parsed.is_paused,
    pause_until: parsed.pause_until,
    is_archived: parsed.is_archived,
    archived_at: parsed.archived_at,
    is_static: false,
    heartbeat_delay_ms: parsed.heartbeat_delay_ms,
    context_window_ms: parsed.context_window_ms,
    include_message_timestamps: parsed.include_message_timestamps,
    context_boundary: parsed.context_boundary,
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
  return { id, record: stripPersonaEmbedding(record) };
}

export async function updatePersonaEntity(id: string, body: unknown): Promise<PersonaEntity> {
  const parsed = parsePersonaBody(body, "update");
  assertNotReservedName(parsed.display_name);

  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  const existing = state.personas[id];
  if (!existing) {
    throw new Error(`No persona found with id: ${id}`);
  }

  const now = new Date().toISOString();
  const traits = materializeTraits(parsed.traits, now);
  const topics = materializeTopics(parsed.topics, now);

  // Full-object replace: every writable field comes from `parsed` (absent
  // -> undefined, never "keep the old value") except `is_static`, which
  // isn't part of the writable schema at all and is always inherited from
  // the existing record.
  const record: PersonaEntity = {
    id,
    display_name: parsed.display_name,
    entity: "system",
    aliases: parsed.aliases,
    short_description: parsed.short_description,
    long_description: parsed.long_description,
    model: parsed.model,
    group_primary: parsed.group_primary,
    groups_visible: parsed.groups_visible,
    traits,
    topics,
    tools: parsed.tools,
    is_paused: parsed.is_paused,
    pause_until: parsed.pause_until,
    is_archived: parsed.is_archived,
    archived_at: parsed.archived_at,
    is_static: existing.entity.is_static,
    heartbeat_delay_ms: parsed.heartbeat_delay_ms,
    context_window_ms: parsed.context_window_ms,
    include_message_timestamps: parsed.include_message_timestamps,
    context_boundary: parsed.context_boundary,
    last_updated: now,
    avatar_emoji: parsed.avatar_emoji,
    avatar_image: parsed.avatar_image,
    preferred_theme: parsed.preferred_theme,
    notes: parsed.notes,
  };

  // Always recompute on update rather than diffing old vs new — simplest
  // correct behavior, and cheap (local embedding model, no network call).
  if (record.long_description) {
    record.description_embedding = await computePersonaDescriptionEmbedding(record);
  }

  const correction: CorrectionRecord = { op: "upsert", entity_type: "persona", id, record, timestamp: now };
  await writeCorrection(correction);
  return stripPersonaEmbedding(record);
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
    throw new Error(`Cannot delete reserved persona "${id}". Use archive instead.`);
  }

  const correction: CorrectionRecord = { op: "remove", entity_type: "persona", id, timestamp: new Date().toISOString() };
  await writeCorrection(correction);
}
