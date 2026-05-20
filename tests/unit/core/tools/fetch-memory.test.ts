// Tested by Beta — 2026-05-20
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFetchMemoryExecutor } from "../../../../src/core/tools/builtin/fetch-memory.js";
import type { HumanEntity, Fact, Topic, Person, Quote } from "../../../../src/core/types.js";

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "fact-1",
    name: "Favorite Color",
    description: "Loves blue",
    sentiment: 0.8,
    last_updated: "2026-01-01T00:00:00Z",
    validated_date: "2026-01-01T00:00:00Z",
    embedding: [0.1, 0.2],
    persona_groups: ["group-a"],
    ...overrides,
  };
}

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: "topic-1",
    name: "Hiking",
    description: "Loves outdoor trails",
    sentiment: 0.9,
    last_updated: "2026-01-01T00:00:00Z",
    exposure_current: 0.5,
    exposure_desired: 0.7,
    embedding: [0.3, 0.4],
    persona_groups: ["group-a"],
    rewrite_length_floor: 100,
    last_ei_asked: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    name: "Alice",
    description: "Best friend",
    sentiment: 0.95,
    last_updated: "2026-01-01T00:00:00Z",
    relationship: "friend",
    exposure_current: 0.6,
    exposure_desired: 0.8,
    embedding: [0.5, 0.6],
    persona_groups: ["group-a"],
    rewrite_length_floor: 80,
    last_ei_asked: null,
    ...overrides,
  };
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "quote-1",
    message_id: "msg-1",
    data_item_ids: ["fact-1", "topic-1"],
    persona_groups: ["group-a"],
    text: "I love hiking in blue skies",
    speaker: "human",
    timestamp: "2026-01-01T00:00:00Z",
    start: 0,
    end: 30,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "extraction",
    embedding: [0.7, 0.8],
    ...overrides,
  };
}

function makeHuman(overrides: Partial<HumanEntity> = {}): HumanEntity {
  return {
    entity: "human",
    facts: [makeFact()],
    topics: [makeTopic()],
    people: [makePerson()],
    quotes: [makeQuote()],
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createFetchMemoryExecutor", () => {
  let getHuman: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getHuman = vi.fn(() => makeHuman());
  });

  describe("missing / empty id", () => {
    it("returns error when id is missing", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({}));
      expect(result).toEqual({ error: "Missing required argument: id" });
    });

    it("returns error when id is empty string", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "" }));
      expect(result).toEqual({ error: "Missing required argument: id" });
    });

    it("returns error when id is whitespace only", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "   " }));
      expect(result).toEqual({ error: "Missing required argument: id" });
    });
  });

  describe("fact lookup", () => {
    it("returns cleaned fact with type field", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "fact-1" }));

      expect(result.type).toBe("fact");
      expect(result.id).toBe("fact-1");
      expect(result.name).toBe("Favorite Color");
      expect(result.description).toBe("Loves blue");
      expect(result.validated_date).toBe("2026-01-01T00:00:00Z");
    });

    it("strips embedding and persona_groups from fact", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "fact-1" }));

      expect(result.embedding).toBeUndefined();
      expect(result.persona_groups).toBeUndefined();
    });
  });

  describe("topic lookup", () => {
    it("returns cleaned topic with type field", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "topic-1" }));

      expect(result.type).toBe("topic");
      expect(result.id).toBe("topic-1");
      expect(result.name).toBe("Hiking");
      expect(result.exposure_current).toBe(0.5);
      expect(result.exposure_desired).toBe(0.7);
    });

    it("strips embedding, persona_groups, rewrite_length_floor, last_ei_asked from topic", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "topic-1" }));

      expect(result.embedding).toBeUndefined();
      expect(result.persona_groups).toBeUndefined();
      expect(result.rewrite_length_floor).toBeUndefined();
      expect(result.last_ei_asked).toBeUndefined();
    });
  });

  describe("person lookup", () => {
    it("returns cleaned person with type field", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "person-1" }));

      expect(result.type).toBe("person");
      expect(result.id).toBe("person-1");
      expect(result.name).toBe("Alice");
      expect(result.relationship).toBe("friend");
    });

    it("strips embedding, persona_groups, rewrite_length_floor, last_ei_asked from person", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "person-1" }));

      expect(result.embedding).toBeUndefined();
      expect(result.persona_groups).toBeUndefined();
      expect(result.rewrite_length_floor).toBeUndefined();
      expect(result.last_ei_asked).toBeUndefined();
    });
  });

  describe("quote lookup", () => {
    it("returns cleaned quote with type field and linked_items resolved", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "quote-1" }));

      expect(result.type).toBe("quote");
      expect(result.id).toBe("quote-1");
      expect(result.text).toBe("I love hiking in blue skies");
      expect(result.speaker).toBe("human");
    });

    it("strips embedding, persona_groups, data_item_ids from quote", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "quote-1" }));

      expect(result.embedding).toBeUndefined();
      expect(result.persona_groups).toBeUndefined();
      expect(result.data_item_ids).toBeUndefined();
    });

    it("resolves data_item_ids to linked_items with id, name, type", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "quote-1" }));

      expect(result.linked_items).toEqual([
        { id: "fact-1", name: "Favorite Color", type: "fact" },
        { id: "topic-1", name: "Hiking", type: "topic" },
      ]);
    });

    it("resolves person data_item_ids to linked_items", async () => {
      const human = makeHuman({
        quotes: [makeQuote({ data_item_ids: ["person-1"] })],
      });
      const executor = createFetchMemoryExecutor(() => human);
      const result = JSON.parse(await executor.execute({ id: "quote-1" }));

      expect(result.linked_items).toEqual([
        { id: "person-1", name: "Alice", type: "person" },
      ]);
    });

    it("returns empty linked_items when data_item_ids are unknown", async () => {
      const human = makeHuman({
        quotes: [makeQuote({ data_item_ids: ["unknown-id-1", "unknown-id-2"] })],
      });
      const executor = createFetchMemoryExecutor(() => human);
      const result = JSON.parse(await executor.execute({ id: "quote-1" }));

      expect(result.linked_items).toEqual([]);
    });

    it("returns empty linked_items when data_item_ids is empty", async () => {
      const human = makeHuman({
        quotes: [makeQuote({ data_item_ids: [] })],
      });
      const executor = createFetchMemoryExecutor(() => human);
      const result = JSON.parse(await executor.execute({ id: "quote-1" }));

      expect(result.linked_items).toEqual([]);
    });
  });

  describe("not found", () => {
    it("returns error when id does not match any entity", async () => {
      const executor = createFetchMemoryExecutor(getHuman);
      const result = JSON.parse(await executor.execute({ id: "nonexistent-id" }));

      expect(result).toEqual({ error: "No accessible record found for this ID" });
    });
  });

  describe("executor metadata", () => {
    it("has name fetch_memory", () => {
      const executor = createFetchMemoryExecutor(getHuman);
      expect(executor.name).toBe("fetch_memory");
    });
  });
});
