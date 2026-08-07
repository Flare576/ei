import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, Fact, Person, Quote, PersonaEntity, Message } from "../../../src/core/types.js";
import { RESERVED_PERSONA_IDS } from "../../../src/core/types.js";
import type { CorrectionRecord, QuoteCreateRecord, QuoteFixRecord, QuoteRelinkRecord, QuoteRemoveRecord, QuoteCorrectionSkip } from "../../../src/core/corrections.js";
import { appendCorrection, applyCorrectionToPersonas } from "../../../src/core/corrections.js";

/**
 * Tests for Processor.drainCorrections() (private, invoked from the
 * runLoop's checkScheduledTasks tick every 100ms — see processor.ts).
 *
 * drainCorrections() reads corrections.json (written externally by
 * ei_create/ei_update/ei_remove through src/cli/corrections-writer.ts),
 * applies each record to the live StateManager, clears the file, and
 * fires onHumanUpdated(). It must tolerate malformed records without
 * wedging subsequent drains, and never recompute embeddings — it trusts
 * CorrectionRecord.record.embedding verbatim.
 *
 * These tests invoke drainCorrections() directly (via a narrow structural
 * cast) rather than waiting on the background runLoop tick, so the
 * assertions are deterministic instead of racing a 100ms interval. This
 * is safe even though start() also kicks off a real-time runLoop in the
 * background: drainCorrections() reads+applies+deletes corrections.json
 * inside a single withLock() call, so our explicit call and the loop's
 * own tick serialize through the same lock — whichever runs first does
 * the actual work, the other finds an empty file and no-ops. Either way,
 * by the time our awaited call resolves, the correction is guaranteed
 * applied.
 */

interface DrainableProcessor {
  drainCorrections(): Promise<void>;
}

function asDrainable(processor: Processor): DrainableProcessor {
  return processor as unknown as DrainableProcessor;
}

// Mock the handlers/orchestrators modules exactly like other processor
// tests do, so start() doesn't try to reach a real LLM.
vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {},
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(() => false),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
  queueReflectionDrain: vi.fn(),
  queueUserDedupRequest: vi.fn(),
  queueRoomCapture: vi.fn(),
  queuePersonaCapture: vi.fn(),
  checkAndQueueRoomExtraction: vi.fn(),
  queueTargetedPersonUpdate: vi.fn(),
  queueTargetedTopicUpdate: vi.fn(),
}));

interface MockStorage {
  isAvailable: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  moveToBackup: ReturnType<typeof vi.fn>;
  loadBackup: ReturnType<typeof vi.fn>;
  saveRollingBackup: ReturnType<typeof vi.fn>;
  getDataPath: () => string;
}

function createMockInterface(): { ei: Ei_Interface; humanUpdatedCount: number[] } {
  const humanUpdatedCount = [0];
  const ei: Ei_Interface = {
    onHumanUpdated: () => { humanUpdatedCount[0]++; },
  };
  return { ei, humanUpdatedCount };
}

function createMockStorage(dataPath: string): MockStorage {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
    saveRollingBackup: vi.fn().mockResolvedValue(undefined),
    getDataPath: () => dataPath,
  };
}

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "fact-1",
    name: "Test Fact",
    description: "A corrected description",
    sentiment: 0,
    validated_date: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    name: "Jane Doe",
    description: "",
    sentiment: 0,
    last_updated: new Date().toISOString(),
    identifiers: [{ type: "Nickname", value: "Jane Doe", is_primary: true }],
    relationship: "Friend",
    exposure_current: 0,
    exposure_desired: 0,
    ...overrides,
  };
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "quote-1",
    message_id: null,
    data_item_ids: ["person-1"],
    persona_groups: [],
    text: "Original quote text",
    speaker: "human",
    timestamp: new Date().toISOString(),
    start: null,
    end: null,
    created_at: new Date().toISOString(),
    created_by: "human",
    embedding: [0.4, 0.5, 0.6],
    ...overrides,
  };
}

/** Builds a valid `quote.create` wire record. `data_item_ids`/`persona_groups` default empty (create's own constraint) — override deliberately to test rejection. */
function makeQuoteCreateRecord(overrides: Partial<QuoteCreateRecord> = {}): QuoteCreateRecord {
  return { op: "quote.create", entity_type: "quote", attempt_id: crypto.randomUUID(), ...makeQuote({ data_item_ids: [], persona_groups: [] }), channel: "Test Channel", verified: true, ...overrides };
}

/** Builds a valid `quote.fix` wire record — unlike create, fix does not require empty data_item_ids/persona_groups (they carry forward from the existing record). */
function makeQuoteFixRecord(overrides: Partial<QuoteFixRecord> = {}): QuoteFixRecord {
  return { op: "quote.fix", entity_type: "quote", attempt_id: crypto.randomUUID(), ...makeQuote(), channel: "Test Channel", verified: true, ...overrides };
}

/** Builds a valid `quote.relink` wire record — `{id, attempt_id, data_item_ids}` only. */
function makeQuoteRelinkRecord(id: string, dataItemIds: string[]): QuoteRelinkRecord {
  return { op: "quote.relink", entity_type: "quote", id, attempt_id: crypto.randomUUID(), data_item_ids: dataItemIds };
}

/** Builds a valid `quote.remove` wire record — `{id}` only. */
function makeQuoteRemoveRecord(id: string): QuoteRemoveRecord {
  return { op: "quote.remove", entity_type: "quote", id };
}

// is_paused defaults to true: a freshly-added persona has no messages, so
// Processor's own background runLoop (which start() kicks off for real,
// alongside our explicit drainCorrections() calls below) would otherwise
// treat it as immediately overdue for a heartbeat and call persona_update
// on it out-of-band, corrupting the persona_add/persona_update spy counts
// these tests assert on. Paused personas are skipped by that check.
function makePersonaEntity(id: string, overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id,
    display_name: `Persona ${id}`,
    entity: "system",
    aliases: [`Persona ${id}`],
    traits: [],
    topics: [],
    is_paused: true,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

describe("Processor.drainCorrections() (live-side corrections drain)", () => {
  let dataDir: string;
  let processor: Processor;
  let storage: MockStorage;
  let mock: { ei: Ei_Interface; humanUpdatedCount: number[] };

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "ei-corrections-drain-"));
    mock = createMockInterface();
    storage = createMockStorage(dataDir);
  });

  afterEach(async () => {
    await processor.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("applies a pending Fact upsert correction, clears the file, and fires onHumanUpdated", async () => {
    const fact = makeFact();
    const correction: CorrectionRecord = {
      op: "upsert",
      entity_type: "fact",
      id: fact.id,
      record: fact,
      timestamp: new Date().toISOString(),
    };
    await appendCorrection(join(dataDir, "corrections.json"), correction);

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    const human = processor.getStateManager().getHuman();
    const applied = human.facts.find((f) => f.id === fact.id);
    expect(applied).toBeDefined();
    expect(applied!.description).toBe("A corrected description");
    // Embedding must be reused verbatim — never recomputed in the drain path.
    expect(applied!.embedding).toEqual([0.1, 0.2, 0.3]);

    const remaining = readFileSync(join(dataDir, "corrections.json"), "utf-8");
    expect(JSON.parse(remaining)).toEqual([]);

    expect(mock.humanUpdatedCount[0]).toBeGreaterThanOrEqual(1);
  });

  describe("Person upsert — persona-link cardinality guard (ADR-006/ADR-010, IRQ-4)", () => {
    const PERSONA_A = "11111111-1111-4111-8111-111111111111";
    const PERSONA_B = "22222222-2222-4222-8222-222222222222";

    it("a single queued correction introducing two Persona links at once: neither survives, and exactly one durable report reaches the ei persona thread", async () => {
      const person = makePerson({
        id: "person-guard-1",
        identifiers: [
          { type: "Ei Persona", value: PERSONA_A },
          { type: "Ei Persona", value: PERSONA_B },
          { type: "Nickname", value: "Jane Doe", is_primary: true },
        ],
      });
      const correction: CorrectionRecord = {
        op: "upsert",
        entity_type: "person",
        id: person.id,
        record: person,
        timestamp: new Date().toISOString(),
      };
      await appendCorrection(join(dataDir, "corrections.json"), correction);

      processor = new Processor(mock.ei);
      await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
      await asDrainable(processor).drainCorrections();

      const sm = processor.getStateManager();
      const applied = sm.getHuman().people.find((p) => p.id === person.id)!;
      // The write was not rejected as a whole — the Nickname persisted,
      // only the two colliding Persona links were dropped.
      expect(applied.identifiers).not.toContainEqual(expect.objectContaining({ type: "Ei Persona" }));
      expect(applied.identifiers).toContainEqual(expect.objectContaining({ type: "Nickname", value: "Jane Doe" }));

      // The caller was already told "queued" and is long gone by the time
      // this drain tick runs — the only way it learns of the refusal is
      // this async, durable report.
      // Bootstrap's own first-run welcome message also lands on "ei" —
      // isolate this guard's own report rather than assuming it's alone.
      const reports = sm.messages_get("ei").filter((m) => m.content?.includes(PERSONA_A));
      expect(reports).toHaveLength(1);
      expect(reports[0].role).toBe("system");
      expect(reports[0].context_status).toBe("always");
      expect(reports[0].content).toContain(PERSONA_B);
    });

    it("two independently-queued person corrections that would each pass their own pre-queue snapshot check still collide once the second is validated against the first's already-applied result", async () => {
      const first = makePerson({ id: "person-race-1", identifiers: [{ type: "Ei Persona", value: PERSONA_A }] });
      const second = makePerson({ id: "person-race-2", identifiers: [{ type: "Ei Persona", value: PERSONA_A }] });
      const correctionsPath = join(dataDir, "corrections.json");
      await appendCorrection(correctionsPath, {
        op: "upsert", entity_type: "person", id: first.id, record: first, timestamp: new Date().toISOString(),
      });
      await appendCorrection(correctionsPath, {
        op: "upsert", entity_type: "person", id: second.id, record: second, timestamp: new Date().toISOString(),
      });

      processor = new Processor(mock.ei);
      await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
      await asDrainable(processor).drainCorrections();

      const sm = processor.getStateManager();
      const firstApplied = sm.getHuman().people.find((p) => p.id === first.id)!;
      const secondApplied = sm.getHuman().people.find((p) => p.id === second.id)!;
      // The first write to actually apply wins the link; the guard is
      // authoritative against live state at drain time, not a pre-queue
      // snapshot both callers could have independently passed.
      expect(firstApplied.identifiers).toContainEqual({ type: "Ei Persona", value: PERSONA_A });
      expect(secondApplied.identifiers).not.toContainEqual(expect.objectContaining({ type: "Ei Persona" }));

      expect(sm.messages_get("ei").filter((m) => m.content?.includes(PERSONA_A))).toHaveLength(1);
    });
  });

  it("drops a malformed record (bad entity_type) with console.error but still applies valid records in the same batch", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const goodFact = makeFact({ id: "fact-good", name: "Good Fact" });
    const correctionsPath = join(dataDir, "corrections.json");
    const badRecord = {
      op: "upsert",
      entity_type: "not-a-real-type",
      id: "bad-1",
      record: {},
      timestamp: new Date().toISOString(),
    } as unknown as CorrectionRecord;

    await appendCorrection(correctionsPath, badRecord);
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "fact",
      id: goodFact.id,
      record: goodFact,
      timestamp: new Date().toISOString(),
    });

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    const human = processor.getStateManager().getHuman();
    expect(human.facts.find((f) => f.id === "fact-good")).toBeDefined();
    expect(human.facts.find((f) => f.id === "bad-1")).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    const remaining = readFileSync(correctionsPath, "utf-8");
    expect(JSON.parse(remaining)).toEqual([]);

    consoleErrorSpy.mockRestore();
  });

  it("drops a malformed record (bad op) with console.error, never treats it as its sibling operation, and still applies a valid record in the same batch", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const correctionsPath = join(dataDir, "corrections.json");
    const existingFact = makeFact({ id: "fact-existing" });
    const goodFact = makeFact({ id: "fact-good", name: "Good Fact" });
    // Bad op on an id that already exists as a fact — if the malformed op
    // were silently coerced to "remove" it would vanish, and if it were
    // coerced to "upsert" its description would be overwritten. It must do
    // neither, and it must not wedge the valid correction behind it.
    const badOpRecord = {
      op: "not-a-real-op",
      entity_type: "fact",
      id: "fact-existing",
      record: makeFact({
        id: "fact-existing",
        description: "Bad op must not update this description",
      }),
      timestamp: new Date().toISOString(),
    } as unknown as CorrectionRecord;

    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "fact",
      id: existingFact.id,
      record: existingFact,
      timestamp: new Date().toISOString(),
    });

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    await appendCorrection(correctionsPath, badOpRecord);
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "fact",
      id: goodFact.id,
      record: goodFact,
      timestamp: new Date().toISOString(),
    });
    await asDrainable(processor).drainCorrections();

    const human = processor.getStateManager().getHuman();
    const stillExisting = human.facts.find((f) => f.id === "fact-existing");
    expect(stillExisting).toBeDefined();
    expect(stillExisting!.description).toBe("A corrected description");
    expect(human.facts.find((f) => f.id === "fact-good")).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("drops a malformed upsert with mismatched record.id but still applies valid records in the same batch", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const correctionsPath = join(dataDir, "corrections.json");
    const goodFact = makeFact({ id: "fact-good", name: "Good Fact" });
    const mismatchedRecord = {
      op: "upsert",
      entity_type: "fact",
      id: "fact-wrapper",
      record: makeFact({ id: "fact-record" }),
      timestamp: new Date().toISOString(),
    } as unknown as CorrectionRecord;

    await appendCorrection(correctionsPath, mismatchedRecord);
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "fact",
      id: goodFact.id,
      record: goodFact,
      timestamp: new Date().toISOString(),
    });

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    const human = processor.getStateManager().getHuman();
    expect(human.facts.find((f) => f.id === "fact-wrapper")).toBeUndefined();
    expect(human.facts.find((f) => f.id === "fact-record")).toBeUndefined();
    expect(human.facts.find((f) => f.id === "fact-good")).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("does nothing when corrections.json is absent (cheap empty fast path, no onHumanUpdated)", async () => {
    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    expect(mock.humanUpdatedCount[0]).toBe(0);
  });

  it("applies a Person upsert then a Person remove correction via human_person_upsert/human_person_remove", async () => {
    const correctionsPath = join(dataDir, "corrections.json");
    const person = makePerson();

    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "person",
      id: person.id,
      record: person,
      timestamp: new Date().toISOString(),
    });

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    expect(processor.getStateManager().getHuman().people.find((p) => p.id === "person-1")).toBeDefined();

    await appendCorrection(correctionsPath, {
      op: "remove",
      entity_type: "person",
      id: "person-1",
      timestamp: new Date().toISOString(),
    });
    await asDrainable(processor).drainCorrections();

    expect(processor.getStateManager().getHuman().people.find((p) => p.id === "person-1")).toBeUndefined();
  });

  it("applies a quote.create correction via the live drain, then a quote.remove correction", async () => {
    const correctionsPath = join(dataDir, "corrections.json");
    const createRecord = makeQuoteCreateRecord();

    await appendCorrection(correctionsPath, createRecord);

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    const applied = processor.getStateManager().getHuman().quotes.find((q) => q.id === "quote-1");
    expect(applied).toBeDefined();
    // Embedding must be reused verbatim — never recomputed in the drain path.
    expect(applied!.embedding).toEqual([0.4, 0.5, 0.6]);
    // The wire-only verified marker must never leak onto the persisted Quote.
    expect(applied).not.toHaveProperty("verified");
    expect(applied).not.toHaveProperty("attempt_id");

    await appendCorrection(correctionsPath, makeQuoteRemoveRecord("quote-1"));
    await asDrainable(processor).drainCorrections();

    expect(processor.getStateManager().getHuman().quotes.find((q) => q.id === "quote-1")).toBeUndefined();
  });

  it("changes only data_item_ids via a quote.relink correction on the live drain (un-merge repoint), never routing through the full-replacement quote_upsert", async () => {
    const correctionsPath = join(dataDir, "corrections.json");
    const originalQuote = makeQuoteCreateRecord({ data_item_ids: [] });

    await appendCorrection(correctionsPath, originalQuote);

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    // The relink target must actually exist for the state-aware check to pass.
    sm.human_person_upsert(makePerson({ id: "split-person" }));
    await asDrainable(processor).drainCorrections();

    await appendCorrection(correctionsPath, makeQuoteRelinkRecord("quote-1", ["split-person"]));
    await asDrainable(processor).drainCorrections();

    const human = sm.getHuman();
    expect(human.quotes).toHaveLength(1);
    expect(human.quotes[0].data_item_ids).toEqual(["split-person"]);
    // Every other field survives byte-for-byte — a relink is a partial merge
    // (the effect of quote_update), never a full-replacement quote_upsert.
    expect(human.quotes[0].text).toBe(originalQuote.text);
    expect(human.quotes[0].created_at).toBe(originalQuote.created_at);
    expect(human.quotes[0].embedding).toEqual(originalQuote.embedding);
  });

  it("live drain: skips a pre-cutover unmarked full-record quote correction, applies a valid quote.remove and a valid person update in the same batch, and surfaces exactly one skip via getLastCorrectionSkips()", async () => {
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    sm.human_quote_add(makeQuote({ id: "quote-keep" }));
    sm.human_quote_add(makeQuote({ id: "quote-remove-me" }));

    const legacyForgedRecord = {
      op: "upsert",
      entity_type: "quote",
      id: "quote-forged",
      record: makeQuote({ id: "quote-forged", text: "forged text" }),
      timestamp: new Date().toISOString(),
    } as unknown as CorrectionRecord;
    const goodPerson = makePerson({ id: "person-new" });

    await appendCorrection(correctionsPath, legacyForgedRecord);
    await appendCorrection(correctionsPath, makeQuoteRemoveRecord("quote-remove-me"));
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: new Date().toISOString(),
    });

    await asDrainable(processor).drainCorrections();

    const skips: QuoteCorrectionSkip[] = processor.getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote-forged");

    const finalHuman = sm.getHuman();
    expect(finalHuman.quotes.find((q) => q.id === "quote-forged")).toBeUndefined();
    expect(finalHuman.quotes.find((q) => q.id === "quote-remove-me")).toBeUndefined();
    expect(finalHuman.quotes.find((q) => q.id === "quote-keep")).toBeDefined();
    expect(finalHuman.people.find((p) => p.id === "person-new")).toBeDefined();
  });

  it("live drain: getLastCorrectionSkips() echoes back the attempt_id of a quote.fix skipped for a missing target, letting a caller recognize its OWN queued write with certainty (I5, round 3)", async () => {
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);

    // No quote with id "quote-missing" exists -- this fix must be skipped,
    // never treated as an insert (only quote.create may insert).
    const fixRecord = makeQuoteFixRecord({ id: "quote-missing", attempt_id: "attempt-under-test" });
    await appendCorrection(correctionsPath, fixRecord);

    await asDrainable(processor).drainCorrections();

    const skips = processor.getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote-missing");
    expect(skips[0].attempt_id).toBe("attempt-under-test");
    expect(skips[0].reason).toContain("does not exist");
  });

  it("T1: live drain — a stale quote.fix does not recreate a quote removed earlier in the same batch, or restore a link an earlier fact removal already cleared, and getLastCorrectionSkips() plus a following valid correction still work (C1)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    sm.human_fact_upsert(makeFact({ id: "fact-linked" }));
    sm.human_quote_add(makeQuote({ id: "quote-linked", data_item_ids: ["fact-linked"] }));
    sm.human_quote_add(makeQuote({ id: "quote-doomed", data_item_ids: [] }));

    const staleFixForLinked = makeQuoteFixRecord({ id: "quote-linked", data_item_ids: ["fact-linked"], persona_groups: ["stale-group"], text: "stale corrected text" });
    const staleFixForDoomed = makeQuoteFixRecord({ id: "quote-doomed", text: "should never land" });
    const goodPerson = makePerson({ id: "person-new" });

    // File order matters: both removals land BEFORE the stale fixes that
    // target their now-gone quote/link, exactly like C1's trigger — a fix
    // queued while state was still valid, draining after a same-batch
    // correction invalidated it.
    await appendCorrection(correctionsPath, { op: "remove", entity_type: "fact", id: "fact-linked", timestamp: new Date().toISOString() });
    await appendCorrection(correctionsPath, makeQuoteRemoveRecord("quote-doomed"));
    await appendCorrection(correctionsPath, staleFixForLinked);
    await appendCorrection(correctionsPath, staleFixForDoomed);
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: new Date().toISOString(),
    });

    await asDrainable(processor).drainCorrections();

    const skips = processor.getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote-doomed");
    expect(consoleErrorSpy).toHaveBeenCalled();

    const human = sm.getHuman();
    // The removed quote was never recreated by the stale fix that targeted it.
    expect(human.quotes.find((q) => q.id === "quote-doomed")).toBeUndefined();
    // The surviving quote's fix applied its text change but did NOT restore
    // the link the fact removal already cleared -- data_item_ids/persona_groups
    // stay at their CURRENT (already-cleaned) values, never the fix's stale copy.
    const fixedQuote = human.quotes.find((q) => q.id === "quote-linked");
    expect(fixedQuote).toBeDefined();
    expect(fixedQuote!.text).toBe("stale corrected text");
    expect(fixedQuote!.data_item_ids).toEqual([]);
    expect(fixedQuote!.persona_groups).toEqual([]);
    // The following valid correction still applied.
    expect(human.people.find((p) => p.id === "person-new")).toBeDefined();

    consoleErrorSpy.mockRestore();
  });

  it("T2: live drain skips a quote.relink with a missing entity_type and still applies a later valid correction, reporting it via getLastCorrectionSkips() with no wedge (I2)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    sm.human_quote_add(makeQuote({ id: "quote-keep", data_item_ids: [] }));

    const malformedRelink = { op: "quote.relink", id: "quote-keep", data_item_ids: ["anything"] } as unknown as CorrectionRecord;
    const goodPerson = makePerson({ id: "person-new" });

    await appendCorrection(correctionsPath, malformedRelink);
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: new Date().toISOString(),
    });

    await asDrainable(processor).drainCorrections();

    const skips = processor.getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote-keep");
    expect(skips[0].reason).toContain("entity_type");
    expect(consoleErrorSpy).toHaveBeenCalled();

    const human = sm.getHuman();
    expect(human.quotes.find((q) => q.id === "quote-keep")?.data_item_ids).toEqual([]);
    expect(human.people.find((p) => p.id === "person-new")).toBeDefined();

    consoleErrorSpy.mockRestore();
  });

  it("T2: live drain skips a quote.create with a missing entity_type and still applies a later valid correction, reporting it via getLastCorrectionSkips() with no wedge (I6)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();

    const malformedCreate: Record<string, unknown> = { ...makeQuoteCreateRecord({ id: "quote-new" }) };
    delete malformedCreate.entity_type;
    const goodPerson = makePerson({ id: "person-new" });

    await appendCorrection(correctionsPath, malformedCreate as unknown as CorrectionRecord);
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: new Date().toISOString(),
    });

    await asDrainable(processor).drainCorrections();

    const skips = processor.getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote-new");
    expect(skips[0].reason).toContain("entity_type");
    expect(consoleErrorSpy).toHaveBeenCalled();

    const human = sm.getHuman();
    expect(human.quotes.find((q) => q.id === "quote-new")).toBeUndefined();
    expect(human.people.find((p) => p.id === "person-new")).toBeDefined();

    consoleErrorSpy.mockRestore();
  });

  it("T2: live drain skips a quote.fix with a missing entity_type and still applies a later valid correction, reporting it via getLastCorrectionSkips() with no wedge (I6)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    sm.human_quote_add(makeQuote({ id: "quote-keep", text: "Original quote text" }));

    const malformedFix: Record<string, unknown> = { ...makeQuoteFixRecord({ id: "quote-keep", text: "should never land" }) };
    delete malformedFix.entity_type;
    const goodPerson = makePerson({ id: "person-new" });

    await appendCorrection(correctionsPath, malformedFix as unknown as CorrectionRecord);
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: new Date().toISOString(),
    });

    await asDrainable(processor).drainCorrections();

    const skips = processor.getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote-keep");
    expect(skips[0].reason).toContain("entity_type");
    expect(consoleErrorSpy).toHaveBeenCalled();

    const human = sm.getHuman();
    expect(human.quotes.find((q) => q.id === "quote-keep")?.text).toBe("Original quote text");
    expect(human.people.find((p) => p.id === "person-new")).toBeDefined();

    consoleErrorSpy.mockRestore();
  });

  it("T2: live drain skips a quote.remove with a missing entity_type and still applies a later valid correction, reporting it via getLastCorrectionSkips() with no wedge (I6)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    sm.human_quote_add(makeQuote({ id: "quote-keep" }));

    const malformedRemove: Record<string, unknown> = { ...makeQuoteRemoveRecord("quote-keep") };
    delete malformedRemove.entity_type;
    const goodPerson = makePerson({ id: "person-new" });

    await appendCorrection(correctionsPath, malformedRemove as unknown as CorrectionRecord);
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: new Date().toISOString(),
    });

    await asDrainable(processor).drainCorrections();

    const skips = processor.getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote-keep");
    expect(skips[0].reason).toContain("entity_type");
    expect(consoleErrorSpy).toHaveBeenCalled();

    const human = sm.getHuman();
    expect(human.quotes.find((q) => q.id === "quote-keep")).toBeDefined();
    expect(human.people.find((p) => p.id === "person-new")).toBeDefined();

    consoleErrorSpy.mockRestore();
  });

  it("applies a pending Persona upsert for a new id via persona_add, not persona_update", async () => {
    const correctionsPath = join(dataDir, "corrections.json");
    const persona = makePersonaEntity("persona-new");

    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "persona",
      id: persona.id,
      record: persona,
      timestamp: new Date().toISOString(),
    });

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    const addSpy = vi.spyOn(sm, "persona_add");
    const updateSpy = vi.spyOn(sm, "persona_update");

    await asDrainable(processor).drainCorrections();

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(persona);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(sm.persona_getById("persona-new")).toEqual(persona);
  });

  it("applies a pending Persona upsert for an existing id via persona_replace with the full record, never persona_update, and drops fields absent from the record", async () => {
    const correctionsPath = join(dataDir, "corrections.json");
    const originalPersona = makePersonaEntity("persona-existing", {
      display_name: "Original Name",
      aliases: ["Original Alias"],
      group_primary: "OriginalGroup",
    });

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    sm.persona_add(originalPersona);

    // Explicitly override aliases to undefined and never set group_primary
    // at all -- both get stripped entirely by JSON.stringify when this
    // record round-trips through corrections.json, so the record the drain
    // actually reads back genuinely lacks these keys (not merely `undefined`
    // in a way a spread-merge could paper over). This makes a genuine
    // full-replace dispatch distinguishable from a diff/patch that would
    // only touch display_name, and means a regression back to a shallow
    // merge (persona_update) would leave the stale aliases/group_primary
    // behind instead of dropping them.
    const updatedPersona = makePersonaEntity("persona-existing", {
      display_name: "Updated Name",
      aliases: undefined,
    });

    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "persona",
      id: updatedPersona.id,
      record: updatedPersona,
      timestamp: new Date().toISOString(),
    });

    const addSpy = vi.spyOn(sm, "persona_add");
    const replaceSpy = vi.spyOn(sm, "persona_replace");
    const updateSpy = vi.spyOn(sm, "persona_update");

    await asDrainable(processor).drainCorrections();

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith("persona-existing", updatedPersona);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();

    const stored = sm.persona_getById("persona-existing")!;
    expect(stored.display_name).toBe("Updated Name");
    // The actual behavioral guarantee I2 protects: fields absent from the
    // incoming record must not survive from the prior stored entity.
    expect(stored.aliases).toBeUndefined();
    expect(stored.group_primary).toBeUndefined();
  });

  it("T2: live-drain (persona_replace) and self-drain (applyCorrectionToPersonas) produce equivalent final entities for the same upsert record, differing only in last_updated", async () => {
    const correctionsPath = join(dataDir, "corrections.json");
    const originalPersona = makePersonaEntity("persona-parity", {
      display_name: "Original Name",
      aliases: ["Original Alias"],
      long_description: "Original long description",
      description_embedding: [0.1, 0.2, 0.3],
      last_heartbeat: new Date().toISOString(),
      pending_update: {
        short_description: "pending short",
        long_description: "pending long",
        traits: [],
        topics: [],
        critique: "pending critique",
        created_at: new Date().toISOString(),
      },
    });

    // Omits aliases/long_description/description_embedding/pending_update/
    // last_heartbeat entirely (and drops undefined-valued aliases via the
    // JSON round trip on the live path) -- the same correction record must
    // mean the same thing on both the self-drain and live-drain paths.
    const updatedPersona = makePersonaEntity("persona-parity", {
      display_name: "Updated Name",
      aliases: undefined,
    });
    const correction: CorrectionRecord = {
      op: "upsert",
      entity_type: "persona",
      id: updatedPersona.id,
      record: updatedPersona,
      timestamp: new Date().toISOString(),
    };

    // Self-drain path: applyCorrectionToPersonas mutates a bare personas
    // map directly (src/core/corrections.ts), independent of any Processor.
    const selfDrainPersonas: Record<string, { entity: PersonaEntity; messages: Message[] }> = {
      [originalPersona.id]: { entity: originalPersona, messages: [] },
    };
    applyCorrectionToPersonas(selfDrainPersonas, correction);
    const selfDrainEntity = selfDrainPersonas[originalPersona.id].entity;

    // Live-drain path: Processor.drainCorrections() -> applyCorrectionRecord -> persona_replace.
    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    sm.persona_add(originalPersona);

    await appendCorrection(correctionsPath, correction);
    await asDrainable(processor).drainCorrections();

    const liveDrainEntity = sm.persona_getById(originalPersona.id)!;

    const { last_updated: selfLastUpdated, ...selfRest } = selfDrainEntity;
    const { last_updated: liveLastUpdated, ...liveRest } = liveDrainEntity;

    // Equivalent everywhere except the intentionally volatile last_updated
    // timestamp (self-drain reuses the record's own last_updated verbatim;
    // live-drain's persona_replace stamps a fresh one).
    expect(liveRest).toEqual(selfRest);
    expect(typeof selfLastUpdated).toBe("string");
    expect(typeof liveLastUpdated).toBe("string");

    // Both paths must have actually dropped the omitted fields, not merely
    // matched each other while both silently preserved stale data.
    expect(liveRest.aliases).toBeUndefined();
    expect(liveRest.long_description).toBeUndefined();
    expect(liveRest.description_embedding).toBeUndefined();
    expect(liveRest.pending_update).toBeUndefined();
    expect(liveRest.last_heartbeat).toBeUndefined();
  });

  it("T6: a queued persona upsert and a queued persona remove in the same drain batch are both correctly applied via persona_add/persona_replace and persona_delete", async () => {
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();

    // Seed a persona to be removed, and one to be upserted-in-place, so the
    // same drain batch exercises both add and remove for personas that
    // aren't the freshly-created new-id case already covered above.
    sm.persona_add(makePersonaEntity("persona-to-remove"));
    sm.persona_add(makePersonaEntity("persona-to-update", { display_name: "Before" }));

    const newPersona = makePersonaEntity("persona-brand-new");
    const updatedPersona = makePersonaEntity("persona-to-update", { display_name: "After" });

    await appendCorrection(correctionsPath, {
      op: "remove",
      entity_type: "persona",
      id: "persona-to-remove",
      timestamp: new Date().toISOString(),
    });
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "persona",
      id: newPersona.id,
      record: newPersona,
      timestamp: new Date().toISOString(),
    });
    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "persona",
      id: updatedPersona.id,
      record: updatedPersona,
      timestamp: new Date().toISOString(),
    });

    const addSpy = vi.spyOn(sm, "persona_add");
    const replaceSpy = vi.spyOn(sm, "persona_replace");
    const deleteSpy = vi.spyOn(sm, "persona_delete");

    await asDrainable(processor).drainCorrections();

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith("persona-to-remove");
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith(newPersona);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith("persona-to-update", updatedPersona);

    expect(sm.persona_getById("persona-to-remove")).toBeNull();
    expect(sm.persona_getById("persona-brand-new")).toEqual(newPersona);
    expect(sm.persona_getById("persona-to-update")!.display_name).toBe("After");

    const remaining = readFileSync(correctionsPath, "utf-8");
    expect(JSON.parse(remaining)).toEqual([]);
  });

  it.each(RESERVED_PERSONA_IDS)(
    "drops a Persona remove correction for reserved id %s via console.error, never calling persona_delete, and leaves it in state",
    async (reservedId) => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const correctionsPath = join(dataDir, "corrections.json");

      processor = new Processor(mock.ei);
      await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
      const sm = processor.getStateManager();

      // "ei" already exists from bootstrapFirstRun; "emmet" only gets
      // created lazily via bootstrapEmmett(), so seed it here to exercise a
      // real delete attempt against a live record rather than an absent key.
      if (!sm.persona_getById(reservedId)) {
        sm.persona_add(makePersonaEntity(reservedId, { display_name: reservedId }));
      }

      const deleteSpy = vi.spyOn(sm, "persona_delete");

      await appendCorrection(correctionsPath, {
        op: "remove",
        entity_type: "persona",
        id: reservedId,
        timestamp: new Date().toISOString(),
      });

      await asDrainable(processor).drainCorrections();

      expect(deleteSpy).toHaveBeenCalledTimes(0);
      expect(sm.persona_getById(reservedId)).not.toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
      const matchingCall = consoleErrorSpy.mock.calls.find(
        (call) =>
          call[2] instanceof Error &&
          (call[2] as Error).message === `Cannot delete reserved persona "${reservedId}". Use archive instead.`
      );
      expect(matchingCall).toBeDefined();

      const remaining = readFileSync(correctionsPath, "utf-8");
      expect(JSON.parse(remaining)).toEqual([]);

      consoleErrorSpy.mockRestore();
    }
  );

  it("applies a Persona remove for a non-reserved id via persona_delete", async () => {
    const correctionsPath = join(dataDir, "corrections.json");

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    const sm = processor.getStateManager();
    sm.persona_add(makePersonaEntity("persona-removable"));

    const deleteSpy = vi.spyOn(sm, "persona_delete");

    await appendCorrection(correctionsPath, {
      op: "remove",
      entity_type: "persona",
      id: "persona-removable",
      timestamp: new Date().toISOString(),
    });
    await asDrainable(processor).drainCorrections();

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith("persona-removable");
    expect(sm.persona_getById("persona-removable")).toBeNull();
  });
});
