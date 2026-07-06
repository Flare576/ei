import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyCorrectionToHuman, applyCorrectionsToHuman, applyCorrectionToPersonas, applyCorrectionToState, applyCorrectionsToState, assertValidCorrection } from "../../../src/core/corrections.js";
import { loadLatestState } from "../../../src/cli/retrieval.js";
import type { CorrectionRecord } from "../../../src/core/corrections.js";
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

describe("applyCorrectionToHuman — quote upsert (insert vs replace-by-id)", () => {
  it("inserts a new quote when no existing quote shares its id", () => {
    const existingQuote = makeQuote("quote-existing", ["fact-1"]);
    const newQuote = makeQuote("quote-new", ["fact-2"]);
    const human = makeHuman({ quotes: [existingQuote] });

    applyCorrectionToHuman(human, {
      op: "upsert",
      entity_type: "quote",
      id: newQuote.id,
      record: newQuote,
      timestamp: NOW,
    });

    expect(human.quotes.map((q) => q.id)).toEqual([existingQuote.id, newQuote.id]);
    expect(human.quotes[1]).toEqual(newQuote);
  });

  it("replaces an existing quote in place by id, preserving array position (un-merge repoint)", () => {
    const before = makeQuote("quote-1", ["merged-person"]);
    const other = makeQuote("quote-2", ["fact-2"]);
    const after = makeQuote("quote-1", ["split-person"]);
    const human = makeHuman({ quotes: [before, other] });

    applyCorrectionToHuman(human, {
      op: "upsert",
      entity_type: "quote",
      id: after.id,
      record: after,
      timestamp: NOW,
    });

    expect(human.quotes).toEqual([after, other]);
  });
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
