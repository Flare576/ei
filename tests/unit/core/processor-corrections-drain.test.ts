import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, Fact, Person, Quote } from "../../../src/core/types.js";
import type { CorrectionRecord } from "../../../src/core/corrections.js";
import { appendCorrection } from "../../../src/core/corrections.js";

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

  it("applies a Quote upsert then a Quote remove correction via human_quote_upsert/human_quote_remove", async () => {
    const correctionsPath = join(dataDir, "corrections.json");
    const quote = makeQuote();

    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "quote",
      id: quote.id,
      record: quote,
      timestamp: new Date().toISOString(),
    });

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    const applied = processor.getStateManager().getHuman().quotes.find((q) => q.id === "quote-1");
    expect(applied).toBeDefined();
    // Embedding must be reused verbatim — never recomputed in the drain path.
    expect(applied!.embedding).toEqual([0.4, 0.5, 0.6]);

    await appendCorrection(correctionsPath, {
      op: "remove",
      entity_type: "quote",
      id: "quote-1",
      timestamp: new Date().toISOString(),
    });
    await asDrainable(processor).drainCorrections();

    expect(processor.getStateManager().getHuman().quotes.find((q) => q.id === "quote-1")).toBeUndefined();
  });

  it("replaces an existing Quote's data_item_ids in place on a repoint upsert (un-merge repoint)", async () => {
    const correctionsPath = join(dataDir, "corrections.json");
    const originalQuote = makeQuote({ data_item_ids: ["merged-person"] });
    const repointedQuote = makeQuote({ data_item_ids: ["split-person"] });

    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "quote",
      id: originalQuote.id,
      record: originalQuote,
      timestamp: new Date().toISOString(),
    });

    processor = new Processor(mock.ei);
    await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
    await asDrainable(processor).drainCorrections();

    await appendCorrection(correctionsPath, {
      op: "upsert",
      entity_type: "quote",
      id: repointedQuote.id,
      record: repointedQuote,
      timestamp: new Date().toISOString(),
    });
    await asDrainable(processor).drainCorrections();

    const human = processor.getStateManager().getHuman();
    expect(human.quotes).toHaveLength(1);
    expect(human.quotes[0].data_item_ids).toEqual(["split-person"]);
  });
});
