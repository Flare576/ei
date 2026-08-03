import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyCorrectionToHuman, applyCorrectionsToHuman, applyCorrectionToPersonas, applyCorrectionToState, applyCorrectionsToState, assertValidCorrection, applyQuoteOperation } from "../../../src/core/corrections.js";
import { loadLatestState } from "../../../src/cli/retrieval.js";
import type { CorrectionRecord, QuoteCreateRecord, QuoteFixRecord, QuoteRelinkRecord, QuoteRemoveRecord } from "../../../src/core/corrections.js";
import type { Fact, Topic, Person, Quote, HumanEntity, StorageState, PersonaEntity, Message } from "../../../src/core/types.js";
import { RESERVED_PERSONA_IDS, ContextStatus } from "../../../src/core/types.js";

const NOW = "2026-01-01T00:00:00Z";
const EMBEDDING = [1, 2, 3];

function makeFact(id: string, overrides: Partial<Fact> = {}): Fact {
  return {
    id,
    name: `Fact ${id}`,
    description: `Description for ${id}`,
    sentiment: 0,
    validated_date: NOW,
    last_updated: NOW,
    embedding: EMBEDDING,
    ...overrides,
  };
}

function makeTopic(id: string, overrides: Partial<Topic> = {}): Topic {
  return {
    id,
    name: `Topic ${id}`,
    description: `Description for ${id}`,
    sentiment: 0,
    category: "Interest",
    exposure_current: 0,
    exposure_desired: 0,
    last_updated: NOW,
    embedding: EMBEDDING,
    ...overrides,
  };
}

function makePerson(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    name: `Person ${id}`,
    description: `Description for ${id}`,
    sentiment: 0,
    relationship: "friend",
    exposure_current: 0,
    exposure_desired: 0,
    last_updated: NOW,
    embedding: EMBEDDING,
    identifiers: [{ type: "Nickname", value: `Person ${id}`, is_primary: true }],
    ...overrides,
  };
}

function makeQuote(id: string, dataItemIds: string[]): Quote {
  return {
    id,
    message_id: null,
    data_item_ids: dataItemIds,
    persona_groups: [],
    text: `Quote ${id}`,
    speaker: "human",
    timestamp: NOW,
    start: null,
    end: null,
    created_at: NOW,
    created_by: "human",
    embedding: EMBEDDING,
  };
}

/** Builds a valid `quote.create` wire record: makeQuote's fields plus the create-only structural fields (op/entity_type/verified). data_item_ids/persona_groups default empty, matching create's own constraint. */
function makeQuoteCreateRecord(id: string, overrides: Partial<QuoteCreateRecord> = {}): QuoteCreateRecord {
  return { op: "quote.create", entity_type: "quote", attempt_id: `attempt-${id}`, ...makeQuote(id, []), channel: "Test Channel", verified: true, ...overrides };
}

/** Builds a valid `quote.fix` wire record. `dataItemIds` defaults to [] but, unlike create, fix does not require emptiness — pass the target's current links to simulate an endpoint that correctly preserves them. */
function makeQuoteFixRecord(id: string, dataItemIds: string[] = [], overrides: Partial<QuoteFixRecord> = {}): QuoteFixRecord {
  return { op: "quote.fix", entity_type: "quote", attempt_id: `attempt-${id}`, ...makeQuote(id, dataItemIds), channel: "Test Channel", verified: true, ...overrides };
}

/** Builds a valid `quote.relink` wire record — `{id, attempt_id, data_item_ids}` only, no provenance fields, no marker slot. */
function makeQuoteRelinkRecord(id: string, dataItemIds: string[]): QuoteRelinkRecord {
  return { op: "quote.relink", entity_type: "quote", id, attempt_id: `attempt-${id}`, data_item_ids: dataItemIds };
}

/** Builds a valid `quote.remove` wire record — `{id}` only. */
function makeQuoteRemoveRecord(id: string): QuoteRemoveRecord {
  return { op: "quote.remove", entity_type: "quote", id };
}

function makeHuman(overrides: Partial<HumanEntity> = {}): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: NOW,
    ...overrides,
  };
}

function makeState(human: HumanEntity): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human,
    personas: {},
    queue: [],
    providers: [],
    tools: [],
  };
}

function makePersonaEntity(id: string, overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id,
    display_name: `Persona ${id}`,
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: NOW,
    ...overrides,
  };
}

function makeMessage(id: string): Message {
  return {
    id,
    role: "human",
    content: `message ${id}`,
    timestamp: NOW,
    read: true,
    context_status: ContextStatus.Default,
  };
}

function makeStateWithPersonas(personas: StorageState["personas"]): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: makeHuman(),
    personas,
    queue: [],
    providers: [],
    tools: [],
  };
}

let tempDir: string | undefined;
let previousDataPath: string | undefined;
let originalBun: unknown;

function writeTempState(state: StorageState): string {
  tempDir = mkdtempSync(join(tmpdir(), "ei-corrections-test-"));
  writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
  process.env.EI_DATA_PATH = tempDir;
  return tempDir;
}

beforeEach(() => {
  previousDataPath = process.env.EI_DATA_PATH;
  originalBun = Reflect.get(globalThis, "Bun");
  Reflect.set(globalThis, "Bun", {
    file: (path: string) => ({
      exists: async () => existsSync(path),
      text: async () => readFileSync(path, "utf-8"),
    }),
  });
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }

  if (previousDataPath === undefined) {
    delete process.env.EI_DATA_PATH;
  } else {
    process.env.EI_DATA_PATH = previousDataPath;
  }

  if (originalBun === undefined) {
    Reflect.deleteProperty(globalThis, "Bun");
  } else {
    Reflect.set(globalThis, "Bun", originalBun);
  }
});

describe("applyCorrectionToHuman — quote cleanup on remove", () => {
  it("removing a fact also removes that fact id from every quote that referenced it", () => {
    const removedFact = makeFact("fact-remove");
    const keptFact = makeFact("fact-keep");
    const human = makeHuman({
      facts: [removedFact, keptFact],
      quotes: [
        makeQuote("quote-1", [removedFact.id, keptFact.id]),
        makeQuote("quote-2", [removedFact.id]),
        makeQuote("quote-3", ["unrelated-id"]),
      ],
    });

    applyCorrectionToHuman(human, {
      op: "remove",
      entity_type: "fact",
      id: removedFact.id,
      timestamp: NOW,
    });

    expect(human.facts.map((fact) => fact.id)).toEqual([keptFact.id]);
    expect(human.quotes.map((quote) => quote.data_item_ids)).toEqual([
      [keptFact.id],
      [],
      ["unrelated-id"],
    ]);
  });

  it("removing a topic also removes that topic id from every quote that referenced it", () => {
    const removedTopic = makeTopic("topic-remove");
    const keptTopic = makeTopic("topic-keep");
    const human = makeHuman({
      topics: [removedTopic, keptTopic],
      quotes: [
        makeQuote("quote-1", [removedTopic.id, keptTopic.id]),
        makeQuote("quote-2", [removedTopic.id]),
        makeQuote("quote-3", ["unrelated-id"]),
      ],
    });

    applyCorrectionToHuman(human, {
      op: "remove",
      entity_type: "topic",
      id: removedTopic.id,
      timestamp: NOW,
    });

    expect(human.topics.map((topic) => topic.id)).toEqual([keptTopic.id]);
    expect(human.quotes.map((quote) => quote.data_item_ids)).toEqual([
      [keptTopic.id],
      [],
      ["unrelated-id"],
    ]);
  });
});

describe("assertValidCorrection — runtime shape validation", () => {
  it("rejects an unrecognized op with a useful message", () => {
    expect(() =>
      assertValidCorrection({
        op: "not-a-real-op",
        entity_type: "fact",
        id: "fact-1",
        record: makeFact("fact-1"),
        timestamp: NOW,
      })
    ).toThrow(/op must be "upsert" or "remove".*not-a-real-op/);
  });

  it("rejects an upsert that is missing its record", () => {
    expect(() =>
      assertValidCorrection({
        op: "upsert",
        entity_type: "fact",
        id: "fact-1",
        timestamp: NOW,
      })
    ).toThrow(/upsert requires a record object/);
  });

  it("rejects an upsert whose record.id does not match the wrapper id", () => {
    expect(() =>
      assertValidCorrection({
        op: "upsert",
        entity_type: "fact",
        id: "fact-1",
        record: makeFact("fact-2"),
        timestamp: NOW,
      })
    ).toThrow(/record\.id \("fact-2"\) must equal wrapper id \("fact-1"\)/);
  });

  it.each([
    ["null", null],
    ["string", "not-an-object"],
    ["number", 42],
  ])("rejects an upsert whose record is a non-object %s", (_name, record) => {
    expect(() =>
      assertValidCorrection({
        op: "upsert",
        entity_type: "fact",
        id: "fact-1",
        record,
        timestamp: NOW,
      })
    ).toThrow(/upsert requires a record object/);
  });
});

describe("applyCorrectionToHuman — malformed op/record shape validation (C1)", () => {
  it("throws on an unrecognized op instead of silently treating it as an upsert", () => {
    const human = makeHuman({ facts: [makeFact("fact-1")] });

    expect(() =>
      applyCorrectionToHuman(human, {
        op: "not-a-real-op",
        entity_type: "fact",
        id: "fact-2",
        record: makeFact("fact-2"),
        timestamp: NOW,
      } as unknown as CorrectionRecord)
    ).toThrow();

    // fact-2 must never have been inserted — the throw must happen before mutation.
    expect(human.facts.map((f) => f.id)).toEqual(["fact-1"]);
  });

  it("throws when an upsert's record.id does not match the wrapper id", () => {
    const human = makeHuman({ facts: [] });

    expect(() =>
      applyCorrectionToHuman(human, {
        op: "upsert",
        entity_type: "fact",
        id: "fact-1",
        record: makeFact("a-different-id"),
        timestamp: NOW,
      })
    ).toThrow();

    expect(human.facts).toEqual([]);
  });

  it("throws when an upsert is missing its record", () => {
    const human = makeHuman({ facts: [] });

    expect(() =>
      applyCorrectionToHuman(human, {
        op: "upsert",
        entity_type: "fact",
        id: "fact-1",
        timestamp: NOW,
      } as unknown as CorrectionRecord)
    ).toThrow();
  });
});

describe("loadLatestState — malformed correction records", () => {
  it("rejects an unknown entity_type correction instead of silently inserting a person", async () => {
    const human = makeHuman({
      people: [makePerson("person-existing")],
    });
    const dir = writeTempState(makeState(human));

    writeFileSync(
      join(dir, "corrections.json"),
      JSON.stringify([
        {
          op: "upsert",
          entity_type: "not-a-real-type",
          id: "person-intruder",
          record: makePerson("person-intruder", {
            name: "Intruder",
            identifiers: [{ type: "Nickname", value: "Intruder", is_primary: true }],
          }),
          timestamp: NOW,
        },
      ])
    );

    await expect(loadLatestState()).rejects.toThrow();
  });

  it("rejects a correction with a malformed op instead of silently mutating facts", async () => {
    const human = makeHuman({ facts: [makeFact("fact-1")] });
    const dir = writeTempState(makeState(human));

    writeFileSync(
      join(dir, "corrections.json"),
      JSON.stringify([
        {
          op: "not-a-real-op",
          entity_type: "fact",
          id: "fact-2",
          record: makeFact("fact-2"),
          timestamp: NOW,
        },
      ])
    );

    await expect(loadLatestState()).rejects.toThrow();
  });
});

describe("applyCorrectionsToHuman — file order last-wins semantics", () => {
  it("lets a later upsert recreate the same fact after an earlier remove in the same batch", () => {
    const original = makeFact("fact-1", { description: "Original description" });
    const replacement = makeFact("fact-1", { description: "Replacement description" });
    const human = makeHuman({ facts: [original] });
    const corrections: CorrectionRecord[] = [
      {
        op: "remove",
        entity_type: "fact",
        id: original.id,
        timestamp: NOW,
      },
      {
        op: "upsert",
        entity_type: "fact",
        id: replacement.id,
        record: replacement,
        timestamp: NOW,
      },
    ];

    applyCorrectionsToHuman(human, corrections);

    expect(human.facts).toEqual([replacement]);
  });

  it("lets a later remove delete the same fact after an earlier upsert in the same batch", () => {
    const original = makeFact("fact-1", { description: "Original description" });
    const updated = makeFact("fact-1", { description: "Updated description" });
    const human = makeHuman({ facts: [original] });
    const corrections: CorrectionRecord[] = [
      {
        op: "upsert",
        entity_type: "fact",
        id: updated.id,
        record: updated,
        timestamp: NOW,
      },
      {
        op: "remove",
        entity_type: "fact",
        id: updated.id,
        timestamp: NOW,
      },
    ];

    applyCorrectionsToHuman(human, corrections);

    expect(human.facts).toEqual([]);
  });
});

describe("applyCorrectionToHuman — quote operations (Corrections Wire Grammar)", () => {
  it("quote.create inserts a new quote when no existing quote shares its id", () => {
    const existingQuote = makeQuote("quote-existing", ["fact-1"]);
    const human = makeHuman({ quotes: [existingQuote] });

    const result = applyCorrectionToHuman(human, makeQuoteCreateRecord("quote-new"));

    expect(result).toBeUndefined();
    expect(human.quotes.map((q) => q.id)).toEqual(["quote-existing", "quote-new"]);
    expect(human.quotes[1]).not.toHaveProperty("verified");
  });

  it("quote.fix replaces an existing quote in place by id, preserving array position", () => {
    const before = makeQuote("quote-1", ["merged-person"]);
    const other = makeQuote("quote-2", ["fact-2"]);
    const human = makeHuman({ quotes: [before, other] });

    const result = applyCorrectionToHuman(human, makeQuoteFixRecord("quote-1", ["merged-person"], { text: "Corrected text" }));

    expect(result).toBeUndefined();
    expect(human.quotes[0]).toMatchObject({ id: "quote-1", text: "Corrected text", data_item_ids: ["merged-person"] });
    expect(human.quotes[1]).toEqual(other);
  });

  it("quote.relink changes only data_item_ids, leaving every other field byte-identical (un-merge repoint)", () => {
    const before = makeQuote("quote-1", ["merged-person"]);
    const other = makeQuote("quote-2", ["fact-2"]);
    const human = makeHuman({ quotes: [before, other], people: [makePerson("split-person")] });

    const result = applyCorrectionToHuman(human, makeQuoteRelinkRecord("quote-1", ["split-person"]));

    expect(result).toBeUndefined();
    expect(human.quotes[0]).toEqual({ ...before, data_item_ids: ["split-person"] });
    expect(human.quotes[1]).toEqual(other);
  });

  it("quote.remove filters the target quote out, leaving others untouched", () => {
    const target = makeQuote("quote-1", []);
    const other = makeQuote("quote-2", []);
    const human = makeHuman({ quotes: [target, other] });

    const result = applyCorrectionToHuman(human, makeQuoteRemoveRecord("quote-1"));

    expect(result).toBeUndefined();
    expect(human.quotes).toEqual([other]);
  });

  it("bumps last_updated on a successful quote operation", () => {
    const human = makeHuman({ quotes: [], last_updated: "2020-01-01T00:00:00Z" });
    applyCorrectionToHuman(human, makeQuoteCreateRecord("quote-new"));
    expect(human.last_updated).not.toBe("2020-01-01T00:00:00Z");
  });

  it("returns a QuoteCorrectionSkip (never throws, never mutates) for a pre-cutover unmarked full-record quote correction", () => {
    const existing = makeQuote("quote-1", []);
    const human = makeHuman({ quotes: [existing] });
    const legacyRecord = {
      op: "upsert",
      entity_type: "quote",
      id: "quote-1",
      record: makeQuote("quote-1", ["forged-link"]),
      timestamp: NOW,
    } as unknown as CorrectionRecord;

    const result = applyCorrectionToHuman(human, legacyRecord);

    expect(result).toEqual({ record_id: "quote-1", reason: expect.stringContaining("quote.create") });
    expect(human.quotes).toEqual([existing]);
  });
});

describe("applyQuoteOperation — Corrections Wire Grammar dispatch (direct, no drain, no consumer)", () => {
  it("quote.create places a full verified record, inserted when its id is new", () => {
    const { quotes, skipped } = applyQuoteOperation([], makeQuoteCreateRecord("quote-1"));
    expect(skipped).toBeUndefined();
    expect(quotes).toEqual([{ ...makeQuote("quote-1", []), channel: "Test Channel" }]);
  });

  it("quote.fix places a full verified record, replacing by id", () => {
    const existing = makeQuote("quote-1", ["fact-1"]);
    const fixRecord = makeQuoteFixRecord("quote-1", ["fact-1"], { text: "Corrected text" });
    const { quotes, skipped } = applyQuoteOperation([existing], fixRecord);
    expect(skipped).toBeUndefined();
    expect(quotes).toHaveLength(1);
    expect(quotes[0].text).toBe("Corrected text");
    expect(quotes[0].data_item_ids).toEqual(["fact-1"]);
  });

  it("quote.relink changes only data_item_ids in its output — every other field byte-identical to the input", () => {
    const existing = makeQuote("quote-1", ["merged-person"]);
    const human = makeHuman({ people: [makePerson("split-person")] });
    const { quotes, skipped } = applyQuoteOperation([existing], makeQuoteRelinkRecord("quote-1", ["split-person"]), human);
    expect(skipped).toBeUndefined();
    expect(quotes).toEqual([{ ...existing, data_item_ids: ["split-person"] }]);
  });

  it("quote.remove filters only its own id out", () => {
    const target = makeQuote("quote-1", []);
    const other = makeQuote("quote-2", []);
    const { quotes, skipped } = applyQuoteOperation([target, other], makeQuoteRemoveRecord("quote-1"));
    expect(skipped).toBeUndefined();
    expect(quotes).toEqual([other]);
  });

  it("relink naming a quote id that does not exist is a reported skip, reversed from the old silent no-op (I2, round 3)", () => {
    const other = makeQuote("quote-2", []);
    const relinkRecord = makeQuoteRelinkRecord("quote-missing", ["fact-1"]);
    const { quotes, skipped } = applyQuoteOperation([other], relinkRecord);
    expect(quotes).toEqual([other]);
    expect(skipped?.record_id).toBe("quote-missing");
    expect(skipped?.reason).toContain("does not exist");
    // I2 round 3: the dispatcher echoes back the attempt_id of the
    // SKIPPED record itself, matching quote.fix's pre-existing pattern --
    // this is what lets relinkQuoteEntity recognize its own queued write
    // with certainty instead of inferring it from a final-state field
    // comparison (the retired QUOTE_IDENTITY_FIELDS projection).
    expect(skipped?.attempt_id).toBe(relinkRecord.attempt_id);
  });

  it("remove naming a quote id that does not exist is a silent no-op, not a skip", () => {
    const other = makeQuote("quote-2", []);
    const { quotes, skipped } = applyQuoteOperation([other], makeQuoteRemoveRecord("quote-missing"));
    expect(skipped).toBeUndefined();
    expect(quotes).toEqual([other]);
  });

  it("rejects a relink record with an extra text field outright, without mutating quotes", () => {
    const existing = makeQuote("quote-1", ["fact-1"]);
    const malformed = { ...makeQuoteRelinkRecord("quote-1", ["fact-2"]), text: "forged text" };
    const { quotes, skipped } = applyQuoteOperation([existing], malformed);
    expect(quotes).toEqual([existing]);
    expect(skipped).toEqual({ record_id: "quote-1", attempt_id: "attempt-quote-1", reason: expect.stringContaining("text") });
  });

  it("rejects a relink naming a non-existent entity id, given the current entity set", () => {
    const existing = makeQuote("quote-1", ["fact-1"]);
    const human = makeHuman({ facts: [makeFact("fact-1")] });
    const { quotes, skipped } = applyQuoteOperation([existing], makeQuoteRelinkRecord("quote-1", ["totally-made-up-id"]), human);
    expect(quotes).toEqual([existing]);
    expect(skipped?.record_id).toBe("quote-1");
    expect(skipped?.reason).toContain("totally-made-up-id");
  });

  it("rejects a relink whose target was valid at queue time but has since been deleted (the relink-target-deleted-mid-flight race)", () => {
    const existing = makeQuote("quote-1", ["fact-1"]);
    // The target existed when this record was constructed/queued, but the
    // HumanEntity passed here represents state AT APPLY TIME, after the
    // fact was removed -- the state-aware check must use this, not a
    // memory of what was valid earlier.
    const humanAtApplyTime = makeHuman({ facts: [] });
    const { quotes, skipped } = applyQuoteOperation([existing], makeQuoteRelinkRecord("quote-1", ["fact-now-deleted"]), humanAtApplyTime);
    expect(quotes).toEqual([existing]);
    expect(skipped?.reason).toContain("fact-now-deleted");
  });

  it("accepts a relink whose target ids resolve against topics and people, not only facts", () => {
    const existing = makeQuote("quote-1", []);
    const human = makeHuman({ topics: [makeTopic("topic-1")], people: [makePerson("person-1")] });
    const { quotes, skipped } = applyQuoteOperation([existing], makeQuoteRelinkRecord("quote-1", ["topic-1", "person-1"]), human);
    expect(skipped).toBeUndefined();
    expect(quotes[0].data_item_ids).toEqual(["topic-1", "person-1"]);
  });

  it("does not enforce the relink state-aware check when no human is supplied (shape-only validation)", () => {
    const existing = makeQuote("quote-1", []);
    const { quotes, skipped } = applyQuoteOperation([existing], makeQuoteRelinkRecord("quote-1", ["anything-goes-without-human"]));
    expect(skipped).toBeUndefined();
    expect(quotes[0].data_item_ids).toEqual(["anything-goes-without-human"]);
  });

  it("rejects a quote.create record missing attempt_id (I5, round 3)", () => {
    const record = makeQuoteCreateRecord("quote-1") as Record<string, unknown>;
    delete record.attempt_id;
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("attempt_id");
    expect(skipped?.attempt_id).toBeUndefined();
  });

  it("rejects a quote.fix record missing attempt_id (I5, round 3)", () => {
    const record = makeQuoteFixRecord("quote-1") as Record<string, unknown>;
    delete record.attempt_id;
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("attempt_id");
    expect(skipped?.attempt_id).toBeUndefined();
  });

  it("rejects a quote.create record with an empty-string attempt_id", () => {
    const record = { ...makeQuoteCreateRecord("quote-1"), attempt_id: "" };
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("attempt_id");
  });

  it("rejects a quote.relink record missing attempt_id (I2, round 3)", () => {
    const existing = makeQuote("quote-1", []);
    const record = makeQuoteRelinkRecord("quote-1", []) as Record<string, unknown>;
    delete record.attempt_id;
    const { quotes, skipped } = applyQuoteOperation([existing], record);
    expect(quotes).toEqual([existing]);
    expect(skipped?.reason).toContain("attempt_id");
    expect(skipped?.attempt_id).toBeUndefined();
  });

  it("rejects a quote.relink record with an empty-string attempt_id", () => {
    const existing = makeQuote("quote-1", []);
    const record = { ...makeQuoteRelinkRecord("quote-1", []), attempt_id: "" };
    const { quotes, skipped } = applyQuoteOperation([existing], record);
    expect(quotes).toEqual([existing]);
    expect(skipped?.reason).toContain("attempt_id");
  });

  it("quote.relink changes data_item_ids without leaking attempt_id onto the persisted Quote", () => {
    const existing = makeQuote("quote-1", []);
    const { quotes, skipped } = applyQuoteOperation([existing], makeQuoteRelinkRecord("quote-1", ["fact-1"]));
    expect(skipped).toBeUndefined();
    expect(quotes[0]).not.toHaveProperty("attempt_id");
    expect(quotes[0].data_item_ids).toEqual(["fact-1"]);
  });

  it("rejects an attempt_id carried on a quote.remove record — the field does not exist on this shape at all", () => {
    const existing = makeQuote("quote-1", []);
    const record = { ...makeQuoteRemoveRecord("quote-1"), attempt_id: "should-not-be-here" };
    const { quotes, skipped } = applyQuoteOperation([existing], record);
    expect(quotes).toEqual([existing]);
    expect(skipped?.reason).toContain("attempt_id");
  });

  it("quote.create places a full verified record without leaking attempt_id onto the persisted Quote", () => {
    const { quotes, skipped } = applyQuoteOperation([], makeQuoteCreateRecord("quote-attempt-check"));
    expect(skipped).toBeUndefined();
    expect(quotes[0]).not.toHaveProperty("attempt_id");
  });

  it("rejects a quote.create record missing verified", () => {
    const record = makeQuoteCreateRecord("quote-1") as Record<string, unknown>;
    delete record.verified;
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("verified");
  });

  it("rejects a quote.fix record missing verified", () => {
    const record = makeQuoteFixRecord("quote-1") as Record<string, unknown>;
    delete record.verified;
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("verified");
  });

  it("rejects a quote.create record with verified: false — the marker's mere presence is not enough", () => {
    const record = { ...makeQuoteCreateRecord("quote-1"), verified: false };
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("verified");
  });

  it("rejects a quote.fix record with verified: false — the marker's mere presence is not enough", () => {
    const record = { ...makeQuoteFixRecord("quote-1"), verified: false };
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("verified");
  });

  it("rejects a quote.relink record carrying verified, regardless of value", () => {
    const existing = makeQuote("quote-1", []);
    const record = { ...makeQuoteRelinkRecord("quote-1", []), verified: true };
    const { quotes, skipped } = applyQuoteOperation([existing], record);
    expect(quotes).toEqual([existing]);
    expect(skipped?.reason).toContain("verified");
  });

  it("rejects a quote.remove record carrying verified, regardless of value", () => {
    const existing = makeQuote("quote-1", []);
    const record = { ...makeQuoteRemoveRecord("quote-1"), verified: true };
    const { quotes, skipped } = applyQuoteOperation([existing], record);
    expect(quotes).toEqual([existing]);
    expect(skipped?.reason).toContain("verified");
  });

  it("rejects an otherwise well-formed quote.create record with one extra unrecognized key", () => {
    const record = { ...makeQuoteCreateRecord("quote-1"), unexpected_field: "should never be here" };
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("unexpected_field");
  });

  it("rejects an otherwise well-formed quote.fix record with one extra unrecognized key", () => {
    const record = { ...makeQuoteFixRecord("quote-1"), unexpected_field: "should never be here" };
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("unexpected_field");
  });

  it("rejects create with a non-empty data_item_ids — a freshly created quote has no links yet", () => {
    const record = makeQuoteCreateRecord("quote-1", { data_item_ids: ["fact-1"] });
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("empty on create");
  });

  it("rejects create with a non-empty persona_groups — a freshly created quote has no links yet", () => {
    const record = makeQuoteCreateRecord("quote-1", { persona_groups: ["group-1"] });
    const { quotes, skipped } = applyQuoteOperation([], record);
    expect(quotes).toEqual([]);
    expect(skipped?.reason).toContain("empty on create");
  });

  it("rejects a quote.fix whose target quote does not exist — fix must never insert, only quote.create may (C1)", () => {
    const fixRecord = makeQuoteFixRecord("quote-1", ["fact-1"], { persona_groups: ["group-a"], text: "corrected" });
    const { quotes, skipped } = applyQuoteOperation([], fixRecord);
    expect(quotes).toEqual([]);
    expect(skipped?.record_id).toBe("quote-1");
    expect(skipped?.reason).toContain("does not exist");
    expect(skipped?.reason).toContain("quote.create");
    // I5: the dispatcher echoes back the attempt_id of the SKIPPED record
    // itself — this is what lets fixQuoteEntity recognize its own queued
    // write with certainty instead of inferring it from final state.
    expect(skipped?.attempt_id).toBe(fixRecord.attempt_id);
  });

  it("a quote.fix never restores a data_item_ids/persona_groups link that an earlier-applied correction already cleared, even though the incoming record still carries the stale value (C1, T1 direct-dispatcher proof)", () => {
    // Simulates C1's trigger scenario at the pure-dispatcher level: this
    // fix record was constructed/queued while the quote still linked
    // "fact-removed", but by the time it applies, an earlier correction
    // in the same batch already stripped that link. The CURRENT record
    // (data_item_ids: []) must survive; the fix's own stale copy must not.
    const current = makeQuote("quote-1", []);
    const staleFixRecord = makeQuoteFixRecord("quote-1", ["fact-removed"], { persona_groups: ["stale-group"], text: "corrected text" });
    const { quotes, skipped } = applyQuoteOperation([current], staleFixRecord);
    expect(skipped).toBeUndefined();
    expect(quotes).toHaveLength(1);
    expect(quotes[0].data_item_ids).toEqual([]);
    expect(quotes[0].persona_groups).toEqual([]);
    expect(quotes[0].text).toBe("corrected text");
  });

  it("a quote.fix overlays only text/start/end/embedding — every other field always comes from the CURRENT record, even when the incoming record carries completely different values for all of them (C1, T7)", () => {
    const current: Quote = {
      id: "quote-1",
      message_id: "ei:current-message",
      data_item_ids: ["fact-current"],
      persona_groups: ["group-current"],
      text: "original text",
      speaker: "human",
      channel: "Current Channel",
      timestamp: "2020-01-01T00:00:00Z",
      start: null,
      end: null,
      created_at: "2019-01-01T00:00:00Z",
      created_by: "human",
      embedding: [9, 9, 9],
    };
    const forgedFixRecord: QuoteFixRecord = {
      op: "quote.fix",
      entity_type: "quote",
      id: "quote-1",
      attempt_id: "attempt-quote-1",
      message_id: "ei:forged-message",
      data_item_ids: ["fact-forged"],
      persona_groups: ["group-forged"],
      text: "corrected text",
      speaker: "forged-speaker",
      channel: "Forged Channel",
      timestamp: "2099-01-01T00:00:00Z",
      start: 3,
      end: 17,
      created_at: "2099-01-01T00:00:00Z",
      created_by: "extraction",
      embedding: [1, 1, 1],
      verified: true,
    };

    const { quotes, skipped } = applyQuoteOperation([current], forgedFixRecord);

    expect(skipped).toBeUndefined();
    expect(quotes).toEqual([{ ...current, text: "corrected text", start: 3, end: 17, embedding: [1, 1, 1] }]);
    // Every protected field is untouched — not merely "didn't change to
    // the forged value" but "still exactly the pre-fix value."
    expect(quotes[0].message_id).toBe("ei:current-message");
    expect(quotes[0].speaker).toBe("human");
    expect(quotes[0].channel).toBe("Current Channel");
    expect(quotes[0].timestamp).toBe("2020-01-01T00:00:00Z");
    expect(quotes[0].created_at).toBe("2019-01-01T00:00:00Z");
    expect(quotes[0].created_by).toBe("human");
    expect(quotes[0].data_item_ids).toEqual(["fact-current"]);
    expect(quotes[0].persona_groups).toEqual(["group-current"]);
  });

  it("rejects a pre-cutover unmarked full-record quote correction (generic upsert), without mutating quotes", () => {
    const existing = makeQuote("quote-1", []);
    const legacyRecord = { op: "upsert", entity_type: "quote", id: "quote-1", record: makeQuote("quote-1", ["forged"]), timestamp: NOW };
    const { quotes, skipped } = applyQuoteOperation([existing], legacyRecord);
    expect(quotes).toEqual([existing]);
    expect(skipped?.record_id).toBe("quote-1");
    expect(skipped?.reason).toContain("quote.create");
  });

  it("skips a non-object record without throwing", () => {
    const { quotes, skipped } = applyQuoteOperation([], null);
    expect(quotes).toEqual([]);
    expect(skipped).toBeDefined();
  });
});

describe("applyQuoteOperation — prototype-reserved keys bypass the strict allowlist (I1, T3)", () => {
  /**
   * Routes `record` through JSON.parse so a literal `__proto__` key
   * becomes a genuine own data property — exactly how a hand-edited or
   * externally-authored corrections.json record would arrive — rather
   * than the special prototype-reassignment behavior that object-literal
   * spread/assignment syntax triggers for that one key name instead
   * (which would silently reassign the object's prototype rather than
   * add an inspectable own key, and so would never reach this code path
   * for real input). `constructor`/`toString` have no such special
   * casing, but routing all three keys through the same helper keeps the
   * test uniform across the whole matrix.
   */
  function withPoisonKey(record: object, key: string): unknown {
    const json = JSON.stringify(record);
    return JSON.parse(`${json.slice(0, -1)},${JSON.stringify(key)}:"malicious"}`);
  }

  const poisonKeys = ["constructor", "toString", "__proto__"];
  const shapes: Array<[string, () => object]> = [
    ["quote.create", () => makeQuoteCreateRecord("quote-1")],
    ["quote.fix", () => makeQuoteFixRecord("quote-1", ["fact-1"])],
    ["quote.relink", () => makeQuoteRelinkRecord("quote-1", ["fact-1"])],
    ["quote.remove", () => makeQuoteRemoveRecord("quote-1")],
  ];

  for (const [opName, buildRecord] of shapes) {
    it.each(poisonKeys)(`rejects a ${opName} record carrying an extra own %s key, leaving quotes byte-identical`, (poisonKey) => {
      const existing = makeQuote("quote-1", ["fact-1"]);
      const poisoned = withPoisonKey(buildRecord(), poisonKey);

      const { quotes, skipped } = applyQuoteOperation([existing], poisoned);

      expect(quotes).toEqual([existing]);
      expect(skipped?.record_id).toBe("quote-1");
      expect(skipped?.reason).toContain(poisonKey);
    });
  }
});

describe("quote.* op routing regardless of entity_type (I2)", () => {
  it("assertValidCorrection routes a quote.relink with a missing entity_type to quote-specific validation instead of the generic op check", () => {
    expect(() =>
      assertValidCorrection({ op: "quote.relink", id: "quote-1", data_item_ids: [] })
    ).toThrow(/entity_type must be "quote"/);
  });

  it("assertValidCorrection routes a quote.relink with a wrong entity_type to quote-specific validation instead of the generic op check", () => {
    expect(() =>
      assertValidCorrection({ op: "quote.relink", entity_type: "fact", id: "quote-1", data_item_ids: [] })
    ).toThrow(/entity_type must be "quote"/);
  });

  it("applyQuoteOperation returns a skip (never throws) for a quote.relink with a missing entity_type", () => {
    const existing = makeQuote("quote-1", ["fact-1"]);
    const { quotes, skipped } = applyQuoteOperation([existing], { op: "quote.relink", id: "quote-1", data_item_ids: [] });
    expect(quotes).toEqual([existing]);
    expect(skipped?.record_id).toBe("quote-1");
    expect(skipped?.reason).toContain("entity_type");
  });

  it("applyCorrectionToHuman returns a skip (never throws) for a quote.relink with the wrong entity_type, leaving quotes untouched", () => {
    const existing = makeQuote("quote-1", ["fact-1"]);
    const human = makeHuman({ quotes: [existing] });
    const malformed = { op: "quote.relink", entity_type: "person", id: "quote-1", data_item_ids: [] } as unknown as CorrectionRecord;

    const result = applyCorrectionToHuman(human, malformed);

    expect(result).toEqual({ record_id: "quote-1", reason: expect.stringContaining("entity_type") });
    expect(human.quotes).toEqual([existing]);
  });

  it('a quote.* op still routes to quote handling even when entity_type claims "persona" — never reaches applyCorrectionToPersonas (I2)', () => {
    const existing = makeQuote("quote-1", ["fact-1"]);
    const state = makeState(makeHuman({ quotes: [existing] }));
    const malformed = { op: "quote.relink", entity_type: "persona", id: "quote-1", data_item_ids: [] } as unknown as CorrectionRecord;

    const result = applyCorrectionToState(state, malformed);

    expect(result).toEqual({ record_id: "quote-1", reason: expect.stringContaining("entity_type") });
    expect(state.human.quotes).toEqual([existing]);
    expect(state.personas).toEqual({});
  });

  it("T2: applyCorrectionsToHuman skips a quote.relink with a missing entity_type and still applies a later valid quote.remove and person upsert in the same batch, with no throw", () => {
    const survivingQuote = makeQuote("quote-keep", []);
    const removableQuote = makeQuote("quote-remove-me", []);
    const human = makeHuman({ quotes: [survivingQuote, removableQuote] });
    const goodPerson = makePerson("person-new");

    const corrections: CorrectionRecord[] = [
      { op: "quote.relink", id: "quote-keep", data_item_ids: ["anything"] } as unknown as CorrectionRecord,
      makeQuoteRemoveRecord("quote-remove-me"),
      { op: "upsert", entity_type: "person", id: goodPerson.id, record: goodPerson, timestamp: NOW },
    ];

    const skipped = applyCorrectionsToHuman(human, corrections);

    expect(skipped).toHaveLength(1);
    expect(skipped[0].record_id).toBe("quote-keep");
    expect(human.quotes.map((q) => q.id)).toEqual(["quote-keep"]);
    expect(human.people.find((p) => p.id === "person-new")).toBeDefined();
  });

  it("T2: applyCorrectionsToState skips a quote.relink with a wrong entity_type and still applies a later valid correction in the same batch, with no throw", () => {
    const survivingQuote = makeQuote("quote-keep", []);
    const state = makeState(makeHuman({ quotes: [survivingQuote] }));
    const goodFact = makeFact("fact-new");

    const corrections: CorrectionRecord[] = [
      { op: "quote.relink", entity_type: "fact", id: "quote-keep", data_item_ids: ["anything"] } as unknown as CorrectionRecord,
      { op: "upsert", entity_type: "fact", id: goodFact.id, record: goodFact, timestamp: NOW },
    ];

    const skipped = applyCorrectionsToState(state, corrections);

    expect(skipped).toHaveLength(1);
    expect(skipped[0].record_id).toBe("quote-keep");
    expect(state.human.quotes).toEqual([survivingQuote]);
    expect(state.human.facts.find((f) => f.id === "fact-new")).toBeDefined();
  });
});

describe("quote.* op routing regardless of entity_type — create/fix/remove (I6)", () => {
  /**
   * Mirrors "quote.* op routing regardless of entity_type (I2)" above,
   * which only ever exercised quote.relink across all four routing points.
   * isQuoteCorrectionOp recognizes all four quote.* literals independently
   * of entity_type (src/core/corrections.ts:175-178) — this closes the
   * coverage gap Beta's round-2 review flagged (I6): a regression that
   * narrowed the routing predicate back to relink-only (or to an
   * op-by-op allowlist missing one literal) would leave the I2 block
   * green while still breaking create/fix/remove.
   */
  function withMissingEntityType(record: object): Record<string, unknown> {
    const clone: Record<string, unknown> = { ...record };
    delete clone.entity_type;
    return clone;
  }

  const literalOps: Array<{ label: "quote.create" | "quote.fix" | "quote.remove"; buildValid: (id: string) => Record<string, unknown> }> = [
    { label: "quote.create", buildValid: (id) => makeQuoteCreateRecord(id) as unknown as Record<string, unknown> },
    // Fix's own text is deliberately distinguishable from makeQuote's default
    // `Quote ${id}` text: without this, a fix landing despite the entity_type
    // failure would be an undetectable no-op for a target built from the
    // same makeQuote(id, ...) helper, since text/start/end/embedding would
    // coincidentally already match.
    { label: "quote.fix", buildValid: (id) => makeQuoteFixRecord(id, [], { text: "MALFORMED FIX PAYLOAD — must never apply" }) as unknown as Record<string, unknown> },
    { label: "quote.remove", buildValid: (id) => makeQuoteRemoveRecord(id) as unknown as Record<string, unknown> },
  ];

  for (const { label, buildValid } of literalOps) {
    describe(label, () => {
      it(`assertValidCorrection routes a ${label} with a missing entity_type to quote-specific validation instead of the generic op check`, () => {
        const withoutType = withMissingEntityType(buildValid("quote-1"));
        expect(() => assertValidCorrection(withoutType)).toThrow(/entity_type must be "quote"/);
      });

      it(`assertValidCorrection routes a ${label} with a wrong entity_type to quote-specific validation instead of the generic op check`, () => {
        const wrongType = { ...buildValid("quote-1"), entity_type: "fact" };
        expect(() => assertValidCorrection(wrongType)).toThrow(/entity_type must be "quote"/);
      });

      it(`applyQuoteOperation returns a skip (never throws) for a ${label} with a missing entity_type`, () => {
        const existing = makeQuote("quote-1", ["fact-1"]);
        const withoutType = withMissingEntityType(buildValid("quote-1"));
        const { quotes, skipped } = applyQuoteOperation([existing], withoutType);
        expect(quotes).toEqual([existing]);
        expect(skipped?.record_id).toBe("quote-1");
        expect(skipped?.reason).toContain("entity_type");
      });

      it(`applyCorrectionToHuman returns a skip (never throws) for a ${label} with the wrong entity_type, leaving quotes untouched`, () => {
        const existing = makeQuote("quote-1", ["fact-1"]);
        const human = makeHuman({ quotes: [existing] });
        const malformed = { ...buildValid("quote-1"), entity_type: "person" } as unknown as CorrectionRecord;

        const result = applyCorrectionToHuman(human, malformed);

        expect(result).toEqual({ record_id: "quote-1", reason: expect.stringContaining("entity_type"), ...(label === "quote.remove" ? {} : { attempt_id: expect.any(String) }) });
        expect(human.quotes).toEqual([existing]);
      });

      it(`a ${label} still routes to quote handling even when entity_type claims "persona" — never reaches applyCorrectionToPersonas (I2/I6)`, () => {
        const existing = makeQuote("quote-1", ["fact-1"]);
        const state = makeState(makeHuman({ quotes: [existing] }));
        const malformed = { ...buildValid("quote-1"), entity_type: "persona" } as unknown as CorrectionRecord;

        const result = applyCorrectionToState(state, malformed);

        expect(result).toEqual({ record_id: "quote-1", reason: expect.stringContaining("entity_type"), ...(label === "quote.remove" ? {} : { attempt_id: expect.any(String) }) });
        expect(state.human.quotes).toEqual([existing]);
        expect(state.personas).toEqual({});
      });

      it(`T2: applyCorrectionsToHuman skips a ${label} with a missing entity_type and still applies a later valid correction in the same batch, with no throw`, () => {
        const survivingQuote = makeQuote("quote-keep", []);
        const human = makeHuman({ quotes: [survivingQuote] });
        const goodPerson = makePerson("person-new");
        const targetId = label === "quote.create" ? "quote-new" : "quote-keep";
        const malformed = withMissingEntityType(buildValid(targetId)) as unknown as CorrectionRecord;

        const corrections: CorrectionRecord[] = [
          malformed,
          { op: "upsert", entity_type: "person", id: goodPerson.id, record: goodPerson, timestamp: NOW },
        ];

        const skipped = applyCorrectionsToHuman(human, corrections);

        expect(skipped).toHaveLength(1);
        expect(skipped[0].record_id).toBe(targetId);
        expect(skipped[0].reason).toContain("entity_type");
        expect(human.quotes.map((q) => q.id)).toEqual(["quote-keep"]);
        expect(human.people.find((p) => p.id === "person-new")).toBeDefined();
      });

      it(`T2: applyCorrectionsToState skips a ${label} with a wrong entity_type and still applies a later valid correction in the same batch, with no throw`, () => {
        const survivingQuote = makeQuote("quote-keep", []);
        const state = makeState(makeHuman({ quotes: [survivingQuote] }));
        const goodFact = makeFact("fact-new");
        const targetId = label === "quote.create" ? "quote-new" : "quote-keep";
        const malformed = { ...buildValid(targetId), entity_type: "fact" } as unknown as CorrectionRecord;

        const corrections: CorrectionRecord[] = [
          malformed,
          { op: "upsert", entity_type: "fact", id: goodFact.id, record: goodFact, timestamp: NOW },
        ];

        const skipped = applyCorrectionsToState(state, corrections);

        expect(skipped).toHaveLength(1);
        expect(skipped[0].record_id).toBe(targetId);
        expect(skipped[0].reason).toContain("entity_type");
        expect(state.human.quotes).toEqual([survivingQuote]);
        expect(state.human.facts.find((f) => f.id === "fact-new")).toBeDefined();
      });
    });
  }
});

describe("applyCorrectionToPersonas — upsert/remove against StorageState.personas", () => {
  it("creates a persona entry with messages: [] on upsert into an empty personas map", () => {
    const personas: StorageState["personas"] = {};
    const entity = makePersonaEntity("persona-1");

    applyCorrectionToPersonas(personas, {
      op: "upsert",
      entity_type: "persona",
      id: entity.id,
      record: entity,
      timestamp: NOW,
    });

    expect(personas["persona-1"]).toEqual({ entity, messages: [] });
  });

  it("preserves the persona's existing messages array untouched while replacing entity wholesale on upsert", () => {
    const oldEntity = makePersonaEntity("persona-1", { display_name: "Old Name", aliases: ["Old Alias"] });
    const existingMessages = [makeMessage("m1"), makeMessage("m2")];
    const personas: StorageState["personas"] = {
      "persona-1": { entity: oldEntity, messages: existingMessages },
    };
    const newEntity = makePersonaEntity("persona-1", { display_name: "New Name" });

    applyCorrectionToPersonas(personas, {
      op: "upsert",
      entity_type: "persona",
      id: "persona-1",
      record: newEntity,
      timestamp: NOW,
    });

    expect(personas["persona-1"].messages).toBe(existingMessages);
    expect(personas["persona-1"].entity).toEqual(newEntity);
    expect(personas["persona-1"].entity).not.toHaveProperty("aliases");
  });

  it("deletes the persona map entry on remove", () => {
    const entity = makePersonaEntity("persona-1");
    const personas: StorageState["personas"] = {
      "persona-1": { entity, messages: [] },
    };

    applyCorrectionToPersonas(personas, {
      op: "remove",
      entity_type: "persona",
      id: "persona-1",
      timestamp: NOW,
    });

    expect(personas["persona-1"]).toBeUndefined();
  });

  it.each(RESERVED_PERSONA_IDS)(
    "throws the exact reserved-persona message and never deletes when removing reserved id %s (defense-in-depth)",
    (reservedId) => {
      const entity = makePersonaEntity(reservedId, { display_name: reservedId });
      const personas: StorageState["personas"] = {
        [reservedId]: { entity, messages: [] },
      };

      expect(() =>
        applyCorrectionToPersonas(personas, {
          op: "remove",
          entity_type: "persona",
          id: reservedId,
          timestamp: NOW,
        })
      ).toThrow(`Cannot delete reserved persona "${reservedId}". Use archive instead.`);

      expect(personas[reservedId]).toBeDefined();
    }
  );
});

describe("applyCorrectionToState — routing personas vs human", () => {
  it("routes a persona correction to the personas map, leaving the human entity untouched", () => {
    const state = makeStateWithPersonas({});
    const entity = makePersonaEntity("persona-1");

    applyCorrectionToState(state, {
      op: "upsert",
      entity_type: "persona",
      id: entity.id,
      record: entity,
      timestamp: NOW,
    });

    expect(state.personas["persona-1"]).toEqual({ entity, messages: [] });
    expect(state.human.facts).toEqual([]);
  });

  it("routes a fact correction to the human entity, leaving the personas map untouched", () => {
    const state = makeStateWithPersonas({});
    const fact = makeFact("fact-1");

    applyCorrectionToState(state, {
      op: "upsert",
      entity_type: "fact",
      id: fact.id,
      record: fact,
      timestamp: NOW,
    });

    expect(state.human.facts).toEqual([fact]);
    expect(state.personas).toEqual({});
  });
});

describe("applyCorrectionsToState — mixed-type batch in file order", () => {
  it("applies a persona upsert and a fact upsert from the same batch to their respective targets", () => {
    const state = makeStateWithPersonas({});
    const entity = makePersonaEntity("persona-1");
    const fact = makeFact("fact-1");

    applyCorrectionsToState(state, [
      { op: "upsert", entity_type: "persona", id: entity.id, record: entity, timestamp: NOW },
      { op: "upsert", entity_type: "fact", id: fact.id, record: fact, timestamp: NOW },
    ]);

    expect(state.personas["persona-1"]).toEqual({ entity, messages: [] });
    expect(state.human.facts).toEqual([fact]);
  });

  it("lets a later persona remove delete a persona upserted earlier in the same batch", () => {
    const state = makeStateWithPersonas({});
    const entity = makePersonaEntity("persona-1");

    applyCorrectionsToState(state, [
      { op: "upsert", entity_type: "persona", id: entity.id, record: entity, timestamp: NOW },
      { op: "remove", entity_type: "persona", id: entity.id, timestamp: NOW },
    ]);

    expect(state.personas["persona-1"]).toBeUndefined();
  });
});
