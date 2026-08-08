/**
 * Shared entity schemas — Topic, Person, and Persona — and the schema-pair
 * derivation mechanism (ADR-029's Must-Have 2) that produces a permissive
 * PATCH schema and a masked-required CANDIDATE schema from each one
 * declaration.
 *
 * Lives in `src/core`, not `src/cli`, on purpose — corrected 2026-08-07
 * after Beta's review [I3] found the hand-written core predicates that
 * used to stand in for this (`src/core/corrections-merge.ts`'s now-removed
 * `assertTopicCandidateValid`/`assertPersonCandidateValid`/
 * `assertPersonaCandidateValid`) had already drifted from these real Zod
 * schemas — e.g. they checked `typeof sentiment === "number"` where the
 * schema requires `-1..1`, and never enforced Person identifier shape or
 * Persona trait/topic/notes-length constraints at all. ADR-029's own
 * "validate the whole candidate against the externally-writable
 * projection" clause is the core write-time guarantee this plan's TODO 5
 * exists to deliver — it cannot be a strict subset of the declared
 * contract. Zod itself is a generic runtime validator with no CLI/DOM
 * dependency, so giving core a direct dependency on it (rather than a
 * hand-maintained shadow of it) is the correct fix, not a layering
 * violation: the alternative was accepting that "one declaration, one
 * source of truth" (this file's own stated purpose) was false in
 * practice for every consumer that mattered — the three write-apply paths
 * (`live-drain`, `self-drain`, `read-overlay`) that actually decide what
 * gets persisted.
 *
 * `.partial()` alone does NOT strip `.default()` in the installed
 * `zod@^3.25.76` — `topicSchema.partial().safeParse({name:"x"})` still
 * returns a concrete `exposure_current`/`exposure_desired` for omitted
 * fields, reproducing GH-82 exactly for every defaulted field the moment
 * a naive `.partial()` ships. The real mechanism, verified against the
 * installed version (`.sisyphus/drafts/merge-patch-write-semantics.md`):
 * shape-walk each field, and for one wrapped in `ZodDefault`, call
 * `.removeDefault()` before deciding optionality — separately for each
 * of the two derived forms:
 *   - patch: every field optional AND nullable, `.default()` stripped
 *     first so an omitted field parses to `undefined`, never the
 *     default. Nullable on EVERY field, not just the ones that happen to
 *     be optional on the entity — RFC 7396 lets `null` remove ANY member
 *     a patch mentions, including a normally-required one; whether that
 *     removal actually survives is the CANDIDATE schema's job (below),
 *     applied after the merge, not this schema's.
 *   - candidate: a field that carried `.default()` becomes REQUIRED with
 *     no default (a merged candidate must always have a concrete value
 *     for it). Every other field (already required, or already
 *     `.optional()` with no default — e.g. `category`) is left exactly
 *     as declared: masked required, not bare `.required()`, which was
 *     verified to also force every already-optional/sparse field
 *     mandatory and reject any existing sparse entity.
 *
 * Callers apply a `.refine()` (personSchema's "at least one identifier or
 * a name") AFTER calling `deriveSchemaPair`, on whichever derived schema
 * needs it — `.partial()`/shape-walking a schema already wrapped in
 * `.refine()` throws, so the refine must be layered on separately, once
 * per schema, never derived here.
 */

import { z } from "zod";
import { NOTES_MAX } from "./tools/builtin/persona-notes.js";
import { MergePatchValidationError } from "./corrections-merge.js";
import type { Fact, Topic, Person, PersonaEntity } from "./types.js";

export interface SchemaPair<Shape extends z.ZodRawShape> {
  /** Every field optional and nullable, defaults stripped. Parses an update PATCH. */
  patchSchema: z.ZodObject<{ [K in keyof Shape]: z.ZodOptional<z.ZodNullable<z.ZodType>> }, "strict">;
  /** Fields that ever carried a default become required-with-no-default; every other field unchanged. Validates a MERGED CANDIDATE's projection. */
  candidateSchema: z.ZodObject<Shape, "strict">;
}

export function deriveSchemaPair<Shape extends z.ZodRawShape>(shape: Shape): SchemaPair<Shape> {
  const patchShape: z.ZodRawShape = {};
  const candidateShape: z.ZodRawShape = {};
  for (const key of Object.keys(shape)) {
    const field = shape[key];
    if (field instanceof z.ZodDefault) {
      const bare = field.removeDefault();
      patchShape[key] = bare.nullable().optional();
      candidateShape[key] = bare;
    } else {
      patchShape[key] = field.nullable().optional();
      candidateShape[key] = field;
    }
  }
  return {
    patchSchema: z.strictObject(patchShape) as SchemaPair<Shape>["patchSchema"],
    candidateSchema: z.strictObject(candidateShape) as SchemaPair<Shape>["candidateSchema"],
  };
}

/**
 * Projects `candidate` onto exactly the keys `shape` declares, dropping
 * every system-owned field (`id`, `last_updated`, `learned_by`, ...) the
 * merged candidate also carries. ADR-029 clause 3: a candidate schema is
 * `z.strictObject`, and a candidate is the patch merged onto the STORED
 * record — which necessarily carries system-owned members the schema
 * never declared. Handing the whole candidate to the schema fails on
 * unknown keys every time, for every entity type, not because the
 * candidate is invalid but because the schema was only ever meant to
 * describe caller-writable input. The validation target is this
 * projection, never the raw candidate.
 */
export function projectWritable(candidate: object, shape: z.ZodRawShape): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    if (key in candidate) {
      projected[key] = (candidate as Record<string, unknown>)[key];
    }
  }
  return projected;
}

/**
 * Validates `candidate`'s writable projection against `candidateSchema`
 * (masked-required, per `deriveSchemaPair` above) and throws a
 * `MergePatchValidationError`-shaped message matching the CLI layer's own
 * `parseInput`/`parsePatchInput` error format (`Invalid ${label}: ...`) —
 * one consistent shape for every rejection reason, whether the caller's
 * raw patch failed shape validation (CLI layer, before merge) or the
 * MERGED candidate failed this post-merge invariant check (here, after
 * merge) — TODO 5's "a patch valid by grammar but invalid after merging
 * onto stored state is rejected wholesale" oracle.
 */
export function validateCandidate(candidate: object, shape: z.ZodRawShape, candidateSchema: z.ZodType, label: string): void {
  const projected = projectWritable(candidate, shape);
  const result = candidateSchema.safeParse(projected);
  if (!result.success) {
    throw new MergePatchValidationError(
      `Invalid ${label} update: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
}

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

/**
 * `exposure_current`/`exposure_desired` (System Hidden — ADR-031, ADR-025)
 * and `last_ei_asked` (System Hidden — Ei's own bookkeeping, state.json is
 * that surface) are gone from Topic's write-side shape entirely, per
 * this plan's TODO 3. Exported as a raw shape for `deriveSchemaPair` and
 * `projectWritable` — one declaration, three derived forms
 * (create/patch/candidate), per ADR-029's Must-Have 2.
 */
export const topicBaseShape = {
  name: z.string().min(1),
  description: z.string(),
  sentiment: z.number().min(-1).max(1),
  category: z.string().optional(),
};
export const topicCreateSchema = z.strictObject(topicBaseShape);
export const { patchSchema: topicPatchSchema, candidateSchema: topicCandidateSchema } = deriveSchemaPair(topicBaseShape);

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------

export const identifierSchema = z.strictObject({
  type: z.string().min(1),
  value: z.string().min(1),
  is_primary: z.boolean().optional(),
});

/**
 * Split from its `.refine()` wrapper on purpose (ADR-029 clause 3):
 * `.partial()`/shape-walking a `ZodEffects`-wrapped object throws in the
 * installed zod, so `deriveSchemaPair` must run against the bare
 * `personBaseShape` — this raw shape object, never a schema already
 * carrying `.refine()`. Each of the three derived forms below re-applies
 * `personRefine` itself, once, on its own final schema.
 */
export const personBaseShape = {
  name: z.string().optional(),
  description: z.string(),
  sentiment: z.number().min(-1).max(1),
  identifiers: z.array(identifierSchema).optional(),
  validated_date: z.string().optional(),
  relationship: z.string().default(""),
};
export const personRefine = (p: { identifiers?: { value: string }[]; name?: string }): boolean =>
  Boolean((p.identifiers && p.identifiers.length > 0) || (p.name && p.name.length > 0));
export const PERSON_REFINE_OPTS = { message: "Person requires at least one identifier or a name" };
export const personCreateSchema = z.strictObject(personBaseShape).refine(personRefine, PERSON_REFINE_OPTS);
const { patchSchema: personPatchSchema, candidateSchema: personCandidateSchemaRaw } = deriveSchemaPair(personBaseShape);
export { personPatchSchema };
// Patch is deliberately NOT refined: a patch legitimately omits BOTH
// `identifiers` and `name`, relying on merge to preserve whichever the
// stored record already has — only the merged CANDIDATE (below) must
// satisfy the invariant.
export const personCandidateSchema = personCandidateSchemaRaw.refine(personRefine, PERSON_REFINE_OPTS);

// ---------------------------------------------------------------------------
// Persona
// ---------------------------------------------------------------------------

/**
 * Optional `DataItemBase` metadata pass-through fields a persisted
 * PersonaTrait commonly carries. Governs a trait NESTED inside a persona,
 * not one of the top-level entity schemas ADR-031's sweep touched — out
 * of that sweep's scope, unaffected. Accepted and passed through
 * unchanged; never validated beyond shape since it's opaque bookkeeping,
 * not caller-authored content.
 */
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

// `id` is auto-assigned when absent (never required from a caller
// authoring a brand-new trait/topic). `last_updated` is accepted-but-
// always-overwritten — declaring it here (rather than omitting it) means
// a caller round-tripping an unmodified trait/topic from `ei --id
// <persona>` isn't rejected by strictObject for including a field it
// never meant to hand-author; materializeTraits/materializeTopics
// (src/cli/persona-corrections.ts) stamp a fresh value on every write
// regardless of what's supplied.
export const personaTraitSchema = z.strictObject({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string(),
  sentiment: z.number().min(-1).max(1),
  strength: z.number().min(0).max(1).optional(),
  last_updated: z.string().optional(),
  ...traitMetaFields,
});

export const personaTopicSchema = z.strictObject({
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

/**
 * ADR-031's field-visibility sweep (this plan's TODO 3 + the S5 residual
 * fold-in): `tools`, `model`, `heartbeat_delay_ms`, `context_window_ms`,
 * `include_message_timestamps`, `context_boundary`, `is_paused`,
 * `pause_until`, `is_archived`, `archived_at` (all System Hidden) and
 * `group_primary`, `groups_visible` (System Visible — read-only, never
 * caller-write, S5) are gone from this shape entirely. `is_static`/
 * `last_heartbeat`/`last_updated`/`description_embedding` were never here
 * (System Visible/Hidden, always server-stamped).
 *
 * Exported as a raw shape for `deriveSchemaPair` — one declaration
 * produces the CREATE schema below, plus the PATCH/CANDIDATE pair
 * (ADR-029's Must-Have 2).
 */
export const personaBaseShape = {
  display_name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  short_description: z.string().optional(),
  long_description: z.string().optional(),
  traits: z.array(personaTraitSchema).default([]),
  topics: z.array(personaTopicSchema).default([]),
  external_reflection_only: z.boolean().default(false),
  avatar_emoji: z.string().optional(),
  avatar_image: z.string().optional(),
  preferred_theme: z.string().optional(),
  notes: z.array(z.string()).max(NOTES_MAX).optional(),
};

/** `ei create persona` — full-body contract, unchanged shape/defaults from before ADR-029. */
export const personaCreateSchema = z.strictObject(personaBaseShape);

const { patchSchema: personaPatchSchemaBase, candidateSchema: personaCandidateSchema } = deriveSchemaPair(personaBaseShape);
export { personaCandidateSchema };

/**
 * `pending_update` (ADR-029 clause 5, ADR-031's Clearable category) is
 * added to the PATCH shape only, after derivation — it was never part of
 * `personaBaseShape` (create never accepts it either; a brand-new persona
 * has no pending Critic proposal to clear). Accepts `null` (clear) or
 * absence (unchanged); any other value — including an attempted full
 * proposal object — is a Zod type mismatch, rejected before this ever
 * reaches `resolvePersonaPatchCandidate`.
 */
export const personaPatchSchema = z.strictObject({ ...personaPatchSchemaBase.shape, pending_update: z.null().optional() });

// ---------------------------------------------------------------------------
// ADR-031 read-side stripping — System Hidden fields absent from every
// external read AND write RESPONSE (Beta's review, plan-1-adr029-merge-
// patch.md [I1]: removing a field from the write-side schemas above is not
// the four-category external contract by itself — "System Hidden" means
// absent from reads too, per ADR-031's own table). One function per shape
// family, each a hand-maintained mirror of that table — the same
// hand-maintained-list convention `PERSONA_ROUND_TRIP_FIELDS`
// (src/cli/persona-corrections.ts) already used for its own narrower
// purpose, extended here to the full Hidden category. Every caller
// (`ei --id` / `ei_lookup` via src/cli/retrieval.ts's lookupById, and every
// create/update response in src/cli/corrections-endpoints.ts and
// src/cli/persona-corrections.ts) must route its response through the
// matching function below before returning it externally.
// ---------------------------------------------------------------------------

/**
 * The externally-visible projection of Fact/Topic/Person after ADR-031's
 * read-side strip: every System Hidden field (`embedding`,
 * `rewrite_length_floor`, and — Topic/Person only — `exposure_current`/
 * `exposure_desired`/`last_ei_asked`) is absent, never merely `undefined`.
 */
export type ExternalDataItem = Omit<Fact | Topic | Person, "embedding" | "rewrite_length_floor" | "exposure_current" | "exposure_desired" | "last_ei_asked">;

/**
 * Fact/Topic/Person: `embedding`/`rewrite_length_floor` are Hidden on all
 * three (Fact has neither `exposure_current`/`exposure_desired` nor
 * `last_ei_asked` at all, so deleting those two keys on a Fact is a no-op,
 * not an error — one function safely covers all three types rather than
 * three near-duplicates that could drift). Quotes are explicitly unaffected
 * by this table (ADR-031) and must keep using their own narrower
 * embedding-only strip (`stripEmbedding` in corrections-endpoints.ts).
 */
export function stripHiddenDataItemFields(record: Fact | Topic | Person): ExternalDataItem {
  const clone = { ...record } as Record<string, unknown>;
  delete clone.embedding;
  delete clone.rewrite_length_floor;
  delete clone.exposure_current;
  delete clone.exposure_desired;
  delete clone.last_ei_asked;
  return clone as ExternalDataItem;
}

/**
 * The externally-visible projection of PersonaEntity after ADR-031's
 * read-side strip: every field the ADR-031 table marks System Hidden for
 * Persona is absent, never merely `undefined` — `tools`, `model`,
 * `heartbeat_delay_ms`, `context_window_ms`, `include_message_timestamps`,
 * `context_boundary`, `is_paused`, `pause_until`, `is_archived`,
 * `archived_at`, `last_heartbeat`, `description_embedding`.
 */
export type ExternalPersonaEntity = Omit<PersonaEntity, "tools" | "model" | "heartbeat_delay_ms" | "context_window_ms" | "include_message_timestamps" | "context_boundary" | "is_paused" | "pause_until" | "is_archived" | "archived_at" | "last_heartbeat" | "description_embedding">;

/**
 * `tools` is the field that removes the dual-representation problem from
 * the external contract entirely, per ADR-031's own Context section —
 * `buildPersonaToolsMap` stays a real, exported core utility for the
 * TUI's in-harness YAML editor, it simply never runs against an external
 * CLI/MCP response again.
 */
export function stripHiddenPersonaFields(entity: PersonaEntity): ExternalPersonaEntity {
  const clone = { ...entity } as Record<string, unknown>;
  delete clone.tools;
  delete clone.model;
  delete clone.heartbeat_delay_ms;
  delete clone.context_window_ms;
  delete clone.include_message_timestamps;
  delete clone.context_boundary;
  delete clone.is_paused;
  delete clone.pause_until;
  delete clone.is_archived;
  delete clone.archived_at;
  delete clone.last_heartbeat;
  delete clone.description_embedding;
  return clone as ExternalPersonaEntity;
}
