/**
 * Validated create/update/remove endpoints for ei_create, ei_update, and
 * ei_remove — shared by the CLI subcommands (src/cli.ts) and the MCP tools
 * (src/cli/mcp.ts) so both surfaces enforce identical schemas and produce
 * identical CorrectionRecords.
 *
 * Every accepted entity is fully materialized here — id assigned (create),
 * embedding computed, Person identifiers sanitized and name-synced — before
 * being handed to writeCorrection(). Callers of ei_update must round-trip
 * a full record obtained from ei_lookup: unset optional fields are treated
 * as absent, not "leave existing value alone" (full-replacement semantics —
 * see design discussion for why partial-field patching isn't safe here).
 */

import { z } from "zod";
import { loadLatestState } from "./retrieval.js";
import { writeCorrection } from "./corrections-writer.js";
import { sanitizeEiPersonaIdentifiers } from "../core/utils/identifier-utils.js";
import { computeDataItemEmbedding, computeQuoteEmbedding } from "../core/embedding-service.js";
import type { CorrectableType, CorrectionRecord } from "../core/corrections.js";
import type { Fact, Topic, Person, Quote } from "../core/types.js";
import type { PersonaEntity } from "../core/types/entities.js";

// Fact/topic/person handling below is keyed by this narrower alias, not the
// full CorrectableType — parseInput/buildAndWriteUpsert only ever validate
// and materialize these 3 types. Quotes get their own updateQuoteEntity path
// (different embedding source, no last_updated field, update-only by design)
// rather than flowing through this shared machinery.
type NonQuoteType = "fact" | "topic" | "person";

export const CORRECTABLE_TYPES: CorrectableType[] = ["fact", "topic", "person"];
// Wider set accepted by the `update` surface only — a Quote can be corrected
// (data_item_ids repointed after a split/merge, mistranscribed text fixed)
// but, per design, never created or removed, so create/remove keep gating on
// CORRECTABLE_TYPES above while update alone widens to this constant.
export const UPDATABLE_TYPES: CorrectableType[] = ["fact", "topic", "person", "quote"];

// Metadata fields common to all three entity types, all server-preserved
// pass-through — a caller round-tripping ei_lookup output keeps them
// unless they deliberately edit/clear them.
const metaFields = {
  learned_on: z.string().optional(),
  last_mentioned: z.string().optional(),
  learned_by: z.string().optional(),
  last_changed_by: z.string().optional(),
  interested_personas: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  persona_groups: z.array(z.string()).optional(),
  rewrite_length_floor: z.number().optional(),
};

const factSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string(),
  sentiment: z.number().min(-1).max(1),
  validated_date: z.string(),
  ...metaFields,
});

const topicSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string(),
  sentiment: z.number().min(-1).max(1),
  category: z.string().optional(),
  exposure_current: z.number().min(0).max(1).default(0),
  exposure_desired: z.number().min(0).max(1).default(0.5),
  last_ei_asked: z.string().nullable().optional(),
  ...metaFields,
});

const identifierSchema = z.strictObject({
  type: z.string().min(1),
  value: z.string().min(1),
  is_primary: z.boolean().optional(),
});

const personSchema = z.strictObject({
  name: z.string().optional(),
  description: z.string(),
  sentiment: z.number().min(-1).max(1),
  identifiers: z.array(identifierSchema).optional(),
  validated_date: z.string().optional(),
  relationship: z.string().default(""),
  exposure_current: z.number().min(0).max(1).default(0),
  exposure_desired: z.number().min(0).max(1).default(0.5),
  last_ei_asked: z.string().nullable().optional(),
  ...metaFields,
}).refine(
  (p) => (p.identifiers && p.identifiers.length > 0) || (p.name && p.name.length > 0),
  { message: "Person requires at least one identifier or a name" }
);

const quoteSchema = z.strictObject({
  message_id: z.string().nullable(),
  data_item_ids: z.array(z.string()),
  persona_groups: z.array(z.string()),
  text: z.string().min(1),
  speaker: z.string().min(1),
  channel: z.string().optional(),
  timestamp: z.string(),
  start: z.number().nullable(),
  end: z.number().nullable(),
  created_at: z.string(),
  created_by: z.enum(["extraction", "human"]),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

const SCHEMAS = { fact: factSchema, topic: topicSchema, person: personSchema } as const;

export type FactInput = z.infer<typeof factSchema>;
export type TopicInput = z.infer<typeof topicSchema>;
export type PersonInput = z.infer<typeof personSchema>;

/** Thrown on schema violations — callers should surface `.message` directly, not swallow it. */
export class CorrectionValidationError extends Error {}

/**
 * Strip the embedding vector before handing a just-written record back to a
 * caller. writeCorrection() needs the real embedding (computed above) to
 * persist for search — this only shapes the CLI/MCP *response*, mirroring
 * lookupById's read-path convention (retrieval.ts) of never surfacing a raw
 * float array to a consumer that has no use for it. Safe to strip after the
 * fact: writeCorrection() has already awaited and fully persisted by the
 * time each call site below runs this.
 */
function stripEmbedding<T extends { embedding?: number[] }>(record: T): T {
  const { embedding, ...rest } = record;
  void embedding;
  return rest as T;
}

/**
 * Server-owned fields that ei_lookup returns on every entity and that a
 * caller following the documented ei_lookup -> edit -> ei_update round-trip
 * will send straight back. Stripped before schema validation so the
 * round-trip actually works — id/last_updated are always server-assigned
 * (the id param and a fresh timestamp win, never a caller-supplied value),
 * `type` is `lookupById`'s own discriminator, never a real entity field,
 * and `linked_quotes` is a read-only reverse-index (which quotes reference
 * this entity) that lookupById computes on the fly for fact/topic/person —
 * never a field a caller is meant to set. Any OTHER unknown key still fails
 * validation — this is a narrow allowlist, not permissive parsing.
 */
const ROUND_TRIP_FIELDS = ["id", "type", "last_updated", "linked_quotes"] as const;

function parseInput(entityType: NonQuoteType, body: unknown, mode: "create" | "update"): FactInput | TopicInput | PersonInput {
  let input: unknown = body;
  if (mode === "update" && body && typeof body === "object") {
    const stripped: Record<string, unknown> = { ...body };
    for (const field of ROUND_TRIP_FIELDS) {
      delete stripped[field];
    }
    input = stripped;
  }
  const result = SCHEMAS[entityType].safeParse(input);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid ${entityType}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  return result.data;
}

/**
 * Materialize a validated input into a full entity record (id, name-synced
 * identifiers, embedding) and persist it as an upsert correction. Shared by
 * createEntity (fresh id) and updateEntity (caller-supplied id) — both
 * need identical Person identifier sanitization and embedding computation.
 */
async function buildAndWriteUpsert(
  entityType: NonQuoteType,
  id: string,
  parsed: FactInput | TopicInput | PersonInput,
  personas: PersonaEntity[]
): Promise<Fact | Topic | Person> {
  const now = new Date().toISOString();

  let record: Fact | Topic | Person;
  if (entityType === "person") {
    const input = parsed as PersonInput;
    const identifiers = sanitizeEiPersonaIdentifiers(input.identifiers ?? [], personas);
    const primary = identifiers.find((i) => i.is_primary) ?? identifiers[0];
    const name = primary?.value ?? input.name ?? "";
    record = { ...input, id, identifiers, name, last_updated: now } as Person;
  } else {
    record = { ...parsed, id, last_updated: now } as Fact | Topic;
  }

  record.embedding = await computeDataItemEmbedding(record);

  const correction: CorrectionRecord = { op: "upsert", entity_type: entityType, id, record, timestamp: now };
  await writeCorrection(correction);
  return record;
}

export async function createEntity(
  entityType: CorrectableType,
  body: unknown
): Promise<{ id: string; record: Fact | Topic | Person }> {
  const parsed = parseInput(entityType as NonQuoteType, body, "create");
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }

  const id = crypto.randomUUID();
  const record = await buildAndWriteUpsert(entityType as NonQuoteType, id, parsed, Object.values(state.personas).map((p) => p.entity));
  return { id, record: stripEmbedding(record) };
}

export async function updateEntity(
  entityType: CorrectableType,
  id: string,
  body: unknown
): Promise<Fact | Topic | Person | Quote> {
  if (entityType === "quote") {
    return updateQuoteEntity(id, body);
  }

  const parsed = parseInput(entityType, body, "update");
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }

  const array = entityType === "fact" ? state.human.facts : entityType === "topic" ? state.human.topics : state.human.people;
  if (!array.some((item: { id: string }) => item.id === id)) {
    throw new Error(`No ${entityType} found with id: ${id}`);
  }

  return stripEmbedding(await buildAndWriteUpsert(entityType, id, parsed, Object.values(state.personas).map((p) => p.entity)));
}

/**
 * Quotes skip the shared fact/topic/person machinery entirely: their
 * embedding is derived from `text` (not name+description, so
 * computeDataItemEmbedding doesn't apply), they have no `last_updated`
 * field to stamp, and — per design — this is their ONLY correction path;
 * there is no createQuoteEntity/removeQuoteEntity to pair it with.
 */
async function updateQuoteEntity(id: string, body: unknown): Promise<Quote> {
  let input: unknown = body;
  if (body && typeof body === "object") {
    const stripped: Record<string, unknown> = { ...body };
    for (const field of ROUND_TRIP_FIELDS) delete stripped[field];
    input = stripped;
  }
  const result = quoteSchema.safeParse(input);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid quote: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  if (!state.human.quotes.some((q) => q.id === id)) {
    throw new Error(`No quote found with id: ${id}`);
  }
  // Beta's review (I1): the schema above only checks data_item_ids is an
  // array of strings, not that each string resolves to a real link target.
  // Without this, a typo'd or stale ID in an external quote repoint — the
  // primary consumer is the person-split/merge repair workflow — would
  // silently store a dangling link instead of failing loudly.
  const validLinkIds = new Set([
    ...state.human.facts.map((f) => f.id),
    ...state.human.topics.map((t) => t.id),
    ...state.human.people.map((p) => p.id),
  ]);
  const invalidIds = result.data.data_item_ids.filter((itemId) => !validLinkIds.has(itemId));
  if (invalidIds.length > 0) {
    throw new CorrectionValidationError(
      `Invalid quote: data_item_ids references unknown or disallowed entities: ${invalidIds.join(", ")} (must resolve to an existing fact, topic, or person — not a quote, persona, or unmatched ID)`
    );
  }
  const record: Quote = { ...result.data, id };
  record.embedding = await computeQuoteEmbedding(record.text);
  const correction: CorrectionRecord = { op: "upsert", entity_type: "quote", id, record, timestamp: new Date().toISOString() };
  await writeCorrection(correction);
  return stripEmbedding(record);
}

export async function removeEntity(entityType: CorrectableType, id: string): Promise<void> {
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }

  const array = entityType === "fact" ? state.human.facts : entityType === "topic" ? state.human.topics : state.human.people;
  if (!array.some((item: { id: string }) => item.id === id)) {
    throw new Error(`No ${entityType} found with id: ${id}`);
  }

  const correction: CorrectionRecord = { op: "remove", entity_type: entityType, id, timestamp: new Date().toISOString() };
  await writeCorrection(correction);
}
