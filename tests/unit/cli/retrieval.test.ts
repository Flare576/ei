import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StorageState } from "../../../src/core/types/integrations.js";
import type { CorrectionRecord, QuoteCreateRecord, QuoteFixRecord, QuoteRelinkRecord, QuoteRemoveRecord } from "../../../src/core/corrections.js";
import type { Person, Fact, Quote } from "../../../src/core/types/data-items.js";
import type { PersonaEntity } from "../../../src/core/types/entities.js";
import type { ToolProvider, ToolDefinition } from "../../../src/core/types/integrations.js";


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

import { retrieve, retrieveBalanced, resolveLinkedItems, lookupById, lookupByIdentifier, retrievePersonas, retrievePersonasSemantic, mapPersona, loadLatestState, getLastCorrectionSkips } from "../../../src/cli/retrieval.js";

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

/** Builds a valid `quote.create` wire record. `data_item_ids`/`persona_groups` default empty, matching create's own constraint. */
function makeQuoteCreateRecord(id: string, overrides: Partial<QuoteCreateRecord> = {}): QuoteCreateRecord {
  return {
    op: "quote.create",
    entity_type: "quote",
    id,
    attempt_id: `attempt-${id}`,
    text: `Test quote ${id}`,
    speaker: "human",
    channel: "Test Channel",
    timestamp: NOW,
    message_id: null,
    data_item_ids: [],
    persona_groups: [],
    start: null,
    end: null,
    created_at: NOW,
    created_by: "human",
    embedding: EMBEDDING,
    verified: true,
    ...overrides,
  };
}

/** Builds a valid `quote.fix` wire record. `data_item_ids`/`persona_groups` default empty — override to simulate an endpoint that correctly preserves the target's current links. */
function makeQuoteFixRecord(id: string, overrides: Partial<QuoteFixRecord> = {}): QuoteFixRecord {
  return {
    op: "quote.fix",
    entity_type: "quote",
    id,
    attempt_id: `attempt-${id}`,
    text: `Test quote ${id}`,
    speaker: "human",
    channel: "Test Channel",
    timestamp: NOW,
    message_id: null,
    data_item_ids: [],
    persona_groups: [],
    start: null,
    end: null,
    created_at: NOW,
    created_by: "human",
    embedding: EMBEDDING,
    verified: true,
    ...overrides,
  };
}

/** Builds a valid `quote.relink` wire record — `{id, attempt_id, data_item_ids}` only. */
function makeQuoteRelinkRecord(id: string, dataItemIds: string[]): QuoteRelinkRecord {
  return { op: "quote.relink", entity_type: "quote", id, attempt_id: `attempt-${id}`, data_item_ids: dataItemIds };
}

/** Builds a valid `quote.remove` wire record — `{id}` only. */
function makeQuoteRemoveRecord(id: string): QuoteRemoveRecord {
  return { op: "quote.remove", entity_type: "quote", id };
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

describe("lookupByIdentifier", () => {
  it("finds a person by exact type+value match and returns the exact same enriched shape lookupById gives", async () => {
    const state = createTestState({
      people: 1,
      peopleIdentifiers: [[{ type: "GitHub", value: "flare576" }]],
      quotes: 1,
    });
    // Point the quote at the person so linked_quotes enrichment is exercised —
    // proves the delegation to lookupById carries full enrichment, not just the raw record.
    state.human.quotes[0].data_item_ids = ["person_0"];
    writeTestState(state);

    const byId = await lookupById("person_0");
    const byIdentifier = await lookupByIdentifier("GitHub", "flare576");

    expect(byIdentifier).not.toBeNull();
    expect(byIdentifier).toEqual(byId);
  });

  it("matches type case-insensitively", async () => {
    writeTestState(createTestState({
      people: 1,
      peopleIdentifiers: [[{ type: "Ei Persona", value: "yoda-persona-id" }]],
    }));
    const result = await lookupByIdentifier("ei persona", "yoda-persona-id");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("person_0");
  });

  it("keeps value matching exact/case-sensitive — a near-miss value returns not found", async () => {
    writeTestState(createTestState({
      people: 1,
      peopleIdentifiers: [[{ type: "GitHub", value: "flare576" }]],
    }));
    expect(await lookupByIdentifier("GitHub", "Flare576")).toBeNull();
    expect(await lookupByIdentifier("GitHub", "flare57")).toBeNull();
  });

  it("returns null when no person has a matching identifier", async () => {
    writeTestState(createTestState({
      people: 1,
      peopleIdentifiers: [[{ type: "GitHub", value: "flare576" }]],
    }));
    expect(await lookupByIdentifier("GitHub", "someone-else")).toBeNull();
  });

  it("returns null when no state exists", async () => {
    process.env.EI_DATA_PATH = "/tmp/nonexistent-ei-path-identifier-lookup";
    expect(await lookupByIdentifier("GitHub", "flare576")).toBeNull();
  });

  it("matches on any one of a person's multiple identifiers", async () => {
    writeTestState(createTestState({
      people: 1,
      peopleIdentifiers: [[
        { type: "GitHub", value: "flare576" },
        { type: "Email", value: "flare@example.com" },
        { type: "Nickname", value: "Flare" },
      ]],
    }));
    expect((await lookupByIdentifier("GitHub", "flare576"))!.id).toBe("person_0");
    expect((await lookupByIdentifier("Email", "flare@example.com"))!.id).toBe("person_0");
    expect((await lookupByIdentifier("Nickname", "Flare"))!.id).toBe("person_0");
  });

  it("finds the correct person among several by their unique identifier", async () => {
    writeTestState(createTestState({
      people: 3,
      peopleIdentifiers: [
        [{ type: "GitHub", value: "alice-gh" }],
        [{ type: "GitHub", value: "bob-gh" }],
        [{ type: "GitHub", value: "carol-gh" }],
      ],
    }));
    const result = await lookupByIdentifier("GitHub", "bob-gh");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("person_1");
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

  it("covers exactly quote/fact/person/topic and never persona, even on an exact persona-name query (non-recent path)", async () => {
    writeTestState(createTestState({ facts: 2, people: 2, topics: 2, quotes: 2, personas: 2, personaNamePrefix: "ExactMatchName" }));
    const result = await retrieveBalanced("ExactMatchName", 20);
    const types = new Set(result.map(r => r.type));
    expect(types).toEqual(new Set(["quote", "fact", "person", "topic"]));
  });

  it("covers exactly quote/fact/person/topic and never persona, even on an exact persona-name query (recent path)", async () => {
    writeTestState(createTestState({ facts: 2, people: 2, topics: 2, quotes: 2, personas: 2, personaNamePrefix: "ExactMatchName" }));
    const result = await retrieveBalanced("ExactMatchName", 20, { recent: true });
    const types = new Set(result.map(r => r.type));
    expect(types).toEqual(new Set(["quote", "fact", "person", "topic"]));
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

describe("lookupById — persona tools boolean-map enrichment", () => {
  function makeProvider(overrides: Partial<ToolProvider> = {}): ToolProvider {
    return {
      id: crypto.randomUUID(),
      name: "provider",
      display_name: "Provider",
      builtin: false,
      config: {},
      enabled: true,
      created_at: NOW,
      ...overrides,
    };
  }

  function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
    return {
      id: crypto.randomUUID(),
      provider_id: "provider-id",
      name: "tool",
      display_name: "Tool",
      description: "d",
      input_schema: {},
      runtime: "any",
      builtin: false,
      enabled: true,
      created_at: NOW,
      ...overrides,
    };
  }

  it("replaces the flat tools id array with a nested provider->tool->boolean map, excluding disabled providers", async () => {
    const state = createTestState({ personas: 1, personaNamePrefix: "TestAgent" }) as unknown as StorageState;
    (state.personas["persona_0"].entity as PersonaEntity).tools = ["t-web-search", "t-list-issues"];

    const brave = makeProvider({ id: "p-brave", display_name: "Brave Search", enabled: true });
    const github = makeProvider({ id: "p-github", display_name: "GitHub", enabled: false });
    state.providers = [brave, github];
    state.tools = [
      makeTool({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" }),
      makeTool({ id: "t-news-search", provider_id: "p-brave", display_name: "News Search" }),
      makeTool({ id: "t-list-issues", provider_id: "p-github", display_name: "List Issues" }),
    ];

    writeTestState(state);
    const result = await lookupById("persona_0");

    expect(result).not.toBeNull();
    expect(result!.tools).toEqual({
      "Brave Search": { "Web Search": true, "News Search": false },
    });
    expect(result!.tools).not.toHaveProperty("GitHub");
  });

  it("leaves tools absent when no tools are registered at all", async () => {
    writeTestState(createTestState({ personas: 1, personaNamePrefix: "TestAgent" }));
    const result = await lookupById("persona_0");
    expect(result).not.toBeNull();
    expect(result!.tools).toBeUndefined();
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

  it("applies a queued persona upsert into state.personas without throwing, alongside a human fact correction (I1 regression)", async () => {
    writeTestState(createTestState({ personas: 1, personaNamePrefix: "TestAgent", facts: 1 }));

    const personaCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "persona",
      id: "persona_new",
      record: {
        id: "persona_new",
        display_name: "Newly Queued Persona",
        entity: "system",
        traits: [],
        topics: [],
        is_paused: false,
        is_archived: false,
        is_static: false,
        last_updated: NOW,
      } as PersonaEntity,
      timestamp: NOW,
    };
    const factCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "fact",
      id: "fact_new",
      record: {
        id: "fact_new",
        name: "Queued Fact",
        description: "A fact queued alongside the persona correction",
        sentiment: 0.5,
        last_updated: NOW,
        validated_date: NOW,
      } as Fact,
      timestamp: NOW,
    };
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([personaCorrection, factCorrection]));

    const state = await loadLatestState();

    expect(state).not.toBeNull();
    // pre-existing persona from state.json survives untouched
    expect(state!.personas["persona_0"]).toBeDefined();
    expect(state!.personas["persona_0"].entity.display_name).toBe("TestAgent 0");
    // queued persona upsert materialized into .personas without throwing
    expect(state!.personas["persona_new"]).toBeDefined();
    expect(state!.personas["persona_new"].entity.display_name).toBe("Newly Queued Persona");
    // queued human (fact) correction still applies in the same mixed batch
    expect(state!.human.facts.some((f) => f.id === "fact_new" && f.name === "Queued Fact")).toBe(true);
  });

  it("does not delete or modify corrections.json when the queue contains a pending persona correction", async () => {
    writeTestState(createTestState({ personas: 1 }));
    const personaCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "persona",
      id: "persona_new",
      record: {
        id: "persona_new",
        display_name: "Read-Only Check Persona",
        entity: "system",
        traits: [],
        topics: [],
        is_paused: false,
        is_archived: false,
        is_static: false,
        last_updated: NOW,
      } as PersonaEntity,
      timestamp: NOW,
    };
    const correctionsPath = join(tempDir, "corrections.json");
    const raw = JSON.stringify([personaCorrection]);
    writeFileSync(correctionsPath, raw);

    const state = await loadLatestState();

    expect(state!.personas["persona_new"]).toBeDefined();
    expect(readFileSync(correctionsPath, "utf-8")).toBe(raw);
  });
});

describe("loadLatestState — quote corrections (Corrections Wire Grammar)", () => {
  it("materializes a valid quote.create correction into the returned state without consuming corrections.json", async () => {
    writeTestState(createTestState({}));
    const correctionsPath = join(tempDir, "corrections.json");
    const raw = JSON.stringify([makeQuoteCreateRecord("quote_new")]);
    writeFileSync(correctionsPath, raw);

    const state = await loadLatestState();

    expect(state!.human.quotes.find((q) => q.id === "quote_new")).toBeDefined();
    expect(readFileSync(correctionsPath, "utf-8")).toBe(raw);
    expect(getLastCorrectionSkips()).toEqual([]);
  });

  it("materializes a valid quote.relink correction, changing only data_item_ids, given a live target in the loaded state", async () => {
    writeTestState(createTestState({ people: 1, quotes: 1 }));
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([makeQuoteRelinkRecord("quote_0", ["person_0"])]));

    const state = await loadLatestState();

    const applied = state!.human.quotes.find((q) => q.id === "quote_0");
    expect(applied?.data_item_ids).toEqual(["person_0"]);
    expect(applied?.text).toBe("Test quote 0");
    expect(getLastCorrectionSkips()).toEqual([]);
  });

  it("rejects a quote.relink whose target id does not resolve in the loaded state (state-aware validation), reporting it via getLastCorrectionSkips()", async () => {
    writeTestState(createTestState({ quotes: 1 }));
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([makeQuoteRelinkRecord("quote_0", ["totally-made-up-id"])]));

    const state = await loadLatestState();

    const applied = state!.human.quotes.find((q) => q.id === "quote_0");
    expect(applied?.data_item_ids).toEqual([]);
    const skips = getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote_0");
    expect(skips[0].reason).toContain("totally-made-up-id");
  });

  it("materializes a valid quote.remove correction", async () => {
    writeTestState(createTestState({ quotes: 1 }));
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([makeQuoteRemoveRecord("quote_0")]));

    const state = await loadLatestState();

    expect(state!.human.quotes.find((q) => q.id === "quote_0")).toBeUndefined();
  });

  it("skips a pre-cutover unmarked full-record quote correction, applies a valid quote.remove and a valid person update in the same batch, and reports exactly one skip via getLastCorrectionSkips()", async () => {
    writeTestState(createTestState({ quotes: 2, people: 1 }));

    const legacyForgedRecord = {
      op: "upsert",
      entity_type: "quote",
      id: "quote_forged",
      record: { ...makeQuotes(1)[0], id: "quote_forged", text: "forged text" },
      timestamp: NOW,
    } as unknown as CorrectionRecord;
    const personCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "person",
      id: "person_0",
      record: { ...makePeople(1)[0], description: "Corrected description" } as Person,
      timestamp: NOW,
    };

    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([legacyForgedRecord, makeQuoteRemoveRecord("quote_1"), personCorrection]));

    const state = await loadLatestState();

    expect(state!.human.quotes.find((q) => q.id === "quote_forged")).toBeUndefined();
    expect(state!.human.quotes.find((q) => q.id === "quote_1")).toBeUndefined();
    expect(state!.human.quotes.find((q) => q.id === "quote_0")).toBeDefined();
    expect(state!.human.people.find((p) => p.id === "person_0")?.description).toBe("Corrected description");

    const skips = getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote_forged");
  });

  it("does not delete or modify corrections.json when the queue contains a pending quote.create correction", async () => {
    writeTestState(createTestState({}));
    const correctionsPath = join(tempDir, "corrections.json");
    const raw = JSON.stringify([makeQuoteCreateRecord("quote_new")]);
    writeFileSync(correctionsPath, raw);

    await loadLatestState();

    expect(readFileSync(correctionsPath, "utf-8")).toBe(raw);
  });

  it("T1: read overlay — a stale quote.fix does not recreate a quote removed earlier in the same batch, or restore a link an earlier fact removal already cleared, and a following valid correction still applies (C1)", async () => {
    const fact = makeDataItems("fact", 1, { validated_date: NOW })[0];
    const quoteLinked = { ...makeQuotes(1)[0], id: "quote_linked", data_item_ids: [fact.id] };
    const quoteDoomed = { ...makeQuotes(1)[0], id: "quote_doomed", data_item_ids: [] as string[] };
    const state = createTestState({});
    state.human.facts = [fact];
    state.human.quotes = [quoteLinked, quoteDoomed];
    writeTestState(state);

    const staleFixForLinked = makeQuoteFixRecord("quote_linked", { data_item_ids: [fact.id], persona_groups: ["stale-group"], text: "stale corrected text" });
    const staleFixForDoomed = makeQuoteFixRecord("quote_doomed", { text: "should never land" });
    const goodPerson: Person = { ...makePeople(1)[0], id: "person_new" };
    const personCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    };
    const factRemove: CorrectionRecord = { op: "remove", entity_type: "fact", id: fact.id, timestamp: NOW };

    // File order matters: both removals land BEFORE the stale fixes that
    // target their now-gone quote/link, exactly like C1's trigger.
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([
      factRemove,
      makeQuoteRemoveRecord("quote_doomed"),
      staleFixForLinked,
      staleFixForDoomed,
      personCorrection,
    ]));

    const result = await loadLatestState();

    // The removed quote was never recreated by the stale fix that targeted it.
    expect(result!.human.quotes.find((q) => q.id === "quote_doomed")).toBeUndefined();
    // The surviving quote's fix applied its text change but did NOT restore
    // the link the fact removal already cleared.
    const fixedQuote = result!.human.quotes.find((q) => q.id === "quote_linked");
    expect(fixedQuote).toBeDefined();
    expect(fixedQuote?.text).toBe("stale corrected text");
    expect(fixedQuote?.data_item_ids).toEqual([]);
    expect(fixedQuote?.persona_groups).toEqual([]);
    expect(result!.human.facts.find((f) => f.id === fact.id)).toBeUndefined();
    // The following valid correction still applied.
    expect(result!.human.people.find((p) => p.id === "person_new")).toBeDefined();

    const skips = getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote_doomed");
    expect(skips[0].reason).toContain("does not exist");
  });

  it("T16: an unrelated later create sharing the same id cannot launder this call's own skipped fix into a false success (I5, round 3)", async () => {
    // Round 3's [INFERENCE]: under a live lock, multiple writers can
    // append to corrections.json over time with nothing yet durably
    // drained -- remove(Q) -> fix(Q) [this call, skipped because Q no
    // longer exists at that point in the batch] -> create(Q) [a totally
    // independent later writer, whose projection coincidentally matches
    // what the fix requested]. A final-state text/start/end read-back
    // could not tell these two writers' outcomes apart; attempt_id can,
    // because it is retired final-state equality's exact replacement.
    writeTestState(createTestState({ quotes: 1 })); // quote_0, text "Test quote 0"

    const ourFix = makeQuoteFixRecord("quote_0", { text: "coincidental match", attempt_id: "attempt-under-test" });
    const laterCreate = makeQuoteCreateRecord("quote_0", { attempt_id: "later-writer-attempt", text: "coincidental match" });

    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([
      makeQuoteRemoveRecord("quote_0"),
      ourFix,
      laterCreate,
    ]));

    const state = await loadLatestState();

    // The coincidental-match premise is real: final state DOES show
    // quote_0 with the exact text this fix requested -- a final-state
    // equality check would have wrongly called this fix a success.
    expect(state!.human.quotes.find((q) => q.id === "quote_0")?.text).toBe("coincidental match");

    // But the skip list still correctly, unambiguously identifies OUR
    // fix's own attempt as skipped, entirely independent of the later
    // create -- which contributes no skip at all, since it succeeded.
    const skips = getLastCorrectionSkips();
    const mine = skips.find((s) => s.attempt_id === "attempt-under-test");
    expect(mine).toBeDefined();
    expect(mine?.record_id).toBe("quote_0");
    expect(mine?.reason).toContain("does not exist");
    expect(skips.find((s) => s.attempt_id === "later-writer-attempt")).toBeUndefined();
  });

  it("T2: read overlay skips a quote.relink with a missing entity_type and still applies a later valid correction, with no throw (I2)", async () => {
    writeTestState(createTestState({ quotes: 1 }));
    const malformedRelink = { op: "quote.relink", id: "quote_0", data_item_ids: ["anything"] } as unknown as CorrectionRecord;
    const goodPerson: Person = { ...makePeople(1)[0], id: "person_new" };
    const personCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    };
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([malformedRelink, personCorrection]));

    const state = await loadLatestState();

    expect(state!.human.quotes.find((q) => q.id === "quote_0")?.data_item_ids).toEqual([]);
    expect(state!.human.people.find((p) => p.id === "person_new")).toBeDefined();

    const skips = getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote_0");
    expect(skips[0].reason).toContain("entity_type");
  });

  it("T2: read overlay skips a quote.create with a missing entity_type and still applies a later valid correction, with no throw (I6)", async () => {
    writeTestState(createTestState({}));
    const malformedCreate: Record<string, unknown> = { ...makeQuoteCreateRecord("quote_new") };
    delete malformedCreate.entity_type;
    const goodPerson: Person = { ...makePeople(1)[0], id: "person_new" };
    const personCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    };
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([malformedCreate, personCorrection]));

    const state = await loadLatestState();

    expect(state!.human.quotes.find((q) => q.id === "quote_new")).toBeUndefined();
    expect(state!.human.people.find((p) => p.id === "person_new")).toBeDefined();

    const skips = getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote_new");
    expect(skips[0].reason).toContain("entity_type");
  });

  it("T2: read overlay skips a quote.fix with a missing entity_type and still applies a later valid correction, with no throw (I6)", async () => {
    writeTestState(createTestState({ quotes: 1 }));
    const malformedFix: Record<string, unknown> = { ...makeQuoteFixRecord("quote_0", { text: "should never land" }) };
    delete malformedFix.entity_type;
    const goodPerson: Person = { ...makePeople(1)[0], id: "person_new" };
    const personCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    };
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([malformedFix, personCorrection]));

    const state = await loadLatestState();

    expect(state!.human.quotes.find((q) => q.id === "quote_0")?.text).toBe("Test quote 0");
    expect(state!.human.people.find((p) => p.id === "person_new")).toBeDefined();

    const skips = getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote_0");
    expect(skips[0].reason).toContain("entity_type");
  });

  it("T2: read overlay skips a quote.remove with a missing entity_type and still applies a later valid correction, with no throw (I6)", async () => {
    writeTestState(createTestState({ quotes: 1 }));
    const malformedRemove: Record<string, unknown> = { ...makeQuoteRemoveRecord("quote_0") };
    delete malformedRemove.entity_type;
    const goodPerson: Person = { ...makePeople(1)[0], id: "person_new" };
    const personCorrection: CorrectionRecord = {
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    };
    writeFileSync(join(tempDir, "corrections.json"), JSON.stringify([malformedRemove, personCorrection]));

    const state = await loadLatestState();

    expect(state!.human.quotes.find((q) => q.id === "quote_0")).toBeDefined();
    expect(state!.human.people.find((p) => p.id === "person_new")).toBeDefined();

    const skips = getLastCorrectionSkips();
    expect(skips).toHaveLength(1);
    expect(skips[0].record_id).toBe("quote_0");
    expect(skips[0].reason).toContain("entity_type");
  });
});
