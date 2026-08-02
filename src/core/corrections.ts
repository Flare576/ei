/**
 * Corrections Queue — external write path for CLI/MCP tools.
 *
 * Ei's CLI and MCP server are read-only against a snapshot of state.json —
 * they never hold the live StateManager the running TUI/daemon owns, so
 * they can't safely mutate state.json directly (the running instance's
 * next debounced save would silently clobber the write with its stale
 * in-memory copy).
 *
 * corrections.json is the queue that closes this gap. External writers
 * (ei_update / ei_create / ei_remove) append fully-formed CorrectionRecords
 * here under an advisory lock. Two consumers drain it:
 *   - The running Processor, once per runLoop tick (near-instant, ~100ms).
 *   - The CLI itself, self-draining directly into state.json when it
 *     detects no live instance is running (see src/cli/corrections-io.ts).
 *
 * Every CorrectionRecord is a complete, ready-to-apply entity — including
 * a pre-computed embedding and (for creates) a pre-assigned id — so
 * draining is a pure apply, never a fetch-then-merge.
 *
 * Quote records are the one exception to "generic upsert/remove": per the
 * Corrections Wire Grammar (`.sisyphus/plans/2-quote-attestation.md`), a
 * bare `{op:"upsert"|"remove", entity_type:"quote", ...}` is no longer a
 * legal way to mutate a Quote. The four `quote.*` operations below
 * (QuoteCorrectionRecord) are the only sanctioned shapes, each with its own
 * strict, non-overlapping field set — this is what closes the laundering
 * path where a `relink`/`remove` write could ride through the old
 * full-replacement upsert and silently forge or discard provenance fields.
 * See assertValidCorrection and applyQuoteOperation below.
 */

import type { HumanEntity, Fact, Topic, Person, Quote, PersonaEntity, StorageState } from "./types.js";
import { isReservedPersonaId } from "./types.js";
import { withLock, atomicWrite } from "../storage/file-lock.js";

export type CorrectableType = "fact" | "topic" | "person" | "quote" | "persona";
export type CorrectableEntity = Fact | Topic | Person | Quote | PersonaEntity;
export const CORRECTABLE_TYPES: CorrectableType[] = ["fact", "topic", "person", "quote", "persona"];

export interface CorrectionUpsert {
  op: "upsert";
  entity_type: CorrectableType;
  id: string;
  record: CorrectableEntity;
  timestamp: string;
}

export interface CorrectionRemove {
  op: "remove";
  entity_type: CorrectableType;
  id: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Quote Corrections Wire Grammar
//
// Four operations, each a distinct, strictly-validated shape. `op` is the
// real discriminant (each value below is disjoint from every other
// CorrectionRecord variant's `op`, including the generic "upsert"/"remove"),
// so a caller can never construct a record that is ambiguous between "this
// is a verified full-record write" and "this is a links-only/removal write
// that asserts no provenance." `entity_type: "quote"` is carried alongside
// for routing consistency with the generic types above, not as the
// discriminant itself.
//
// create/fix carry the complete, server-derived Quote payload plus a
// required `verified: true` marker — the marker is possible on no other
// shape. relink/remove carry no provenance-shaped fields at all: there is
// no field on either shape an attacker could use to smuggle a forged
// text/source/speaker/timestamp through, because the TypeScript shape
// itself has no slot for them (structural prevention, not a runtime guard
// alone).
// ---------------------------------------------------------------------------

interface QuoteFullFields {
  id: string;
  message_id: string | null;
  data_item_ids: string[];
  persona_groups: string[];
  text: string;
  speaker: string;
  channel: string;
  timestamp: string;
  start: number | null;
  end: number | null;
  created_at: string;
  created_by: "extraction" | "human";
  embedding: number[];
  verified: true;
}

/** `ei create quote` / MCP `ei_quote_create` — a brand-new, verified Quote. `data_item_ids`/`persona_groups` must be empty (a freshly created quote has no links yet). */
export interface QuoteCreateRecord extends QuoteFullFields {
  op: "quote.create";
  entity_type: "quote";
}

/** `ei fix quote` / MCP `ei_quote_fix` — re-verifies an existing Quote's text/source. `id` identifies the record being fixed — the target must already exist, `quote.fix` never inserts (only `quote.create` may). `data_item_ids`/`persona_groups`, along with `message_id`/`speaker`/`timestamp`/`channel`/`created_at`/`created_by`, are always taken from the existing record at apply time regardless of what this wire record carries for them — a fix corrects `text`/`start`/`end`/`embedding` only, it never touches links or immutable provenance (that's relink's job / simply immutable, respectively). */
export interface QuoteFixRecord extends QuoteFullFields {
  op: "quote.fix";
  entity_type: "quote";
}

/** `ei relink quote` / MCP `ei_quote_relink` — the ONLY shape permitted to change `data_item_ids`. No provenance fields exist on this shape at all, and `verified` is never permitted. */
export interface QuoteRelinkRecord {
  op: "quote.relink";
  entity_type: "quote";
  id: string;
  data_item_ids: string[];
}

/** `ei remove quote` / MCP `ei_remove` with `entity_type: "quote"` — `{id}` only, `verified` never permitted. */
export interface QuoteRemoveRecord {
  op: "quote.remove";
  entity_type: "quote";
  id: string;
}

export type QuoteCorrectionRecord = QuoteCreateRecord | QuoteFixRecord | QuoteRelinkRecord | QuoteRemoveRecord;

/** Structured, non-throwing diagnostic for one correction record a consumer declined to apply. Never a bare boolean or a swallowed exception — see the Corrections Wire Grammar's "Skip/report diagnostic shape." */
export interface QuoteCorrectionSkip {
  record_id: string;
  reason: string;
}

export type CorrectionRecord = CorrectionUpsert | CorrectionRemove | QuoteCorrectionRecord;

/** The only legal wire values for a quote correction's `op`. Any other value — including the retired generic "upsert"/"remove" — is a pre-cutover or malformed record and is rejected. Built with `Object.create(null)`, not an object literal: an object literal inherits `Object.prototype`, so a truthy lookup like `QUOTE_OPS[value.op]` would treat inherited names such as `constructor`/`toString` as if they were allowed values (I1) — a null-prototype object has no such inherited names to leak through. */
const QUOTE_OPS: Record<string, true> = Object.assign(Object.create(null), {
  "quote.create": true,
  "quote.fix": true,
  "quote.relink": true,
  "quote.remove": true,
});
// Strict per-operation allowlists — the literal "Required keys" columns
// from the Corrections Wire Grammar table, plus the structural `op`/
// `entity_type` fields. A key outside its operation's row is rejected by
// default, not silently passed through — this alone is what makes
// `verified` on a relink/remove record a rejection, with no separate
// marker-specific check required. Each is built on a null-prototype
// object for the same reason as QUOTE_OPS above: an ordinary object
// literal resolves inherited names (`constructor`, `toString`,
// `__proto__`, ...) to a truthy value on lookup even though the literal
// itself never declared them (I1).
const QUOTE_CREATE_FIX_ALLOWED_KEYS: Record<string, true> = Object.assign(Object.create(null), {
  op: true, entity_type: true, id: true, message_id: true, data_item_ids: true,
  persona_groups: true, text: true, speaker: true, channel: true, timestamp: true,
  start: true, end: true, created_at: true, created_by: true, embedding: true, verified: true,
});
const QUOTE_RELINK_ALLOWED_KEYS: Record<string, true> = Object.assign(Object.create(null), { op: true, entity_type: true, id: true, data_item_ids: true });
const QUOTE_REMOVE_ALLOWED_KEYS: Record<string, true> = Object.assign(Object.create(null), { op: true, entity_type: true, id: true });

/**
 * True when `value` is a quote-domain correction: either its `op` is one
 * of the four sanctioned `quote.*` literals (QUOTE_OPS), or its
 * `entity_type` is "quote" — checked independently of each other so a
 * record like `{op: "quote.relink", entity_type: "person", ...}` (or a
 * missing `entity_type` entirely) is still recognized as a malformed
 * quote operation rather than falling through to generic/persona
 * validation (I2). Every routing point that decides between
 * quote-specific handling (assertValidQuoteCorrection /
 * applyQuoteOperation) and the generic fact/topic/person/persona path
 * calls this instead of checking `entity_type === "quote"` directly, so a
 * wrong/missing `entity_type` on a `quote.*` op gets the same
 * skip/report disposition at all three consumers instead of reaching the
 * wrong branch (and, at the live drain, silently missing
 * getLastCorrectionSkips()). Declared as a type predicate (not a plain
 * `boolean`) so a `CorrectionRecord`-typed caller (e.g.
 * applyCorrectionToHuman) keeps the same post-check narrowing to
 * `CorrectionUpsert | CorrectionRemove` that the old direct
 * `entity_type === "quote"` comparison gave it for free.
 */
export function isQuoteCorrectionOp(value: object): value is QuoteCorrectionRecord {
  if ("op" in value && typeof value.op === "string" && QUOTE_OPS[value.op]) return true;
  return "entity_type" in value && value.entity_type === "quote";
}

/**
 * Runtime shape validation for a QuoteCorrectionRecord read back from
 * corrections.json, per the Corrections Wire Grammar. Private — the public
 * entry point is assertValidCorrection below, which delegates here the
 * moment it sees `entity_type: "quote"` (whether or not the record turns
 * out to actually be valid; a pre-cutover `{op:"upsert", entity_type:
 * "quote", ...}` reaches this function too, and is rejected here for
 * having an unrecognized `op`).
 *
 * `human`, when supplied, makes `quote.relink` validation state-aware: a
 * `data_item_ids` entry that no longer resolves to a live fact/topic/person
 * is rejected even though it was valid when the CLI originally queued the
 * record (the relink-target-deleted-mid-flight race). Every real consumer
 * (live drain, self-drain, read overlay) has a HumanEntity in scope and
 * always passes it; omitting it (as a narrow unit test validating only the
 * shape/marker rules might) simply skips the liveness check, it never
 * widens what's otherwise accepted.
 */
function assertValidQuoteCorrection(value: object, human: HumanEntity | undefined): asserts value is QuoteCorrectionRecord {
  if (!("op" in value) || typeof value.op !== "string" || !QUOTE_OPS[value.op]) {
    throw new Error(`Malformed quote correction: op must be one of "quote.create", "quote.fix", "quote.relink", "quote.remove", got ${JSON.stringify("op" in value ? value.op : undefined)}`);
  }
  const op = value.op;
  if (!("entity_type" in value) || value.entity_type !== "quote") {
    throw new Error(`Malformed quote correction: entity_type must be "quote", got ${JSON.stringify("entity_type" in value ? value.entity_type : undefined)}`);
  }
  if (!("id" in value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`Malformed quote correction (${op}): id must be a non-empty string, got ${JSON.stringify("id" in value ? value.id : undefined)}`);
  }

  const allowed = op === "quote.relink" ? QUOTE_RELINK_ALLOWED_KEYS : op === "quote.remove" ? QUOTE_REMOVE_ALLOWED_KEYS : QUOTE_CREATE_FIX_ALLOWED_KEYS;
  const extraKeys = Object.keys(value).filter((k) => !allowed[k]);
  if (extraKeys.length > 0) {
    throw new Error(`Malformed quote correction (${op}): unrecognized key(s) ${extraKeys.join(", ")} — allowed keys are ${Object.keys(allowed).join(", ")}`);
  }

  if (op === "quote.remove") {
    return;
  }

  if (op === "quote.relink") {
    if (!("data_item_ids" in value) || !Array.isArray(value.data_item_ids) || !value.data_item_ids.every((x): x is string => typeof x === "string")) {
      throw new Error(`Malformed quote correction (relink): data_item_ids must be an array of strings, got ${JSON.stringify("data_item_ids" in value ? value.data_item_ids : undefined)}`);
    }
    if (human) {
      const liveIds = new Set<string>([
        ...human.facts.map((f) => f.id),
        ...human.topics.map((t) => t.id),
        ...human.people.map((p) => p.id),
      ]);
      const staleIds = value.data_item_ids.filter((id) => !liveIds.has(id));
      if (staleIds.length > 0) {
        throw new Error(`Invalid relink: data_item_ids references entities that no longer exist: ${staleIds.join(", ")}`);
      }
    }
    return;
  }

  // quote.create / quote.fix — the full-record, verified shapes. Each
  // check below uses a literal `"field" in value` guard (not a loop over
  // QUOTE_FULL_RECORD_FIELDS) specifically so TypeScript's control-flow
  // analysis can narrow `value` field-by-field — narrowing does not apply
  // when the checked key name is a dynamic variable.
  if (!("verified" in value) || value.verified !== true) {
    throw new Error(`Malformed quote correction (${op}): verified must be exactly true, got ${JSON.stringify("verified" in value ? value.verified : undefined)}`);
  }
  if (!("text" in value) || typeof value.text !== "string" || value.text.length === 0) {
    throw new Error(`Malformed quote correction (${op}): text must be a non-empty string, got ${JSON.stringify("text" in value ? value.text : undefined)}`);
  }
  if (!("speaker" in value) || typeof value.speaker !== "string" || value.speaker.length === 0) {
    throw new Error(`Malformed quote correction (${op}): speaker must be a non-empty string, got ${JSON.stringify("speaker" in value ? value.speaker : undefined)}`);
  }
  if (!("channel" in value) || typeof value.channel !== "string" || value.channel.length === 0) {
    throw new Error(`Malformed quote correction (${op}): channel must be a non-empty string, got ${JSON.stringify("channel" in value ? value.channel : undefined)}`);
  }
  if (!("timestamp" in value) || typeof value.timestamp !== "string" || value.timestamp.length === 0) {
    throw new Error(`Malformed quote correction (${op}): timestamp must be a non-empty string, got ${JSON.stringify("timestamp" in value ? value.timestamp : undefined)}`);
  }
  if (!("created_at" in value) || typeof value.created_at !== "string" || value.created_at.length === 0) {
    throw new Error(`Malformed quote correction (${op}): created_at must be a non-empty string, got ${JSON.stringify("created_at" in value ? value.created_at : undefined)}`);
  }
  if (!("message_id" in value) || (value.message_id !== null && typeof value.message_id !== "string")) {
    throw new Error(`Malformed quote correction (${op}): message_id must be a string or null, got ${JSON.stringify("message_id" in value ? value.message_id : undefined)}`);
  }
  if (!("created_by" in value) || (value.created_by !== "extraction" && value.created_by !== "human")) {
    throw new Error(`Malformed quote correction (${op}): created_by must be "extraction" or "human", got ${JSON.stringify("created_by" in value ? value.created_by : undefined)}`);
  }
  if (!("start" in value) || (typeof value.start !== "number" && value.start !== null)) {
    throw new Error(`Malformed quote correction (${op}): start must be a number or null, got ${JSON.stringify("start" in value ? value.start : undefined)}`);
  }
  if (!("end" in value) || (typeof value.end !== "number" && value.end !== null)) {
    throw new Error(`Malformed quote correction (${op}): end must be a number or null, got ${JSON.stringify("end" in value ? value.end : undefined)}`);
  }
  if (!("embedding" in value) || !Array.isArray(value.embedding) || !value.embedding.every((n): n is number => typeof n === "number")) {
    throw new Error(`Malformed quote correction (${op}): embedding must be an array of numbers`);
  }
  if (!("data_item_ids" in value) || !Array.isArray(value.data_item_ids) || !value.data_item_ids.every((x): x is string => typeof x === "string")) {
    throw new Error(`Malformed quote correction (${op}): data_item_ids must be an array of strings, got ${JSON.stringify("data_item_ids" in value ? value.data_item_ids : undefined)}`);
  }
  if (!("persona_groups" in value) || !Array.isArray(value.persona_groups) || !value.persona_groups.every((x): x is string => typeof x === "string")) {
    throw new Error(`Malformed quote correction (${op}): persona_groups must be an array of strings, got ${JSON.stringify("persona_groups" in value ? value.persona_groups : undefined)}`);
  }
  if (op === "quote.create" && (value.data_item_ids.length > 0 || value.persona_groups.length > 0)) {
    throw new Error(`Malformed quote correction (create): data_item_ids and persona_groups must be empty on create — a freshly created quote has no links yet`);
  }
}

/**
 * Runtime shape validation for a CorrectionRecord read back from
 * corrections.json. The TypeScript union is compile-time only — every
 * record actually enters the system via `JSON.parse(...) as CorrectionRecord`
 * in readCorrections(), so a malformed-but-valid-JSON record (bad `op`,
 * mismatched `record.id`, missing `record` on an upsert) is otherwise
 * silently trusted. Both consumers (CLI read-merge/self-drain via
 * applyCorrectionToHuman, and Processor.applyCorrectionRecord) call this
 * before mutating anything — it throws, never coerces, so a malformed `op`
 * can never be silently treated as its sibling operation.
 *
 * A quote-domain record — `op` one of the four `quote.*` literals, or
 * `entity_type: "quote"` (see isQuoteCorrectionOp) — is checked first and
 * delegates entirely to assertValidQuoteCorrection (the quote-specific
 * grammar above). This is what rejects a pre-cutover `{op:"upsert",
 * entity_type:"quote", ...}` record (since "upsert" is not one of the
 * four `quote.*` ops), and also what catches a `quote.*` op carrying a
 * wrong or missing `entity_type` instead of letting it fall through to
 * generic validation (I2). Every other record falls through to the
 * original generic validation, byte-for-byte unchanged: this hardening is
 * quote-shape-specific, per design.
 *
 * `human`, when supplied, is threaded through to the quote-specific
 * validator for `quote.relink`'s state-aware liveness check; it's a no-op
 * for every other record shape.
 */
export function assertValidCorrection(value: unknown, human?: HumanEntity): asserts value is CorrectionRecord {
  if (!value || typeof value !== "object") {
    throw new Error(`Malformed correction record: expected an object, got ${JSON.stringify(value)}`);
  }

  if (isQuoteCorrectionOp(value)) {
    assertValidQuoteCorrection(value, human);
    return;
  }

  if (!("op" in value) || (value.op !== "upsert" && value.op !== "remove")) {
    throw new Error(`Malformed correction record: op must be "upsert" or "remove", got ${JSON.stringify("op" in value ? value.op : undefined)}`);
  }
  if (!("entity_type" in value) || !CORRECTABLE_TYPES.includes(value.entity_type as CorrectableType)) {
    throw new Error(`Malformed correction record: entity_type must be one of ${CORRECTABLE_TYPES.join(", ")}, got ${JSON.stringify("entity_type" in value ? value.entity_type : undefined)}`);
  }
  if (!("id" in value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`Malformed correction record: id must be a non-empty string, got ${JSON.stringify("id" in value ? value.id : undefined)}`);
  }
  if (value.op === "upsert") {
    if (!("record" in value) || !value.record || typeof value.record !== "object") {
      throw new Error(`Malformed correction record: upsert requires a record object`);
    }
    if (!("id" in value.record) || value.record.id !== value.id) {
      throw new Error(`Malformed correction record: record.id (${JSON.stringify("id" in value.record ? value.record.id : undefined)}) must equal wrapper id (${JSON.stringify(value.id)})`);
    }
  }
}

/**
 * Read pending corrections without a lock. Returns [] if the file doesn't
 * exist or is empty. fs/promises is imported dynamically, not statically —
 * this module is transitively bundled into Web's browser build via
 * src/core/processor.ts, and a static `import { readFile } from "fs/promises"`
 * fails Vite's rollup build (no named exports on the browser-externalized
 * stub), not just at runtime.
 */
export async function readCorrections(correctionsPath: string): Promise<CorrectionRecord[]> {
  const { readFile } = await import(/* @vite-ignore */ "fs/promises");
  let text: string;
  try {
    text = await readFile(correctionsPath, "utf-8");
  } catch {
    return [];
  }
  if (!text) return [];
  return JSON.parse(text) as CorrectionRecord[];
}

/**
 * Append one correction under lock (read-modify-write — corrections.json
 * is a JSON array, not an append-only log, so concurrent writers must
 * serialize through the same lock rather than racing on a blind append).
 */
export async function appendCorrection(
  correctionsPath: string,
  record: CorrectionRecord
): Promise<void> {
  await withLock(correctionsPath, async () => {
    const existing = await readCorrections(correctionsPath);
    existing.push(record);
    await atomicWrite(correctionsPath, JSON.stringify(existing, null, 2));
  });
}

/**
 * Merge a person's `name` from its primary identifier, replicating the
 * invariant HumanState.person_upsert enforces on the live-write path
 * (CONTRACTS.md "Person Identifiers — name Sync Rule"). Both consumers of
 * this module (Live's StateManager and the CLI's self-drain) must produce
 * an identical HumanEntity for a given corrections.json, so the formula
 * is centralized here rather than re-derived at each call site.
 */
function syncPersonName(person: Person): Person {
  const identifiers = person.identifiers ?? [];
  const primary = identifiers.find((i) => i.is_primary) ?? identifiers[0];
  return primary ? { ...person, name: primary.value } : person;
}

/**
 * Resolve the target array for a CorrectableType. Throws on anything
 * other than the 3 types routed through the generic upsert/remove path
 * (fact/topic/person) — "quote" is deliberately absent: every quote
 * correction is intercepted by applyCorrectionToHuman before reaching this
 * function (see below), so a "quote" entity_type can never actually arrive
 * here. corrections.json is external input from CLI/MCP tools (potentially
 * LLM-driven), and a malformed entity_type must never silently fall
 * through to the people array. Live's Processor already enforces this
 * (applyCorrectionRecord); this is the equivalent guard for the CLI
 * read-merge and self-drain paths.
 */
function getCorrectableArray(human: HumanEntity, entityType: string): Array<{ id: string }> {
  if (entityType === "fact") return human.facts;
  if (entityType === "topic") return human.topics;
  if (entityType === "person") return human.people;
  throw new Error(`Unrecognized correction entity_type: ${entityType}`);
}

/** Pure dispatch + skip result for one Quote-entity correction. See applyQuoteOperation. */
export interface QuoteOperationResult {
  quotes: Quote[];
  skipped?: QuoteCorrectionSkip;
}

/**
 * The one shared, pure dispatcher for every Quote correction, used by all
 * three consumers (live drain, self-drain, read overlay) instead of three
 * separate implementations. It never throws — an invalid record (wrong
 * shape, forbidden key, marker on a relink/remove, a stale relink target,
 * or a pre-cutover unmarked full-record correction) comes back as a
 * `skipped` result instead, so one bad queued record can never wedge every
 * other pending correction behind it.
 *
 * create applies as full-record placement — replace-by-id or insert,
 * exactly the effect of the old `quote_upsert` (src/core/state/human.ts),
 * which is legitimate here because create really does provide the whole
 * record for a quote the Wire Grammar itself requires to have no links
 * yet. fix is deliberately NOT full-record placement: its target id must
 * already exist (a missing target is a reported skip, never an insert —
 * only `quote.create` may insert), and its result is the CURRENT record
 * in `quotes` with only `text`/`start`/`end`/`embedding` overlaid from
 * the incoming record — `message_id`/`speaker`/`timestamp`/`channel`/
 * `created_at`/`created_by`/`data_item_ids`/`persona_groups` always come
 * from the record already in `quotes`, never from the incoming record, so
 * a fix queued before a concurrent relink/remove drains can never
 * resurrect a removed quote or replay a stale link/provenance field.
 * relink applies as a partial merge touching only `data_item_ids` — the
 * effect of `quote_update`, never a full-record placement. remove filters
 * the target out — the effect of `quote_remove`. relink/remove/fix never
 * call or duplicate the full-replacement `quote_upsert`.
 *
 * `record` is deliberately `unknown`, not `QuoteCorrectionRecord`: every
 * real caller is handing this function something that has only survived
 * `JSON.parse`, not validation, so accepting anything and validating
 * internally is what makes "never throws" an actual guarantee rather than
 * something each call site has to remember to wrap in a try/catch.
 * `human`, when supplied, enables `quote.relink`'s state-aware liveness
 * check (see assertValidQuoteCorrection).
 */
export function applyQuoteOperation(quotes: Quote[], record: unknown, human?: HumanEntity): QuoteOperationResult {
  if (!record || typeof record !== "object") {
    return { quotes, skipped: { record_id: "<unknown>", reason: `Malformed quote correction: expected an object, got ${JSON.stringify(record)}` } };
  }

  try {
    assertValidQuoteCorrection(record, human);
  } catch (err) {
    const recordId = "id" in record && typeof record.id === "string" ? record.id : "<unknown>";
    return { quotes, skipped: { record_id: recordId, reason: err instanceof Error ? err.message : String(err) } };
  }

  switch (record.op) {
    case "quote.create": {
      const { op, entity_type, verified, ...quote } = record;
      void op; void entity_type; void verified;
      const idx = quotes.findIndex((q) => q.id === quote.id);
      const nextQuotes = idx >= 0 ? quotes.map((q, i) => (i === idx ? quote : q)) : [...quotes, quote];
      return { quotes: nextQuotes };
    }
    case "quote.fix": {
      // C1: fix must never insert — only quote.create may. A target that
      // doesn't exist (e.g. removed by an earlier-applied correction in
      // the same batch, or in a concurrent batch that drained first) is a
      // reported skip, not a silent no-op and not a resurrection.
      const idx = quotes.findIndex((q) => q.id === record.id);
      if (idx < 0) {
        return {
          quotes,
          skipped: {
            record_id: record.id,
            reason: `Invalid fix: quote "${record.id}" does not exist — only quote.create may insert a new quote`,
          },
        };
      }
      // Only text/start/end/embedding come from the incoming wire record.
      // Every other field is taken from the CURRENT record already in
      // `quotes` at apply time, never from the (possibly stale) incoming
      // record — this is what stops a fix queued before a concurrent
      // relink/remove drains from replaying a link or provenance field
      // that no longer matches live state.
      const current = quotes[idx];
      const fixed: Quote = { ...current, text: record.text, start: record.start, end: record.end, embedding: record.embedding };
      return { quotes: quotes.map((q, i) => (i === idx ? fixed : q)) };
    }
    case "quote.relink": {
      const idx = quotes.findIndex((q) => q.id === record.id);
      if (idx < 0) return { quotes }; // target quote itself absent — silent no-op, mirroring quote_update's existing false-return-on-missing-id semantics
      const nextQuotes = quotes.map((q, i) => (i === idx ? { ...q, data_item_ids: record.data_item_ids } : q));
      return { quotes: nextQuotes };
    }
    case "quote.remove": {
      return { quotes: quotes.filter((q) => q.id !== record.id) };
    }
    default: {
      const unreachable: never = record;
      return { quotes, skipped: { record_id: "<unknown>", reason: `Unreachable quote operation: ${JSON.stringify(unreachable)}` } };
    }
  }
}

/**
 * Apply one correction to a HumanEntity in place, mirroring the exact
 * upsert/remove semantics of HumanState (src/core/state/human.ts) —
 * replace-by-id for upsert, splice + orphaned quote-reference cleanup for
 * remove (for all 3 types, matching fact_remove/topic_remove/person_remove
 * in HumanState — not just person). Used by both the CLI's read-merge
 * (materializing a corrected view without a StateManager) and its
 * self-drain (writing corrections straight into state.json when no live
 * instance is running).
 *
 * A quote-domain record (see isQuoteCorrectionOp — `op` one of the four
 * `quote.*` literals, or `entity_type: "quote"`) is intercepted before
 * any of the generic upsert/remove logic below and routed through
 * applyQuoteOperation instead, which never throws — a malformed quote
 * record, including a `quote.*` op with a wrong or missing `entity_type`
 * (I2), comes back as this function's return value (a skip descriptor)
 * rather than an exception, so a caller iterating a batch
 * (applyCorrectionsToHuman below) can skip just that one record and keep
 * applying the rest. Every other record keeps the original
 * throw-on-invalid behavior unchanged.
 */
export function applyCorrectionToHuman(human: HumanEntity, correction: CorrectionRecord): QuoteCorrectionSkip | void {
  if (isQuoteCorrectionOp(correction)) {
    const result = applyQuoteOperation(human.quotes, correction, human);
    if (result.skipped) return result.skipped;
    human.quotes = result.quotes;
    human.last_updated = new Date().toISOString();
    return;
  }

  assertValidCorrection(correction);
  const array = getCorrectableArray(human, correction.entity_type);

  if (correction.op === "remove") {
    const idx = array.findIndex((item) => item.id === correction.id);
    if (idx < 0) return;
    array.splice(idx, 1);
    human.quotes.forEach((q) => {
      q.data_item_ids = q.data_item_ids.filter((itemId) => itemId !== correction.id);
    });
    human.last_updated = new Date().toISOString();
    return;
  }

  const record = correction.entity_type === "person"
    ? syncPersonName(correction.record as Person)
    : correction.record;
  const idx = array.findIndex((item) => item.id === correction.id);
  if (idx >= 0) {
    array[idx] = record;
  } else {
    array.push(record);
  }
  human.last_updated = new Date().toISOString();
}

/** Apply every pending correction to a HumanEntity, in file order (later records for the same id win). Returns every skipped Quote record (wrong shape, forbidden key, stale relink target, etc.) — every other pending correction still applies, quote or not. */
export function applyCorrectionsToHuman(human: HumanEntity, corrections: CorrectionRecord[]): QuoteCorrectionSkip[] {
  const skipped: QuoteCorrectionSkip[] = [];
  for (const correction of corrections) {
    const result = applyCorrectionToHuman(human, correction);
    if (result) skipped.push(result);
  }
  return skipped;
}

/**
 * Apply one correction to a StorageState's personas map in place. Personas
 * live outside HumanEntity — src/core/types/integrations.ts's StorageState.personas
 * is a top-level `Record<id, {entity, messages}>` — so they need their own
 * apply function rather than routing through getCorrectableArray/
 * applyCorrectionToHuman, which only ever resolve arrays on HumanEntity.
 *
 * Only ever called for entity_type "persona" (see applyCorrectionToState),
 * hence the narrower CorrectionUpsert | CorrectionRemove parameter type —
 * a QuoteCorrectionRecord is never routed here.
 *
 * The reserved-persona delete guard here is defense-in-depth for a
 * hand-edited corrections.json: the primary guard is the SYNCHRONOUS check
 * in src/cli/persona-corrections.ts's removePersonaEntity, which runs
 * before a correction is ever queued (so a live-drained rejection here can
 * never surface as a silent no-op after an apparent CLI success).
 */
export function applyCorrectionToPersonas(personas: StorageState["personas"], correction: CorrectionUpsert | CorrectionRemove): void {
  assertValidCorrection(correction);
  if (correction.op === "remove") {
    if (isReservedPersonaId(correction.id)) {
      throw new Error(`Cannot delete reserved persona "${correction.id}". Use archive instead.`);
    }
    delete personas[correction.id];
    return;
  }
  personas[correction.id] = {
    entity: correction.record as PersonaEntity,
    messages: personas[correction.id]?.messages ?? [],
  };
}

/** Route one correction to its target: the personas map for entity_type "persona", the HumanEntity for everything else — except a quote-domain record (isQuoteCorrectionOp) always routes to the HumanEntity, since quotes live there, even if a malformed record's `entity_type` claims "persona". Returns a skip descriptor if a Quote correction was declined; personas/other entities still throw on malformed input, unchanged. */
export function applyCorrectionToState(state: StorageState, correction: CorrectionRecord): QuoteCorrectionSkip | void {
  if (!isQuoteCorrectionOp(correction) && correction.entity_type === "persona") {
    applyCorrectionToPersonas(state.personas, correction);
    return;
  }
  return applyCorrectionToHuman(state.human, correction);
}

/** Apply every pending correction to a StorageState, in file order (later records for the same id win). Returns every skipped Quote record — every other pending correction still applies. */
export function applyCorrectionsToState(state: StorageState, corrections: CorrectionRecord[]): QuoteCorrectionSkip[] {
  const skipped: QuoteCorrectionSkip[] = [];
  for (const correction of corrections) {
    const result = applyCorrectionToState(state, correction);
    if (result) skipped.push(result);
  }
  return skipped;
}
