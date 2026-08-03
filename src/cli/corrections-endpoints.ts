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
 *
 * createQuoteEntity/fixQuoteEntity (`ei create quote`/`ei fix quote`) are a
 * separate, source-verified write path living in this same file: they
 * resolve a source message and match caller text against it before ever
 * building a CorrectionRecord, per the Corrections Wire Grammar
 * (`.sisyphus/plans/2-quote-attestation.md`) — see verifyQuoteAgainstSource.
 */

import { z } from "zod";
import { loadLatestState, resolveExternalMessage } from "./retrieval.js";
import { writeCorrection } from "./corrections-writer.js";
import { sanitizeEiPersonaIdentifiers } from "../core/utils/identifier-utils.js";
import { isQualifiedMessageId, qualifyEiMessage, UUID_PATTERN } from "../core/utils/message-id.js";
import { computeDataItemEmbedding, computeQuoteEmbedding } from "../core/embedding-service.js";
import type { CorrectableType, CorrectionRecord, QuoteCreateRecord, QuoteFixRecord } from "../core/corrections.js";
import type { Fact, Topic, Person, Quote } from "../core/types.js";
import type { PersonaEntity } from "../core/types/entities.js";
import type { ResolvedMessage } from "./retrieval.js";
import { matchQuoteInMessage } from "../core/handlers/human-matching.js";
import type { QuoteMatch } from "../core/handlers/human-matching.js";

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

/**
 * `ei create quote` / MCP `ei_quote_create` input — deliberately narrow:
 * only `message_id`/`text` (required) and `start`/`end` (optional
 * consistency-check offsets, see verifyQuoteAgainstSource below) are
 * accepted. speaker/timestamp/channel/embedding/created_at/created_by are
 * never caller-supplied — they're derived server-side in createQuoteEntity
 * — so `z.strictObject` schema-rejects any of those fields the instant
 * they appear, before any resolution/matching ever runs.
 */
const quoteCreateInputSchema = z.strictObject({
  message_id: z.string().min(1),
  text: z.string().min(1),
  start: z.number().optional(),
  end: z.number().optional(),
});
export type QuoteCreateInput = z.infer<typeof quoteCreateInputSchema>;

/**
 * `ei fix quote` / MCP `ei_quote_fix` input — same narrowness as create,
 * keyed by `quote_id` instead of `message_id`: a fix re-verifies against
 * the target's EXISTING source, it never re-resolves a new one (see
 * fixQuoteEntity below).
 */
const quoteFixInputSchema = z.strictObject({
  quote_id: z.string().min(1),
  text: z.string().min(1),
  start: z.number().optional(),
  end: z.number().optional(),
});
export type QuoteFixInput = z.infer<typeof quoteFixInputSchema>;

/**
 * Formats zod validation issues for quoteCreateInputSchema/quoteFixInputSchema
 * failures. Every field on these two strict, enum-free schemas
 * (message_id/quote_id/text: string, start/end: number) only ever produces
 * a fixed schema field name or a bounded JS type name in its `.message` --
 * neither is caller-controlled. `unrecognized_keys` is the one exception:
 * Zod builds that issue's own message directly from the caller's literal
 * `--json` property names (node_modules/zod/v3/locales/en.js:17-19), so
 * echoing it verbatim let an extra JSON key -- including one decoded from
 * terminal control/ANSI bytes -- reach CLI/MCP output unsanitized (I6,
 * .sisyphus/reviews/wave-2-quote-attestation.md). That one issue gets a
 * fixed, generic message instead; every other issue keeps its normal,
 * already-safe `path: message` text.
 */
function formatQuoteValidationIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) =>
      issue.code === z.ZodIssueCode.unrecognized_keys
        ? "unrecognized field(s) present"
        : `${issue.path.join(".")}: ${issue.message}`
    )
    .join("; ");
}

const SCHEMAS = { fact: factSchema, topic: topicSchema, person: personSchema } as const;

export type FactInput = z.infer<typeof factSchema>;
export type TopicInput = z.infer<typeof topicSchema>;
export type PersonInput = z.infer<typeof personSchema>;

/** Thrown on schema violations — callers should surface `.message` directly, not swallow it. */
export class CorrectionValidationError extends Error {}

/**
 * Returned by createQuoteEntity/fixQuoteEntity instead of the
 * materialized Quote when writeCorrection() could only append the
 * record — a live Ei instance holds ei.lock, or (per
 * corrections-writer.ts's backup-only branch) no instance is running yet
 * but a remote sync pull is pending. Nothing has validated the write
 * synchronously in either case: the record is durably queued in
 * corrections.json and will be applied (or skipped) whenever that other
 * process's own drain next runs, but that outcome lives entirely in a
 * different process and cannot be observed from here (I8,
 * .sisyphus/reviews/wave-2-quote-attestation.md). Deliberately never
 * shaped like a Quote (no `text`/`message_id`/etc.) so a caller cannot
 * mistake this for a confirmed create/fix — re-querying `id` (e.g. via
 * ei_lookup) after the fact is the only way to confirm the outcome.
 */
export interface QuoteWritePending {
  status: "queued";
  id: string;
  message: string;
}

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

/**
 * Shared verification core for createQuoteEntity/fixQuoteEntity (the
 * plan's "same verification core as create" requirement for fix).
 * Resolves `messageId` via T2a's ResolvedMessage adapter, matches
 * `candidateText` against the resolved content via T1's
 * matchQuoteInMessage (Level 1 normalized-exact, Level 2 word-boundary
 * fallback — first-hit only, no later-occurrence selection), and enforces
 * the offset disambiguator's consistency-check semantics: `start`/`end`,
 * when supplied, must exactly equal the half-open span the matcher
 * independently finds, or the write refuses — they are never an
 * occurrence-selector.
 *
 * Throws a plain Error (never CorrectionValidationError — these are
 * verification-time refusals against otherwise well-formed input, not
 * schema-shape violations) with one of three shared, named reasons:
 * "source message could not be found" (the message_id doesn't resolve at
 * all — a null/refused/cross-machine-error result from
 * resolveExternalMessage are all the same "cannot verify" disposition for
 * this purpose; a refusal/error's own more specific detail is
 * deliberately never echoed into this message — it can carry a
 * caller-controlled id or this machine's own hostname, see I1 in
 * .sisyphus/reviews/wave-2-quote-attestation.md), "quote text not found
 * in source message" (no match at either level), or "offset does not
 * match the resolved text location" (start/end supplied but
 * inconsistent, only one of the two supplied, or either falls outside
 * the source content's bounds — an out-of-range offset can never equal
 * the matcher's real, in-bounds position, so a single equality check
 * covers all three cases). `refusalPrefix` supplies the create/fix-
 * specific context (and, for fix, the target id).
 */
async function verifyQuoteAgainstSource(
  messageId: string,
  candidateText: string,
  callerStart: number | undefined,
  callerEnd: number | undefined,
  refusalPrefix: string
): Promise<{ resolved: ResolvedMessage; match: QuoteMatch }> {
  const resolved = await resolveExternalMessage(messageId);
  if (!resolved || "refused" in resolved || "error" in resolved) {
    throw new Error(`${refusalPrefix}: source message could not be found`);
  }

  const match = matchQuoteInMessage(candidateText, resolved.content);
  if (!match) {
    throw new Error(`${refusalPrefix}: quote text not found in source message`);
  }

  const hasStart = callerStart !== undefined;
  const hasEnd = callerEnd !== undefined;
  if (hasStart || hasEnd) {
    const consistent = hasStart && hasEnd && callerStart === match.start && callerEnd === match.end;
    if (!consistent) {
      throw new Error(`${refusalPrefix}: offset does not match the resolved text location`);
    }
  }

  return { resolved, match };
}

/**
 * `ei create quote` / MCP `ei_quote_create` — the only path that can
 * originate a brand-new, verified Quote. Verifies `text` against the
 * message `message_id` resolves to, then derives every provenance field
 * server-side: `message_id` becomes the resolver's canonical `source_id`
 * (never the caller's raw input), `speaker`/`channel`/`timestamp` come
 * from the resolved source, `embedding` is computed fresh from the
 * matched text, and `created_by` is the literal "extraction" — per the
 * design's decision that this value means "verifiable," not "produced by
 * the extraction pipeline specifically." `data_item_ids`/`persona_groups`
 * start empty (a freshly created quote has no links yet — relink is a
 * separate verb). Queues a Wire-Grammar `quote.create` record carrying
 * `verified: true`.
 *
 * Returns a QuoteWritePending instead of the materialized Quote when
 * writeCorrection() could only queue the record (see the I8 comment
 * below) — a caller that only checks for Quote-shaped fields must not
 * mistake that for a confirmed create.
 */
export async function createQuoteEntity(body: unknown): Promise<Quote | QuoteWritePending> {
  const result = quoteCreateInputSchema.safeParse(body);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid quote (create): ${formatQuoteValidationIssues(result.error.issues)}`
    );
  }
  const { message_id, text, start, end } = result.data;

  const { resolved, match } = await verifyQuoteAgainstSource(message_id, text, start, end, "Cannot create quote");

  const speaker = resolved.speaker.kind === "human" ? "human" : resolved.speaker.display_name;
  const embedding = await computeQuoteEmbedding(match.text);

  const quote: Quote = {
    id: crypto.randomUUID(),
    message_id: resolved.source_id,
    data_item_ids: [],
    persona_groups: [],
    text: match.text,
    speaker,
    channel: resolved.container.display_name,
    timestamp: resolved.timestamp,
    start: match.start,
    end: match.end,
    created_at: new Date().toISOString(),
    created_by: "extraction",
    embedding,
  };

  const attemptId = crypto.randomUUID();
  // I7 (round 4, .sisyphus/reviews/wave-2-quote-attestation.md): attempt_id
  // is listed AFTER ...quote, never before -- `quote` above is always
  // freshly constructed with no attempt_id of its own, but ordering it
  // last here too (matching the already-correct channel/embedding/verified
  // pattern) means a fresh call token can never be shadowed even if that
  // ever stopped being true. This fix must not depend on the invariant
  // holding perfectly forever; see fixQuoteEntity, where `quote` starts
  // from persisted state and the same defense is load-bearing today.
  const record: QuoteCreateRecord = { op: "quote.create", entity_type: "quote", ...quote, channel: resolved.container.display_name, embedding: quote.embedding ?? [], verified: true, attempt_id: attemptId };
  const { skipped, drainMode } = await writeCorrection(record);

  // I8 (round 4): a "queued" drain mode means writeCorrection() only
  // appended this record -- a live Ei instance (or a pending sync) will
  // validate and apply it on its own, in a different process, on its own
  // loop. That process's outcome cannot be observed synchronously here: a
  // live Processor can drain and clear corrections.json at any point
  // after this call returns, including before any follow-up read this
  // function could perform, which made re-deriving the outcome via a
  // fresh overlay read (the retired getLastCorrectionSkips() fallback)
  // a genuine race -- by the time such a read happened, the queue entry
  // (and any skip it produced) could already be gone, which the old code
  // wrongly read as "not found in skips, must have succeeded." Report the
  // honest, unresolved state instead of guessing at a result that may
  // already be stale the moment it's computed.
  if (drainMode === "queued") {
    return {
      status: "queued",
      id: quote.id,
      message: "Quote create queued: a live Ei instance is processing this write; it has not been confirmed yet.",
    };
  }

  // I5 (round 3) / I7 (round 4): attempt_id -- a fresh crypto.randomUUID()
  // minted for this call alone, never persisted on the Quote itself -- is
  // what proves THIS call's own record applied, replacing the retired
  // final-state read-back entirely (a coincidental text match could
  // otherwise manufacture a false success). A self-drain's `skipped`
  // return already reflects validation run synchronously against
  // `record` (writeCorrection), so it alone is authoritative -- there is
  // nothing left to re-check (the live-lock/backup-only case is handled
  // entirely above, so `drainMode` here is always "self"). See the
  // longer matching comment in fixQuoteEntity for the full rationale;
  // create shares the identical mechanism so both endpoints use one
  // uniform verdict strategy rather than two.
  const skippedMine = skipped.some((s) => s.attempt_id === attemptId);
  if (skippedMine) {
    throw new Error("Cannot create quote: the write could not be verified");
  }

  return stripEmbedding(quote);
}

/**
 * `ei fix quote` / MCP `ei_quote_fix` — re-verifies an existing Quote's
 * text against its ALREADY-RECORDED source (never re-resolves a new
 * message_id — see the field table in the plan). Refuses with four
 * distinct, named reasons: orphaned (the target's `message_id` is already
 * null — nothing to verify against), dangling (the recorded source no
 * longer resolves), no-match (the text isn't found in the source), and
 * offset-mismatch (supplied start/end don't match what the matcher
 * independently finds).
 *
 * `message_id`/`speaker`/`timestamp`/`channel`/`created_at`/`created_by`/
 * `data_item_ids`/`persona_groups` are all copied from the CURRENT record
 * purely so the wire record satisfies the Corrections Wire Grammar's
 * full-field-set shape — the dispatcher (applyQuoteOperation) overwrites
 * all eight from its own current-state copy at apply time regardless of
 * what's sent here, so no effort is spent deriving anything "better" for
 * them than what's already on `current`.
 *
 * Returns a QuoteWritePending instead of the materialized Quote when
 * writeCorrection() could only queue the record (see the I8 comment
 * below) — a caller that only checks for Quote-shaped fields must not
 * mistake that for a confirmed fix.
 */
export async function fixQuoteEntity(body: unknown): Promise<Quote | QuoteWritePending> {
  const result = quoteFixInputSchema.safeParse(body);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid quote (fix): ${formatQuoteValidationIssues(result.error.issues)}`
    );
  }
  const { quote_id, text, start, end } = result.data;

  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  const current = state.human.quotes.find((q) => q.id === quote_id);
  if (!current) {
    // I1 (round 2): never interpolate the caller-supplied quote_id into a
    // public error -- a control-character-bearing id could otherwise
    // inject into terminal/MCP output (see
    // .sisyphus/reviews/wave-2-quote-attestation.md). The caller already
    // knows what id they supplied; a fixed, stable refusal is enough.
    throw new Error("Cannot fix quote: no quote found with the supplied id");
  }
  if (current.message_id === null) {
    throw new Error("Cannot fix quote: no source message to verify against");
  }

  // I3: T5's message-id migration (src/core/migrations.ts) conservatively
  // leaves a Quote's message_id as a bare (unqualified) internal UUID
  // when its stored text doesn't match the mapped source at migration
  // time -- resolveExternalMessage only recognizes qualified ids and a
  // legacy bare `msg_*` OpenCode id, so a bare UUID otherwise resolves to
  // null forever. T5 only ever maps FROM a candidate that is *already*
  // "ei:"-qualified (see migrateMessageIds' eiUuidMap), so the real local
  // source -- if it still exists -- is always reachable under its
  // qualified form. Re-qualify for lookup purposes only: this repairs
  // the quote's text, it never rewrites the quote's own stored
  // message_id (that stays T5/migration's job).
  const lookupId =
    !isQualifiedMessageId(current.message_id) && UUID_PATTERN.test(current.message_id)
      ? qualifyEiMessage(current.message_id)
      : current.message_id;

  const { match } = await verifyQuoteAgainstSource(lookupId, text, start, end, "Cannot fix quote");
  const embedding = await computeQuoteEmbedding(match.text);

  const quote: Quote = { ...current, text: match.text, start: match.start, end: match.end, embedding };

  const attemptId = crypto.randomUUID();
  // I7 (round 4, .sisyphus/reviews/wave-2-quote-attestation.md): attempt_id
  // is listed AFTER ...quote, never before. `quote` above starts from
  // `current` -- the persisted, on-disk record -- which is untyped at the
  // JSON boundary (src/cli/retrieval.ts) and so is not guaranteed to be
  // free of a stray runtime attempt_id property (hand-edited state, or
  // any past/future bug that let one leak through). Listing the fresh
  // token last, matching the already-correct channel/embedding/verified
  // pattern, means such a stray value can never shadow it and get read
  // back below as if it were THIS call's own correlation id.
  const record: QuoteFixRecord = {
    op: "quote.fix",
    entity_type: "quote",
    ...quote,
    channel: quote.channel && quote.channel.length > 0 ? quote.channel : "unknown",
    embedding: quote.embedding ?? [],
    verified: true,
    attempt_id: attemptId,
  };
  const { skipped, drainMode } = await writeCorrection(record);

  // I8 (round 4): a "queued" drain mode means writeCorrection() only
  // appended this record -- a live Ei instance (or a pending sync) will
  // validate and apply it on its own, in a different process, on its own
  // loop. That process's outcome cannot be observed synchronously here: a
  // live Processor can drain and clear corrections.json at any point
  // after this call returns, including before any follow-up read this
  // function could perform, which made re-deriving the outcome via a
  // fresh overlay read (the retired getLastCorrectionSkips() fallback)
  // a genuine race -- by the time such a read happened, the queue entry
  // (and any skip it produced) could already be gone, which the old code
  // wrongly read as "not found in skips, must have succeeded." Report the
  // honest, unresolved state instead of guessing at a result that may
  // already be stale the moment it's computed.
  if (drainMode === "queued") {
    return {
      status: "queued",
      id: quote.id,
      message: "Quote fix queued: a live Ei instance is processing this write; it has not been confirmed yet.",
    };
  }

  // I1/I5 (round 3) / I7 (round 4): attempt_id -- a fresh
  // crypto.randomUUID() minted for this call alone, never persisted on
  // the Quote itself -- is the ONLY thing that decides success now. It
  // replaces mechanisms retired across earlier rounds:
  //   - I4's record_id match (round 2): ambiguous the moment an unrelated
  //     pending correction shares this quote's id.
  //   - the final-state text/start/end read-back (round 3, I5): a
  //     malformed carried-forward field (e.g. an empty speaker) can be
  //     skipped even when the old and requested text/spans coincide,
  //     which a projection can never distinguish from a genuine write.
  // A self-drain's own `skipped` return already reflects validation run
  // synchronously against `record` (writeCorrection), so it alone is
  // authoritative -- there is nothing left to re-check, and the
  // live-lock/backup-only case is handled entirely above, before this
  // point, so `drainMode` here is always "self".
  //
  // The skip's own `reason` can interpolate a caller-selected quote id
  // (e.g. a concurrent quote.remove producing `quote "<id>" does not
  // exist`) or other internal detail -- it is used here only as a
  // presence check, NEVER read as text: the public refusal below is a
  // fixed, id-free string regardless of what the internal reason says.
  const skippedMine = skipped.some((s) => s.attempt_id === attemptId);
  if (skippedMine) {
    throw new Error("Cannot fix quote: the write could not be verified");
  }

  return stripEmbedding(quote);
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
