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
import { computeDataItemEmbedding } from "../core/embedding-service.js";
import type { CorrectableType, CorrectionRecord } from "../core/corrections.js";
import type { Fact, Topic, Person } from "../core/types.js";
import type { PersonaEntity } from "../core/types/entities.js";

export const CORRECTABLE_TYPES: CorrectableType[] = ["fact", "topic", "person"];

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

const SCHEMAS = { fact: factSchema, topic: topicSchema, person: personSchema } as const;

export type FactInput = z.infer<typeof factSchema>;
export type TopicInput = z.infer<typeof topicSchema>;
export type PersonInput = z.infer<typeof personSchema>;

/** Thrown on schema violations — callers should surface `.message` directly, not swallow it. */
export class CorrectionValidationError extends Error {}

/**
 * Server-owned fields that ei_lookup returns on every entity and that a
 * caller following the documented ei_lookup -> edit -> ei_update round-trip
 * will send straight back. Stripped before schema validation so the
 * round-trip actually works — id/last_updated are always server-assigned
 * (the id param and a fresh timestamp win, never a caller-supplied value),
 * and `type` is `lookupById`'s own discriminator, never a real entity field.
 * Any OTHER unknown key still fails validation — this is a narrow
 * allowlist, not permissive parsing.
 */
const ROUND_TRIP_FIELDS = ["id", "type", "last_updated"] as const;

function parseInput(entityType: CorrectableType, body: unknown, mode: "create" | "update"): FactInput | TopicInput | PersonInput {
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
  entityType: CorrectableType,
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
  const parsed = parseInput(entityType, body, "create");
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }

  const id = crypto.randomUUID();
  const record = await buildAndWriteUpsert(entityType, id, parsed, Object.values(state.personas).map((p) => p.entity));
  return { id, record };
}

export async function updateEntity(
  entityType: CorrectableType,
  id: string,
  body: unknown
): Promise<Fact | Topic | Person> {
  const parsed = parseInput(entityType, body, "update");
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }

  const array = entityType === "fact" ? state.human.facts : entityType === "topic" ? state.human.topics : state.human.people;
  if (!array.some((item: { id: string }) => item.id === id)) {
    throw new Error(`No ${entityType} found with id: ${id}`);
  }

  return buildAndWriteUpsert(entityType, id, parsed, Object.values(state.personas).map((p) => p.entity));
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
