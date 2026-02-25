import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";


vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getEmbeddingService: () => ({
      embed: async () => new Array(384).fill(1),
    }),
  };
});

import { retrieve, retrieveBalanced, resolveLinkedItems, lookupById } from "../../../src/cli/retrieval.js";
import { ValidationLevel } from "../../../src/core/types.js";

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

function createTestState(counts: {
  facts?: number; traits?: number; people?: number; topics?: number; quotes?: number;
}) {
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: makeDataItems("fact", counts.facts ?? 0, { validated: ValidationLevel.None, validated_date: NOW }),
      traits: makeDataItems("trait", counts.traits ?? 0, { strength: 0.5 }),
      people: makeDataItems("person", counts.people ?? 0, { relationship: "friend", exposure_current: 0.5, exposure_desired: 0.5 }),
      topics: makeDataItems("topic", counts.topics ?? 0, { category: "Interest", exposure_current: 0.5, exposure_desired: 0.5 }),
      quotes: makeQuotes(counts.quotes ?? 0),
      last_updated: NOW,
      last_activity: NOW,
    },
    personas: {},
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
  (globalThis as any).Bun = {
    file: (path: string) => ({
      exists: async () => existsSync(path),
      text: async () => readFileSync(path, "utf-8"),
    }),
  };
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
    const items = makeDataItems("fact", 3, { validated: ValidationLevel.None, validated_date: NOW });
    expect(await retrieve(items, "")).toEqual([]);
  });

  it("respects limit", async () => {
    const items = makeDataItems("fact", 10, { validated: ValidationLevel.None, validated_date: NOW });
    const result = await retrieve(items, "test", 3);
    expect(result).toHaveLength(3);
  });

  it("returns all when fewer than limit", async () => {
    const items = makeDataItems("fact", 2, { validated: ValidationLevel.None, validated_date: NOW });
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
    const validTypes = ["quote", "fact", "trait", "person", "topic"];
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
    expect(types).toContain("trait");
    expect(types).toContain("person");
    expect(types).toContain("topic");
  });

  it("returns all 9 items when fewer than limit", async () => {
    writeTestState(createTestState({ facts: 2, traits: 2, people: 2, topics: 2, quotes: 1 }));
    const result = await retrieveBalanced("test", 10);
    expect(result).toHaveLength(9);
  });

  it("respects -n limit", async () => {
    writeTestState(createTestState({ facts: 10, traits: 10, people: 10, topics: 10, quotes: 10 }));
    const result = await retrieveBalanced("test", 5);
    expect(result).toHaveLength(5);
  });
});

describe("resolveLinkedItems", () => {
  it("resolves items across all 4 collection types", () => {
    const state = createTestState({ facts: 2, traits: 2, people: 2, topics: 2 });
    const ids = ["fact_0", "trait_1", "person_0", "topic_1"];
    const result = resolveLinkedItems(ids, state as any);
    expect(result).toHaveLength(4);
    expect(result).toEqual(expect.arrayContaining([
      { id: "fact_0", name: "Test fact 0", type: "fact" },
      { id: "trait_1", name: "Test trait 1", type: "trait" },
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
