/**
 * Validated create/update/remove endpoints for ei_create, ei_update, and
 * ei_remove — shared by the CLI subcommands (src/cli.ts) and the MCP tools
 * (src/cli/mcp.ts) so both surfaces enforce identical schemas and produce
 * identical CorrectionRecords.
 *
 * Every accepted entity is fully materialized here — id assigned (create),
 * embedding computed, Person identifiers sanitized and name-synced — before
 * being handed to writeCorrection(). `topic`/`person` updates are RFC 7396
 * JSON Merge Patch (ADR-029): a field the caller omits from the update body
 * is left UNCHANGED, never reset to a default — see resolveTopicPatchCandidate/
 * resolvePersonPatchCandidate (src/core/corrections.ts) and
 * src/core/entity-schemas.ts's schema-pair mechanism. `fact` is the one
 * permanent exception (Must-Have 9): `ei_update fact` stays full-record
 * replacement, so a caller round-tripping a full `ei_lookup` result is still
 * correct for fact specifically, just not for topic/person/persona anymore.
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
import {
  topicCreateSchema as topicSchema,
  personCreateSchema as personSchema,
  topicPatchSchema,
  topicCandidateSchema,
  personPatchSchema,
  personCandidateSchema,
  stripHiddenDataItemFields,
  formatValidationIssues,
  type ExternalDataItem,
} from "../core/entity-schemas.js";
import { resolveTopicPatchCandidate, resolvePersonPatchCandidate } from "../core/corrections.js";
import type { CorrectableType, CorrectionRecord, MergePatch, QuoteCreateRecord, QuoteFixRecord, QuoteRelinkRecord, QuoteRemoveRecord } from "../core/corrections.js";
import type { Fact, Topic, Person, Quote } from "../core/types.js";
import type { PersonaEntity } from "../core/types/entities.js";
import type { ResolvedMessage } from "./retrieval.js";
import { matchQuoteInMessage } from "../core/handlers/human-matching.js";
import type { QuoteMatch } from "../core/handlers/human-matching.js";

// Fact/topic/person handling below is keyed by this narrower alias, not the
// full CorrectableType — parseInput/buildAndWriteUpsert only ever validate
// and materialize these 3 types. Quotes get their own dedicated paths
// (createQuoteEntity/fixQuoteEntity/relinkQuoteEntity/removeQuoteEntity,
// each with different embedding/verification/link semantics) rather than
// flowing through this shared machinery. The retired `update` path is the
// one exception: updateEntity's own quote branch is an ADR-012 tombstone
// that always rejects, not a handler at all (see its doc comment below).
type NonQuoteType = "fact" | "topic" | "person";
// `quote` joined this list in Wave 3 (T4) — create/fix/relink/remove are
// all either source-verified or provenance-free by construction (see the
// Corrections Wire Grammar), so quote is no longer create/remove-excluded
// the way it was pre-attestation. This membership is load-bearing, not
// cosmetic, for cli.ts's dispatch, in three independent, dedicated
// places -- not one shared interception (M2,
// .sisyphus/reviews/wave-3-t4-diff-review.md, Round 3): (1) `ei create
// quote`/`ei create quotes` is intercepted ahead of the generic create
// dispatch (it needs its own discrete flags rather than the generic
// --json body); that interception's own
// resolveCorrectableType(args[1]) === "quote" check resolves through
// cli.ts's own CLI_CORRECTABLE_TYPES/PLURAL_TO_CORRECTABLE, both derived
// from this exact constant, so dropping "quote" here would stop the
// interception from firing for either spelling, not merely change its
// usage/error text. (2) `ei fix quote` is a SEPARATE top-level reserved
// verb (src/cli.ts:362-410) -- not a create-dispatch interception, since
// it never reaches the generic create dispatch at all -- resolved via
// the same resolveCorrectableType and so equally dependent on this
// constant. (3) `ei relink quote` is likewise its own separate
// top-level reserved verb (src/cli.ts:413-452), independently dependent
// on this constant. `ei remove quote <id>` has no interception of its
// own either and depends entirely on this constant so the generic
// remove dispatch can reach removeEntity's quote branch. `ei update
// quote` is unaffected by any of the above -- it resolves through
// cli.ts's entirely separate UPDATABLE_TYPES/resolveUpdatableType pair,
// independent of this constant.
export const CORRECTABLE_TYPES: CorrectableType[] = ["fact", "topic", "person", "quote"];
// Update accepts the same set as create/remove now that quote has joined
// CORRECTABLE_TYPES above — kept as its own named constant (not an alias)
// since `ei update quote` is a distinct, ADR-012-tombstoned surface: the
// CLI/MCP schema still accepts the parameter shape, but updateEntity's own
// quote branch always rejects. See updateEntity's doc comment below.
export const UPDATABLE_TYPES: CorrectableType[] = ["fact", "topic", "person", "quote"];

// ADR-031 field-visibility sweep (this plan's TODO 3): every field that
// was here previously — `learned_on`/`last_mentioned`/`learned_by`/
// `last_changed_by`/`interested_personas`/`sources`/`persona_groups`
// (all System Visible: read, never caller-write — provenance is never
// caller-assertable, ADR-031's own table) and `rewrite_length_floor`
// (System Hidden, system-written on update per ADR-032) — is gone from
// every one of factSchema/topicSchema/personSchema's write-side shapes
// below. None of them survive as Full Access on any of the three types,
// so this shared object has nothing left to contribute and no longer
// exists; a caller submitting any of them now gets `z.strictObject`'s
// ordinary unrecognized-key rejection, not a silent accept-and-ignore.

const factSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string(),
  sentiment: z.number().min(-1).max(1),
  validated_date: z.string(),
});

// `exposure_current`/`exposure_desired` (System Hidden — ADR-031, ADR-025)
// and `last_ei_asked` (System Hidden — Ei's own bookkeeping, state.json is
// that surface) are gone from Topic's write-side shape entirely, per this
// plan's TODO 3. `topicBaseShape`/`personBaseShape` and their derived
// patch/candidate schemas now live in `src/core/entity-schemas.ts`
// (relocated 2026-08-07, Beta's review [I3]) — core's own drain-time
// candidate validation (resolveTopicPatchCandidate/
// resolvePersonPatchCandidate) needs the SAME real Zod schemas this CLI
// layer parses input against, not a hand-maintained shadow of them, so
// there is exactly one declaration for each, imported at the top of this
// file rather than re-declared.


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
 * `ei relink quote` / MCP `ei_quote_relink` input — `{id, data_item_ids}`
 * only, per the Corrections Wire Grammar's `quote.relink` row. No
 * provenance field exists on this shape at all (not text, not message_id,
 * not verified) — relink asserts nothing about a Quote's source, it only
 * changes which facts/topics/people it's linked to, so it's permitted on
 * every population, orphaned/dangling included. `data_item_ids` is the
 * COMPLETE replacement list, not an additive delta — omitting an existing
 * link drops it.
 */
const quoteRelinkInputSchema = z.strictObject({
  id: z.string().min(1),
  data_item_ids: z.array(z.string()),
});
export type QuoteRelinkInput = z.infer<typeof quoteRelinkInputSchema>;

const SCHEMAS = { fact: factSchema, topic: topicSchema, person: personSchema } as const;
const PATCH_SCHEMAS = { topic: topicPatchSchema, person: personPatchSchema } as const;

export type FactInput = z.infer<typeof factSchema>;
export type TopicInput = z.infer<typeof topicSchema>;
export type PersonInput = z.infer<typeof personSchema>;
export type TopicPatchInput = z.infer<typeof topicPatchSchema>;
export type PersonPatchInput = z.infer<typeof personPatchSchema>;
export { topicCandidateSchema, personCandidateSchema, topicPatchSchema, personPatchSchema };

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
 * Returned by relinkQuoteEntity instead of the materialized Quote when a
 * SELF-drain declined to apply this call's own record. Two distinct
 * causes both land here: (1) this call's own attempt_id appears in
 * writeCorrection()'s skipped list -- a stale data_item_ids target, or
 * the target quote itself no longer existing at apply time, are BOTH
 * reported skips now (I2, .sisyphus/reviews/wave-3-t4-diff-review.md,
 * Round 3 -- see applyQuoteOperation's "quote.relink" case, which used
 * to silently no-op on a missing target instead of reporting it); or (2)
 * this call's own write was NOT skipped (so it genuinely applied) but a
 * fresh post-drain read still cannot find the quote -- a later,
 * independent removal, not caused by this call. Distinct from
 * QuoteWritePending: the write was not merely queued, it was evaluated
 * synchronously. relinkQuoteEntity mints its own fresh attempt_id (the
 * same mechanism createQuoteEntity/fixQuoteEntity already use) so case
 * (1) can always be attributed to THIS call's own record with certainty
 * -- closing the gap where a same-id `quote.create` replay could
 * otherwise launder a self-drained no-op into a materialized false
 * success, no matter how many fields the replay happens to share with
 * the pre-relink snapshot. Re-querying `id` (e.g. via ei_lookup) remains
 * the only way to confirm the actual outcome when this is returned.
 */
export interface QuoteWriteUnconfirmed {
  status: "unconfirmed";
  id: string;
  message: string;
}

/**
 * Returned by createQuoteEntity/fixQuoteEntity instead of the
 * materialized Quote when a CONFIRMED self-drain merged this call's own
 * record into an existing overlapping quote on the same message instead
 * of leaving two overlapping records (ADR-030's "attestation behaves
 * exactly as extraction does" — see mergeOverlappingQuotes,
 * src/core/corrections.ts). `quote` is the surviving, persisted record;
 * `absorbed` is every OTHER quote's id folded into it (never `quote.id`
 * itself). Returned ONLY after a confirmed self-drain: a queued write
 * (drainMode "queued") keeps returning QuoteWritePending, unchanged and
 * with no `absorbed` list, because a queued write has not been evaluated
 * yet and cannot honestly report what — if anything — it will absorb.
 */
export interface QuoteMerged {
  status: "merged";
  quote: Quote;
  absorbed: string[];
  message: string;
}

/** Human-readable explanation for a QuoteMerged response — the only signal a caller (often an agent) gets that a `create`/`fix` call quietly absorbed a neighbour instead of leaving it coexisting, per ADR-030's Consequences ("the message field mitigates this only for the caller who triggered the merge"). */
function describeQuoteMerge(verb: "create" | "fix", survivorId: string, absorbed: string[]): string {
  const isSingle = absorbed.length === 1;
  return `Quote ${verb} merged with ${absorbed.length} overlapping ${isSingle ? "quote" : "quotes"} already on this message instead of leaving overlapping duplicates: data_item_ids/persona_groups were unioned onto the surviving quote (${survivorId}), and ${isSingle ? "the absorbed quote no longer exists" : "the absorbed quotes no longer exist"}.`;
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
      `Invalid ${entityType}: ${formatValidationIssues(result.error.issues)}`
    );
  }
  return result.data;
}

/**
 * Parses an `ei update topic`/`ei update person` body as an RFC 7396
 * merge PATCH (ADR-029) — every field optional, `unrecognized_keys`
 * rejects any field ADR-031 classifies Hidden or System Visible (they
 * simply aren't in `topicPatchSchema`/`personPatchSchema`'s shape at
 * all, per this plan's TODO 3). ROUND_TRIP_FIELDS is still stripped
 * first: those four are pure read-shape noise (`ei --id` echoes them),
 * never a data assertion, so a caller who hasn't yet adopted the
 * patch-only contract and still round-trips full `ei_lookup` output
 * isn't punished for including them — unlike a genuine Hidden/System
 * Visible field, which IS a real assertion and must be rejected.
 */
function parsePatchInput(entityType: "topic" | "person", body: unknown): TopicPatchInput | PersonPatchInput {
  let input: unknown = body;
  if (body && typeof body === "object") {
    const stripped: Record<string, unknown> = { ...body };
    for (const field of ROUND_TRIP_FIELDS) {
      delete stripped[field];
    }
    input = stripped;
  }
  const result = PATCH_SCHEMAS[entityType].safeParse(input);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid ${entityType} update: ${formatValidationIssues(result.error.issues)}`
    );
  }
  return result.data;
}

/**
 * Materialize a validated CREATE input into a full entity record (id,
 * name-synced identifiers, embedding) and persist it as an `upsert`
 * correction. Shared by createEntity (fresh id, all three types) and
 * updateEntity's `fact` branch (caller-supplied id) — fact is the
 * ADR-029-stated permanent full-record-replacement exception
 * (Must-Have 9), so its update path stays exactly this function, never
 * the merge-patch pipeline topic/person use below.
 *
 * `exposure_current`/`exposure_desired` are stamped here directly rather
 * than taken from `parsed` — they left Topic's and Person's write-side
 * schema entirely under ADR-031 (System Hidden), so there is no caller
 * value to read; a freshly created Topic/Person simply starts at the
 * same neutral values the old schema defaulted to.
 *
 * A self-drained Person write that the drain-time cardinality guard
 * declined a link on (ADR-006/ADR-010) throws here — the ONLY drain mode
 * with a caller still present to answer synchronously. The record itself
 * was already saved with the offending link dropped and everything else
 * intact; the throw is purely the report, not an undo. The thrown message
 * names the Person by id, never by its own (caller-controlled) name (I5,
 * .sisyphus/reviews/tonight-post-audit-fix-queue.md) — every refusal's
 * `value`/`reason` text is already guardPersonaLinks's own responsibility
 * to keep safe. A live-queued write is never checked here — its own
 * outcome isn't known yet, and a refusal for it (if any) is reported
 * later via the `ei` persona thread once the live drain actually runs
 * (see StateManager.human_person_upsert / Processor's live drain path —
 * a queued write is never validated by this call at all).
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
    record = { ...input, id, identifiers, name, last_updated: now, exposure_current: 0, exposure_desired: 0.5 } as Person;
  } else if (entityType === "topic") {
    record = { ...(parsed as TopicInput), id, last_updated: now, exposure_current: 0, exposure_desired: 0.5 } as Topic;
  } else {
    record = { ...(parsed as FactInput), id, last_updated: now } as Fact;
  }

  record.embedding = await computeDataItemEmbedding(record);

  const correction: CorrectionRecord = { op: "upsert", entity_type: entityType, id, record, timestamp: now };
  const { personLinkRefusals, drainMode } = await writeCorrection(correction);

  if (entityType === "person" && drainMode === "self") {
    const ownRefusals = personLinkRefusals.filter((r) => r.personId === id);
    if (ownRefusals.length > 0) {
      const summary = ownRefusals.map((r) => `Persona ${r.value} (${r.reason})`).join("; ");
      throw new Error(
        `Person ${id} was saved, but the following Ei Persona link(s) were refused because they would break the one-Person-per-Persona rule: ${summary}`
      );
    }
  }

  return record;
}

export async function createEntity(
  entityType: CorrectableType,
  body: unknown
): Promise<{ id: string; record: ExternalDataItem }> {
  const parsed = parseInput(entityType as NonQuoteType, body, "create");
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }

  const id = crypto.randomUUID();
  const record = await buildAndWriteUpsert(entityType as NonQuoteType, id, parsed, Object.values(state.personas).map((p) => p.entity));
  return { id, record: stripHiddenDataItemFields(record) };
}

/**
 * The "quote" branch below is a TOMBSTONE (ADR-012,
 * docs/adr/ADR-012-sunset-with-a-path-forward.md): `ei update quote` / MCP
 * `ei_update` with entity_type "quote" is retired. It always rejects,
 * regardless of body shape or whether `id` resolves to anything — schema
 * validation, state loading, link validation, embedding computation, and
 * writeCorrection() are all gone deliberately, not merely unreachable,
 * per ADR-012's "a retired surface's job is to say what happened, not to
 * do any part of the old work first." Never delete this branch outright
 * (ADR-012 requires keep-and-reject, not disappearance) and never let it
 * fall through to the old full-replacement quote_upsert shape again.
 *
 * `fact` keeps `ei update`'s pre-ADR-029 full-record-replacement contract
 * exactly (Must-Have 9, permanent exception — no defaults, no merge-patch
 * path). `topic`/`person` implement ADR-029's RFC 7396 merge patch: the
 * target must already exist (there is nothing to merge onto otherwise),
 * every field the caller omits is left unchanged, `null` removes a
 * member, and a patch valid by grammar but invalid once merged onto
 * stored state is rejected wholesale by resolveTopicPatchCandidate/
 * resolvePersonPatchCandidate — nothing is written on that path either
 * way, since the actual write only happens inside writeCorrection's own
 * self-drain (or, for a live instance, ~100ms later inside the
 * Processor's own drain tick), never here.
 */
export async function updateEntity(
  entityType: NonQuoteType | "quote",
  id: string,
  body: unknown
): Promise<ExternalDataItem | Quote> {
  if (entityType === "quote") {
    throw new Error(
      `"ei update quote" is retired. Use "ei fix quote" to correct text, "ei relink quote" to change links, or "ei remove quote" to delete a quote instead — if you were told to call this, your installed skills predate this version. Scheduled for removal two releases after the one that ships this message (ADR-012).`
    );
  }

  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  const personas = Object.values(state.personas).map((p) => p.entity);

  if (entityType === "fact") {
    const parsed = parseInput("fact", body, "update");
    if (!state.human.facts.some((f) => f.id === id)) {
      throw new Error(`No fact found with id: ${id}`);
    }
    return stripHiddenDataItemFields(await buildAndWriteUpsert("fact", id, parsed, personas));
  }

  const array = entityType === "topic" ? state.human.topics : state.human.people;
  const current = array.find((item) => item.id === id);
  if (!current) {
    throw new Error(`No ${entityType} found with id: ${id}`);
  }

  const patch = parsePatchInput(entityType, body);
  const candidate: Topic | Person =
    entityType === "topic"
      ? await resolveTopicPatchCandidate(current as Topic, patch as MergePatch<Topic>)
      : await resolvePersonPatchCandidate(current as Person, patch as MergePatch<Person>, personas);

  // The correction queued below carries the raw PATCH only — never an
  // embedding. ADR-029 clause 1 forbids merging at write time against a
  // snapshot; the authoritative merge that actually decides what gets
  // written happens again at drain time (self-drain, moments later in
  // this same call via writeCorrection; or live-drain, ~100ms later in
  // the Processor's own tick), against whichever state is ACTUALLY
  // stored then — and THAT call to resolveTopicPatchCandidate/
  // resolvePersonPatchCandidate is the one that recomputes `embedding`,
  // from the finally-merged text (see those functions' own doc
  // comments). Smuggling a write-time embedding through the wire patch
  // — the previous approach — could silently overwrite a NEWER
  // description's vector if another write interleaved before this one
  // drained (Beta's review, [I2]); `candidate` here is a best-effort
  // PREVIEW for this call's own synchronous response only, computed
  // against THIS call's own snapshot, and is discarded once returned.
  const now = new Date().toISOString();
  const correction: CorrectionRecord = { op: "patch", entity_type: entityType, id, patch, timestamp: now };
  const { personLinkRefusals, drainMode } = await writeCorrection(correction);

  if (entityType === "person" && drainMode === "self") {
    const ownRefusals = personLinkRefusals.filter((r) => r.personId === id);
    if (ownRefusals.length > 0) {
      const summary = ownRefusals.map((r) => `Persona ${r.value} (${r.reason})`).join("; ");
      throw new Error(
        `Person ${id} was saved, but the following Ei Persona link(s) were refused because they would break the one-Person-per-Persona rule: ${summary}`
      );
    }
  }

  return stripHiddenDataItemFields(candidate);
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
 * mistake that for a confirmed create. Returns a QuoteMerged instead of
 * the materialized Quote when a CONFIRMED self-drain found the verified
 * span already overlapping another quote on this message (ADR-030): the
 * new record is never inserted at all in that case, it is unioned into
 * the existing quote, so "create" does not always create — a caller must
 * read the returned object rather than assume the id it gets back is new.
 */
export async function createQuoteEntity(body: unknown): Promise<Quote | QuoteWritePending | QuoteMerged> {
  const result = quoteCreateInputSchema.safeParse(body);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid quote (create): ${formatValidationIssues(result.error.issues)}`
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
  const { skipped, merged, drainMode } = await writeCorrection(record);

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

  // ADR-030: this self-drain's own applyQuoteOperation call may have
  // unioned this record into an existing overlapping quote on the same
  // message instead of inserting it as a new, coexisting record — in
  // which case `quote.id` above (this call's freshly-minted uuid) was
  // never persisted at all. `attempt_id`, not `quote.id`, is what
  // recognizes THIS call's own outcome (the same mechanism the skip
  // check below already uses), so it must be checked BEFORE the skip
  // check: a merge is never reported as a skip.
  const mergedMine = merged.find((m) => m.attempt_id === attemptId);
  if (mergedMine) {
    return {
      status: "merged",
      quote: stripEmbedding(mergedMine.quote),
      absorbed: mergedMine.absorbed,
      message: describeQuoteMerge("create", mergedMine.quote.id, mergedMine.absorbed),
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
 * mistake that for a confirmed fix. Returns a QuoteMerged instead of the
 * materialized Quote when a CONFIRMED self-drain found the re-verified
 * span now overlapping another quote on this message (ADR-030): that
 * neighbour is unioned in — `data_item_ids`/`persona_groups` grow to
 * include its links and it no longer exists — rather than left coexisting.
 * `quote_id` itself always survives a fix's own merge; only a neighbour
 * can be absorbed.
 */
export async function fixQuoteEntity(body: unknown): Promise<Quote | QuoteWritePending | QuoteMerged> {
  const result = quoteFixInputSchema.safeParse(body);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid quote (fix): ${formatValidationIssues(result.error.issues)}`
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
  const { skipped, merged, drainMode } = await writeCorrection(record);

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

  // ADR-030: this self-drain's own applyQuoteOperation call may have
  // widened this record's span into an overlap with another quote on
  // the same message and unioned that neighbour in — `quote_id` itself
  // always survives a fix's own merge (see applyQuoteOperation's
  // "quote.fix" case), but `absorbed` can only come from `merged`, never
  // from a plain re-read by id. Checked before the skip check below, for
  // the same reason createQuoteEntity does: a merge is never a skip.
  const mergedMine = merged.find((m) => m.attempt_id === attemptId);
  if (mergedMine) {
    return {
      status: "merged",
      quote: stripEmbedding(mergedMine.quote),
      absorbed: mergedMine.absorbed,
      message: describeQuoteMerge("fix", mergedMine.quote.id, mergedMine.absorbed),
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

  // I4 (.sisyphus/reviews/quote-attestation-final-implementation.md):
  // re-read and return the ACTUAL persisted quote rather than `quote`
  // (the local snapshot built from `current`, the pre-drain read at the
  // top of this function) -- if a concurrent relink lands in the SAME
  // self-drain batch ahead of this fix (writeCorrection() applies every
  // pending record, then this call's own record, in one sequential
  // fold), the persisted quote's data_item_ids reflect the relink, but
  // `quote` here can only ever carry the pre-relink snapshot's links
  // plus this call's own text/start/end/embedding overlay. Mirrors
  // relinkQuoteEntity's own identical "not skipped -> re-read and return
  // the real persisted record" fix.
  const after = await loadLatestState();
  if (!after) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  const afterQuote = after.human.quotes.find((q) => q.id === quote_id);
  if (!afterQuote) {
    // Not reachable from this call's own outcome -- this call's own
    // attempt_id was not in the skip list (checked above), so its write
    // applied; a missing quote here means a genuinely later, independent
    // removal landed after this call's own self-drain released its
    // locks but before this unlocked follow-up read, not something this
    // call's write caused. Matches the existing verification-failure
    // message above rather than inventing a new disposition for an
    // effectively unreachable branch.
    throw new Error("Cannot fix quote: the write could not be verified");
  }

  return stripEmbedding(afterQuote);
}

/**
 * `ei relink quote` / MCP `ei_quote_relink` — the only verb permitted to
 * change a Quote's `data_item_ids`. Carries no full-record provenance
 * fields (Corrections Wire Grammar's `quote.relink` row: `{id,
 * data_item_ids}` plus a transport-only `attempt_id`, mirroring
 * create/fix's own correlation token) — relink asserts nothing about
 * text/source, so unlike create/fix it's permitted on every population,
 * orphaned/dangling included, once `id` itself is confirmed to exist.
 *
 * `id`'s existence is checked HERE, before ever queueing anything, so a
 * genuinely nonexistent id gets an immediate named "quote not found"
 * error rather than a queued write whose failure could only be
 * discovered later. Each `data_item_ids` target gets the identical
 * treatment for the same reason, distinct from T2b's own state-aware
 * re-check of the same field at DRAIN time (the
 * relink-target-deleted-mid-flight race) — this is in addition to that,
 * not a replacement for it.
 *
 * Returns a QuoteWritePending instead of the materialized Quote when
 * writeCorrection() could only queue the record (a live Ei instance
 * holds ei.lock) — see createQuoteEntity's identical comment for why
 * that outcome can't be resolved synchronously from here. Returns a
 * QuoteWriteUnconfirmed instead when a SELF-drain declined to apply
 * this call's own record — identified by its own fresh attempt_id
 * appearing in writeCorrection()'s skipped list, the exact same
 * mechanism createQuoteEntity/fixQuoteEntity already use, rather than a
 * final-state field comparison (I2,
 * .sisyphus/reviews/wave-3-t4-diff-review.md, Round 3 — see that
 * interface's own doc comment for the full mechanism).
 */
export async function relinkQuoteEntity(body: unknown): Promise<Quote | QuoteWritePending | QuoteWriteUnconfirmed> {
  const result = quoteRelinkInputSchema.safeParse(body);
  if (!result.success) {
    throw new CorrectionValidationError(
      `Invalid quote (relink): ${formatValidationIssues(result.error.issues)}`
    );
  }
  const { id, data_item_ids } = result.data;

  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  const current = state.human.quotes.find((q) => q.id === id);
  if (!current) {
    throw new Error("Cannot relink quote: no quote found with the supplied id");
  }

  const validLinkIds = new Set([
    ...state.human.facts.map((f) => f.id),
    ...state.human.topics.map((t) => t.id),
    ...state.human.people.map((p) => p.id),
  ]);
  const invalidIds = data_item_ids.filter((itemId) => !validLinkIds.has(itemId));
  if (invalidIds.length > 0) {
    // I1 (.sisyphus/reviews/wave-3-t4-diff-review.md): never interpolate
    // caller-supplied data_item_ids into a public error -- a control/
    // ANSI-bearing invalid id could otherwise inject into terminal/MCP
    // output, the same output-injection class formatValidationIssues()
    // already prevents for Zod's unrecognized_keys above. The caller
    // already knows what ids they supplied; a fixed, stable refusal is
    // enough -- matches the "quote not found" refusals' own id-free
    // convention, not the byte-for-byte-echoing message this replaces.
    throw new CorrectionValidationError(
      "Invalid quote (relink): data_item_ids references unknown or disallowed entities (must resolve to an existing fact, topic, or person — not a quote, persona, or unmatched ID)"
    );
  }

  // I2 (.sisyphus/reviews/wave-3-t4-diff-review.md, Round 3): a fresh
  // crypto.randomUUID() minted for this call alone, never persisted on
  // the Quote itself (applyQuoteOperation's "quote.relink" case only
  // ever merges data_item_ids onto the existing record) -- the same
  // mechanism createQuoteEntity/fixQuoteEntity already use, replacing
  // the retired final-state field-projection comparison that could not
  // tell "this call's own write applied" apart from "a later, unrelated
  // same-id quote.create happens to look similar."
  const attemptId = crypto.randomUUID();
  const record: QuoteRelinkRecord = { op: "quote.relink", entity_type: "quote", id, data_item_ids, attempt_id: attemptId };
  const { skipped, drainMode } = await writeCorrection(record);

  if (drainMode === "queued") {
    return {
      status: "queued",
      id,
      message: "Quote relink queued: a live Ei instance is processing this write; it has not been confirmed yet.",
    };
  }

  // A self-drain's own `skipped` return already reflects validation run
  // synchronously against `record` (writeCorrection) -- this covers a
  // stale data_item_ids target AND the target quote no longer existing
  // at apply time, since applyQuoteOperation's "quote.relink" case now
  // reports BOTH as a skip carrying this same attempt_id (reversed from
  // the prior silent no-op on a missing target, I2 round 3). Matching by
  // attempt_id, not record_id, is what makes this attributable to THIS
  // call specifically even when an unrelated, already-pending relink for
  // the same quote shares the same record_id.
  const skippedMine = skipped.some((s) => s.attempt_id === attemptId);
  if (skippedMine) {
    return {
      status: "unconfirmed",
      id,
      message:
        "Quote relink could not be confirmed: the write was declined during processing. Re-check the quote's data_item_ids (e.g. via ei_lookup) to confirm the outcome.",
    };
  }

  // Not skipped: applyQuoteOperation now reports every non-application
  // case as a skip (a stale target, or the quote missing at apply time),
  // so there is no remaining case where "not skipped" could mean
  // anything other than "applied." Re-read the actual persisted quote
  // and return it as genuine success, rather than splicing the caller's
  // requested links onto the stale pre-relink snapshot (`current`) --
  // that splice is exactly what let an unrelated same-id recreation
  // launder a self-drained no-op into a materialized false success
  // before this call ever mattered (I2, rounds 2-3).
  const after = await loadLatestState();
  if (!after) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  const afterQuote = after.human.quotes.find((q) => q.id === id);
  if (!afterQuote) {
    // Not reachable from this call's own outcome -- applyQuoteOperation
    // reports a skip instead of silently no-op'ing whenever it doesn't
    // apply, and this call would already have returned above had its
    // own attempt_id been in that skip list. A missing quote here means
    // a genuinely later, independent removal landed after this call's
    // own self-drain released its locks but before this unlocked
    // follow-up read; this call's own write still applied and is not
    // what removed it.
    return {
      status: "unconfirmed",
      id,
      message: "Quote relink could not be confirmed: the quote no longer exists after processing.",
    };
  }

  return stripEmbedding(afterQuote);
}

export async function removeEntity(entityType: CorrectableType, id: string): Promise<QuoteWritePending | undefined> {
  if (entityType === "quote") {
    return removeQuoteEntity(id);
  }

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
  return undefined;
}

/**
 * `ei remove quote` / MCP `ei_remove` with entity_type "quote" —
 * removeEntity's explicit quote branch, returning before the fact/topic/
 * person dispatch below ever runs. That dispatch falls through to
 * state.human.people for any type it doesn't recognize by name, so
 * without this branch, adding "quote" to the enum would make `ei remove
 * quote <id>` silently search people for the id instead of quotes — a
 * real, silent-failure-shaped bug, not a hypothetical one.
 *
 * Returns a QuoteWritePending instead of undefined when writeCorrection()
 * could only queue the record (a live Ei instance holds ei.lock) — see
 * createQuoteEntity's identical comment for why that outcome can't be
 * resolved synchronously from here (I3,
 * .sisyphus/reviews/quote-attestation-final-implementation.md). Unlike
 * create/fix/relink, a confirmed self-drain needs no further attempt_id
 * check: applyQuoteOperation's "quote.remove" case unconditionally
 * filters by id with no existence guard of its own (it can never itself
 * appear in a self-drain's skipped list), and the wire record built
 * below is always structurally valid by construction -- the existence
 * check above, which runs before writeCorrection() is ever called, is
 * what remove relies on instead.
 */
async function removeQuoteEntity(id: string): Promise<QuoteWritePending | undefined> {
  const state = await loadLatestState();
  if (!state) {
    throw new Error("No saved state found. Is EI_DATA_PATH set correctly?");
  }
  if (!state.human.quotes.some((q) => q.id === id)) {
    throw new Error("Cannot remove quote: no quote found with the supplied id");
  }
  const record: QuoteRemoveRecord = { op: "quote.remove", entity_type: "quote", id };
  const { drainMode } = await writeCorrection(record);

  if (drainMode === "queued") {
    return {
      status: "queued",
      id,
      message: "Quote remove queued: a live Ei instance is processing this write; it has not been confirmed yet.",
    };
  }

  return undefined;
}
