import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StorageState } from "../../../src/core/types/integrations.js";
import type { CorrectionRecord } from "../../../src/core/corrections.js";
import type { Person } from "../../../src/core/types/data-items.js";


vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getEmbeddingService: () => ({
      embed: async () => new Array(384).fill(1),
    }),
    findTopK: (actual as any).findTopK,
  };
});

import { retrieve, retrieveBalanced, resolveLinkedItems, lookupById, retrievePersonas, retrievePersonasSemantic, mapPersona, loadLatestState } from "../../../src/cli/retrieval.js";

const EMBEDDING = new Array(384).fill(1);
const NOW = "2026-01-01T00:00:00Z";

function makeDataItems(type: string, count: number, extra: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${type}_${i}`,
    name: `Test ${type} ${i}`,
    description: `A test ${type}`,
    sentiment: 0.5,
    last_updated: NOW,
    learned_by: "ei",
    embedding: EMBEDDING,
    ...extra,
  }));
}

function makeQuotes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `quote_${i}`,
    text: `Test quote ${i}`,
    speaker: "human",
    timestamp: NOW,
    message_id: null,
    data_item_ids: [],
    persona_groups: [],
    start: null,
    end: null,
    created_at: NOW,
    created_by: "human",
    embedding: EMBEDDING,
  }));
}

function makePersonaEntities(count: number, namePrefix: string = "Persona", withEmbeddings = false) {
  return Array.from({ length: count }, (_, i) => ({
    id: `persona_${i}`,
    display_name: `${namePrefix} ${i}`,
    entity: "system",
    short_description: `A test persona ${i}`,
    long_description: `Base prompt for ${namePrefix} ${i}`,
    model: "Local LLM:test-model",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: NOW,
    ...(withEmbeddings ? { description_embedding: EMBEDDING } : {}),
  }));
}

function makePeople(count: number, identifiers: { type: string; value: string }[][] = []) {
  return Array.from({ length: count }, (_, i) => ({
    id: `person_${i}`,
    name: `Test person ${i}`,
    description: `A test person`,
    sentiment: 0.5,
    relationship: "friend",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: NOW,
    last_mentioned: NOW,
    learned_by: "ei",
    embedding: EMBEDDING,
    identifiers: identifiers[i] ?? [{ type: "Nickname", value: `person${i}` }],
  }));
}

function createTestState(counts: {
  facts?: number; traits?: number; people?: number; topics?: number; quotes?: number;
  personas?: number; personaNamePrefix?: string; personaWithEmbeddings?: boolean;
  peopleIdentifiers?: { type: string; value: string }[][];
}) {
  const personaEntities = makePersonaEntities(counts.personas ?? 0, counts.personaNamePrefix, counts.personaWithEmbeddings);
  const personasRecord: Record<string, unknown> = {};
  for (const entity of personaEntities) {
    personasRecord[entity.id] = { entity, messages: [] };
  }
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: makeDataItems("fact", counts.facts ?? 0, { validated_date: NOW }),
      traits: makeDataItems("trait", counts.traits ?? 0, { strength: 0.5 }),
      people: makePeople(counts.people ?? 0, counts.peopleIdentifiers),
      topics: makeDataItems("topic", counts.topics ?? 0, { category: "Interest", exposure_current: 0.5, exposure_desired: 0.5 }),
      quotes: makeQuotes(counts.quotes ?? 0),
      last_updated: NOW,
    },
    personas: personasRecord,
    queue: [],
  };
}

let tempDir: string;

function writeTestState(state: unknown) {
  tempDir = mkdtempSync(join(tmpdir(), "ei-cli-test-"));
  writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
  process.env.EI_DATA_PATH = tempDir;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined as any;
  }
  delete process.env.EI_DATA_PATH;
});

describe("retrieve (sub-commands)", () => {
  it("returns [] for empty items", async () => {
    expect(await retrieve([], "test")).toEqual([]);
  });

  it("returns [] for empty query", async () => {
    const items = makeDataItems("fact", 3, { validated_date: NOW });
    expect(await retrieve(items, "")).toEqual([]);
  });

  it("respects limit", async () => {
    const items = makeDataItems("fact", 10, { validated_date: NOW });
    const result = await retrieve(items, "test", 3);
    expect(result).toHaveLength(3);
  });

  it("returns all when fewer than limit", async () => {
    const items = makeDataItems("fact", 2, { validated_date: NOW });
    const result = await retrieve(items, "test", 10);
    expect(result).toHaveLength(2);
  });
});

describe("retrieveBalanced (global search)", () => {
  it("returns [] when no state file exists", async () => {
    process.env.EI_DATA_PATH = "/tmp/nonexistent-ei-path";
    expect(await retrieveBalanced("test")).toEqual([]);
  });

  it("returns [] when all types are empty", async () => {
    writeTestState(createTestState({}));
    expect(await retrieveBalanced("test")).toEqual([]);
  });

  it("includes type field on every result", async () => {
    writeTestState(createTestState({ facts: 2, traits: 2, quotes: 2 }));
    const result = await retrieveBalanced("test");
    const validTypes = ["quote", "fact", "person", "topic"];
    for (const r of result) {
      expect(r).toHaveProperty("type");
      expect(validTypes).toContain(r.type);
    }
  });

  it("returns 10 with at least 1 of each type", async () => {
    writeTestState(createTestState({ facts: 10, traits: 10, people: 10, topics: 10, quotes: 10 }));
    const result = await retrieveBalanced("test");
    expect(result).toHaveLength(10);
    const types = new Set(result.map(r => r.type));
    expect(types).toContain("quote");
    expect(types).toContain("fact");
    expect(types).toContain("person");
    expect(types).toContain("topic");
  });

  it("returns all 7 items when fewer than limit (traits excluded)", async () => {
    writeTestState(createTestState({ facts: 2, traits: 2, people: 2, topics: 2, quotes: 1 }));
    const result = await retrieveBalanced("test", 10);
    expect(result).toHaveLength(7);
  });

  it("respects -n limit", async () => {
    writeTestState(createTestState({ facts: 10, traits: 10, people: 10, topics: 10, quotes: 10 }));
    const result = await retrieveBalanced("test", 5);
    expect(result).toHaveLength(5);
  });
});

describe("resolveLinkedItems", () => {
  it("resolves items across fact, person, and topic collection types", () => {
    const state = createTestState({ facts: 2, traits: 2, people: 2, topics: 2 });
    const ids = ["fact_0", "person_0", "topic_1"];
    const result = resolveLinkedItems(ids, state as any);
    expect(result).toHaveLength(3);
    expect(result).toEqual(expect.arrayContaining([
      { id: "fact_0", name: "Test fact 0", type: "fact" },
      { id: "person_0", name: "Test person 0", type: "person" },
      { id: "topic_1", name: "Test topic 1", type: "topic" },
    ]));
  });

  it("returns [] for empty data_item_ids", () => {
    const state = createTestState({ facts: 2, topics: 2 });
    expect(resolveLinkedItems([], state as any)).toEqual([]);
  });

  it("ignores IDs that don't match any entity", () => {
    const state = createTestState({ facts: 1 });
    const result = resolveLinkedItems(["nonexistent_id"], state as any);
    expect(result).toEqual([]);
  });
});

describe("lookupById", () => {
  it("finds a fact by ID", async () => {
    writeTestState(createTestState({ facts: 3 }));
    const result = await lookupById("fact_1");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("fact");
    expect(result!.id).toBe("fact_1");
    expect(result!.name).toBe("Test fact 1");
  });

  it("finds a topic by ID", async () => {
    writeTestState(createTestState({ topics: 2 }));
    const result = await lookupById("topic_0");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("topic");
  });

  it("finds a quote by ID", async () => {
    writeTestState(createTestState({ quotes: 2 }));
    const result = await lookupById("quote_1");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("quote");
    expect(result!.text).toBe("Test quote 1");
  });

  it("strips embedding from result", async () => {
    writeTestState(createTestState({ facts: 1 }));
    const result = await lookupById("fact_0");
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("embedding");
  });

  it("returns null for nonexistent ID", async () => {
    writeTestState(createTestState({ facts: 1, topics: 1 }));
    const result = await lookupById("nonexistent_id");
    expect(result).toBeNull();
  });

  it("returns null when no state exists", async () => {
    process.env.EI_DATA_PATH = "/tmp/nonexistent-ei-path";
    const result = await lookupById("fact_0");
    expect(result).toBeNull();
  });
});

describe("lookupById — linked_quotes reverse lookup", () => {
  it("includes linked_quotes on a fact lookup", async () => {
    const state = createTestState({ facts: 1, quotes: 2 });
    // Only the first quote references the fact
    state.human.quotes[0].data_item_ids = ["fact_0"];
    writeTestState(state);
    const result = await lookupById("fact_0");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("linked_quotes");
    expect(result!.linked_quotes).toEqual([
      { id: "quote_0", text: "Test quote 0", speaker: "human", timestamp: NOW },
    ]);
  });

  it("includes linked_quotes on a topic lookup", async () => {
    const state = createTestState({ topics: 1, quotes: 1 });
    state.human.quotes[0].data_item_ids = ["topic_0"];
    writeTestState(state);
    const result = await lookupById("topic_0");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("linked_quotes");
    expect(result!.linked_quotes).toEqual([
      { id: "quote_0", text: "Test quote 0", speaker: "human", timestamp: NOW },
    ]);
  });

  it("includes linked_quotes on a person lookup", async () => {
    const state = createTestState({ people: 1, quotes: 1 });
    state.human.quotes[0].data_item_ids = ["person_0"];
    writeTestState(state);
    const result = await lookupById("person_0");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("linked_quotes");
    expect(result!.linked_quotes).toEqual([
      { id: "quote_0", text: "Test quote 0", speaker: "human", timestamp: NOW },
    ]);
  });

  it("returns linked_quotes: [] (not omitted) when nothing references the entity", async () => {
    const state = createTestState({ facts: 1, topics: 1, people: 1, quotes: 1 });
    // quote's data_item_ids stays empty — nothing references any of these entities
    writeTestState(state);
    for (const id of ["fact_0", "topic_0", "person_0"]) {
      const result = await lookupById(id);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("linked_quotes");
      expect(result!.linked_quotes).toEqual([]);
    }
  });

  it("does not attach linked_quotes to a quote lookup", async () => {
    const state = createTestState({ quotes: 2 });
    // Even if a quote's data_item_ids somehow pointed at another quote, lookups on
    // the quote itself never get a linked_quotes field — the field only describes
    // the fact/topic/person side of the linkage.
    state.human.quotes[1].data_item_ids = ["quote_0"];
    writeTestState(state);
    const result = await lookupById("quote_0");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("quote");
    expect(result).not.toHaveProperty("linked_quotes");
  });

  it("does not attach linked_quotes to a persona lookup", async () => {
    writeTestState(createTestState({ personas: 1 }));
    const result = await lookupById("persona_0");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("persona");
    expect(result).not.toHaveProperty("linked_quotes");
  });

  it("includes every quote when multiple reference the same entity", async () => {
    const state = createTestState({ people: 1, quotes: 3 });
    state.human.quotes[0].data_item_ids = ["person_0"];
    state.human.quotes[1].data_item_ids = ["person_0"];
    // quotes[2] references nothing
    writeTestState(state);
    const result = await lookupById("person_0");
    expect(result).not.toBeNull();
    expect(result!.linked_quotes).toHaveLength(2);
  });
});

describe("quote linked_items shape", () => {
  it("returns linked_items (not linked_topics) on quote results", async () => {
    const state = createTestState({ topics: 2, people: 1, quotes: 1 });
    // Wire up quote to reference a topic and a person
    state.human.quotes[0].data_item_ids = ["topic_0", "person_0"];
    writeTestState(state);
    const results = await retrieveBalanced("test");
    const quoteResult = results.find(r => r.type === "quote");
    expect(quoteResult).toBeDefined();
    expect(quoteResult).toHaveProperty("linked_items");
    expect(quoteResult).not.toHaveProperty("linked_topics");
    const items = (quoteResult as any).linked_items;
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveProperty("id");
    expect(items[0]).toHaveProperty("name");
    expect(items[0]).toHaveProperty("type");
  });
});

describe("retrievePersonas (string matching)", () => {
  it("returns [] when no query and not recent", () => {
    const state = createTestState({ personas: 3 });
    const result = retrievePersonas("", state as any, 10);
    expect(result).toEqual([]);
  });

  it("matches by display_name substring (case-insensitive)", () => {
    const state = createTestState({ personas: 3, personaNamePrefix: "MyBot" });
    const result = retrievePersonas("mybot", state as any, 10);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.display_name.toLowerCase().includes("mybot"))).toBe(true);
  });

  it("returns [] when query does not match any persona", () => {
    const state = createTestState({ personas: 2, personaNamePrefix: "Alpha" });
    const result = retrievePersonas("zzz-no-match", state as any, 10);
    expect(result).toEqual([]);
  });

  it("respects limit", () => {
    const state = createTestState({ personas: 5 });
    const result = retrievePersonas("Persona", state as any, 2);
    expect(result).toHaveLength(2);
  });

  it("returns all personas sorted by last_updated when recent && !query", () => {
    const state = createTestState({ personas: 3 });
    const result = retrievePersonas("", state as any, 10, { recent: true });
    expect(result).toHaveLength(3);
  });

  it("maps PersonaEntity fields correctly", () => {
    const state = createTestState({ personas: 1, personaNamePrefix: "Alpha" });
    const result = retrievePersonas("Alpha", state as any, 10);
    expect(result).toHaveLength(1);
    const r = result[0];
    expect(r.id).toBe("persona_0");
    expect(r.display_name).toBe("Alpha 0");
    expect(r.short_description).toBe("A test persona 0");
    expect(r.base_prompt).toBe("Base prompt for Alpha 0");
    expect(r.model).toBe("Local LLM:test-model");
    expect(Array.isArray(r.traits)).toBe(true);
    expect(Array.isArray(r.topics)).toBe(true);
  });
  it("returns [] when query is longer than but contains the persona name (reverse containment is handled by execute(), not here)", () => {
    // Contract: retrievePersonas() only checks display_name.includes(query).
    // The other direction — query.includes(display_name) — lives in execute().
    // This test pins that boundary so a future refactor doesn't accidentally
    // collapse both into one function.
    const state = createTestState({ personas: 1, personaNamePrefix: "Beta" });
    const result = retrievePersonas("Beta — QA Goddess", state as unknown as StorageState, 10);
    expect(result).toEqual([]);
  });
});

describe("person identifiers in retrieval results", () => {
  it("retrieveBalanced includes identifiers on person results", async () => {
    writeTestState(createTestState({
      people: 2,
      peopleIdentifiers: [
        [{ type: "GitHub", value: "flare576" }, { type: "Nickname", value: "Flare" }],
        [{ type: "Email", value: "test@example.com" }],
      ],
    }));
    const result = await retrieveBalanced("test");
    const personResults = result.filter(r => r.type === "person");
    expect(personResults.length).toBeGreaterThan(0);
    for (const p of personResults) {
      expect(p).toHaveProperty("identifiers");
      expect(Array.isArray((p as any).identifiers)).toBe(true);
    }
  });

  it("retrieveBalanced person identifiers contain type and value fields", async () => {
    writeTestState(createTestState({
      people: 1,
      peopleIdentifiers: [[{ type: "GitHub", value: "flare576" }]],
    }));
    const result = await retrieveBalanced("test");
    const person = result.find(r => r.type === "person") as any;
    expect(person).toBeDefined();
    expect(person.identifiers[0]).toMatchObject({ type: "GitHub", value: "flare576" });
  });

  it("lookupById includes identifiers on person result", async () => {
    writeTestState(createTestState({
      people: 1,
      peopleIdentifiers: [[{ type: "Discord", value: "flare#1234" }]],
    }));
    const result = await lookupById("person_0");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("person");
    expect(result!).toHaveProperty("identifiers");
    expect((result!.identifiers as any[])[0]).toMatchObject({ type: "Discord", value: "flare#1234" });
  });

  it("person with no identifiers returns empty array (not undefined)", async () => {
    const state = createTestState({ people: 1 });
    (state.human.people[0] as any).identifiers = undefined;
    writeTestState(state);
    const result = await retrieveBalanced("test");
    const person = result.find(r => r.type === "person") as any;
    expect(person).toBeDefined();
    expect(person.identifiers).toEqual([]);
  });
});

describe("retrieveBalanced with personas", () => {
  it("does not include personas in recent && !query path", async () => {
    writeTestState(createTestState({ facts: 2, personas: 2 }));
    const result = await retrieveBalanced("", 10, { recent: true });
    const personaResults = result.filter(r => r.type === "persona");
    expect(personaResults.length).toBe(0);
  });

  it("does not include personas in query path (use explicit personas subcommand instead)", async () => {
    writeTestState(createTestState({ facts: 2, personas: 2, personaNamePrefix: "SpecialBot" }));
    const result = await retrieveBalanced("SpecialBot", 10);
    const personaResults = result.filter(r => r.type === "persona");
    expect(personaResults.length).toBe(0);
  });
});

describe("lookupById — persona records", () => {
  it("finds a persona by ID", async () => {
    writeTestState(createTestState({ personas: 2, personaNamePrefix: "TestAgent" }));
    const result = await lookupById("persona_0");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("persona");
    expect(result!.id).toBe("persona_0");
    expect(result!.display_name).toBe("TestAgent 0");
  });

  it("strips description_embedding from persona result", async () => {
    writeTestState(createTestState({ personas: 1, personaWithEmbeddings: true }));
    const result = await lookupById("persona_0");
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("description_embedding");
    expect(result).not.toHaveProperty("embedding");
  });

  it("returns null for persona ID when no personas exist", async () => {
    writeTestState(createTestState({ facts: 1 }));
    const result = await lookupById("persona_0");
    expect(result).toBeNull();
  });
});

describe("retrievePersonasSemantic", () => {
  it("returns [] when no personas have embeddings", async () => {
    const state = createTestState({ personas: 3 });
    const queryVector = EMBEDDING;
    const result = await retrievePersonasSemantic(queryVector, state as any, 10);
    expect(result).toEqual([]);
  });

  it("returns matching personas when embeddings are present", async () => {
    const state = createTestState({ personas: 2, personaWithEmbeddings: true });
    const queryVector = EMBEDDING;
    const result = await retrievePersonasSemantic(queryVector, state as any, 10);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("display_name");
    expect(result[0]).toHaveProperty("traits");
    expect(result[0]).toHaveProperty("topics");
  });

  it("respects limit", async () => {
    const state = createTestState({ personas: 5, personaWithEmbeddings: true });
    const queryVector = EMBEDDING;
    const result = await retrievePersonasSemantic(queryVector, state as any, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("skips personas without embeddings", async () => {
    const state = createTestState({ personas: 3, personaWithEmbeddings: false });
    const queryVector = EMBEDDING;
    const result = await retrievePersonasSemantic(queryVector, state as any, 10);
    expect(result).toEqual([]);
  });
});

describe("loadLatestState — corrections merge", () => {
  it("applies a pending upsert correction to the loaded state's people before returning", async () => {
    writeTestState(createTestState({ people: 1 }));
    const correctedPerson: Person = {
      id: "person_0",
      name: "New Name",
      description: "A test person",
      sentiment: 0.5,
      relationship: "friend",
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: NOW,
      last_mentioned: NOW,
      learned_by: "ei",
      embedding: EMBEDDING,
      identifiers: [{ type: "Nickname", value: "New Name", is_primary: true }],
    };
    const correction: CorrectionRecord = {
      op: "upsert",
      entity_type: "person",
      id: "person_0",
      record: correctedPerson,
      timestamp: NOW,
    };
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([correction]));

    const state = await loadLatestState();
    expect(state).not.toBeNull();
    expect(state!.human.people).toHaveLength(1);
    expect(state!.human.people[0].name).toBe("New Name");
  });

  it("propagates an error when corrections.json is malformed instead of serving uncorrected state", async () => {
    writeTestState(createTestState({ people: 1 }));
    writeFileSync(join(tempDir, "corrections.json"), "{not valid json");

    await expect(loadLatestState()).rejects.toThrow();
  });

  it("does not delete or modify corrections.json on read", async () => {
    writeTestState(createTestState({ people: 1 }));
    const correction: CorrectionRecord = {
      op: "remove",
      entity_type: "person",
      id: "person_0",
      timestamp: NOW,
    };
    const correctionsPath = join(tempDir, "corrections.json");
    const raw = JSON.stringify([correction]);
    writeFileSync(correctionsPath, raw);

    const state = await loadLatestState();
    expect(state!.human.people).toHaveLength(0);
    expect(readFileSync(correctionsPath, "utf-8")).toBe(raw);
  });
});
