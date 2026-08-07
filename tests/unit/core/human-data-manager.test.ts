import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchHumanData } from "../../../src/core/human-data-manager.js";
import type { Fact, Topic, Person, Quote, HumanEntity, PersonaEntity } from "../../../src/core/types.js";
import type { StateManager } from "../../../src/core/state-manager.js";

vi.mock("../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  findTopK: vi.fn((queryVec, items, k) => {
    return items.slice(0, k).map((item: { id: string }, idx: number) => ({
      item,
      similarity: 0.9 - idx * 0.1,
    }));
  }),
  needsEmbeddingUpdate: vi.fn(() => false),
  needsQuoteEmbeddingUpdate: vi.fn(() => false),
  computeDataItemEmbedding: vi.fn(),
  computeQuoteEmbedding: vi.fn(),
}));

function createMockStateManager(human: HumanEntity, personas: Record<string, PersonaEntity> = {}) {
  return {
    getHuman: vi.fn(() => human),
    persona_getById: vi.fn((id: string) => personas[id] ?? null),
  };
}

function makeFact(id: string, name: string, interested?: string[]): Fact {
  return {
    id,
    name,
    description: `Description of ${name}`,
    sentiment: 0,
    last_updated: new Date().toISOString(),
    validated_date: "",
    interested_personas: interested,
    embedding: new Array(384).fill(0.1),
  };
}

function makeTopic(id: string, name: string, interested?: string[]): Topic {
  return {
    id,
    name,
    description: `Description of ${name}`,
    sentiment: 0.5,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
    interested_personas: interested,
    embedding: new Array(384).fill(0.1),
  };
}

function makePerson(id: string, name: string, interested?: string[]): Person {
  return {
    id,
    name,
    description: `Description of ${name}`,
    relationship: "friend",
    sentiment: 0.5,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
    interested_personas: interested,
    embedding: new Array(384).fill(0.1),
  };
}

function makeQuote(id: string, text: string, personaGroups: string[] = []): Quote {
  return {
    id,
    message_id: null,
    data_item_ids: [],
    persona_groups: personaGroups,
    text,
    speaker: "human",
    timestamp: new Date().toISOString(),
    start: null,
    end: null,
    created_at: new Date().toISOString(),
    created_by: "human",
    embedding: new Array(384).fill(0.1),
  };
}

function makePersonaEntity(id: string, groupPrimary: string | null, groupsVisible: string[] = []): PersonaEntity {
  return {
    id,
    display_name: id,
    entity: "system",
    group_primary: groupPrimary,
    groups_visible: groupsVisible,
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  } as unknown as PersonaEntity;
}

function makeHuman(overrides: Partial<HumanEntity> = {}): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

describe("searchHumanData - persona_filter option", () => {
  describe("facts filtering", () => {
    it("returns only facts where interested_personas includes the filter ID", async () => {
      const human = makeHuman({
        facts: [
          makeFact("f1", "Fact One", ["persona-1", "persona-2"]),
          makeFact("f2", "Fact Two", ["persona-2"]),
          makeFact("f3", "Fact Three", ["persona-1"]),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "description", {
        types: ["fact"],
        persona_filter: "persona-1",
      });

      expect(result.facts.map(f => f.id)).toEqual(expect.arrayContaining(["f1", "f3"]));
      expect(result.facts.map(f => f.id)).not.toContain("f2");
    });

    it("returns empty array when persona_filter matches no facts", async () => {
      const human = makeHuman({
        facts: [
          makeFact("f1", "Fact One", ["persona-1"]),
          makeFact("f2", "Fact Two", ["persona-2"]),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "description", {
        types: ["fact"],
        persona_filter: "unknown-persona",
      });

      expect(result.facts).toEqual([]);
    });
  });

  describe("topics filtering", () => {
    it("returns only topics where interested_personas includes the filter ID", async () => {
      const human = makeHuman({
        topics: [
          makeTopic("t1", "Topic One", ["persona-1"]),
          makeTopic("t2", "Topic Two", ["persona-2", "persona-3"]),
          makeTopic("t3", "Topic Three", ["persona-1", "persona-3"]),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "description", {
        types: ["topic"],
        persona_filter: "persona-3",
      });

      expect(result.topics.map(t => t.id)).toEqual(expect.arrayContaining(["t2", "t3"]));
      expect(result.topics.map(t => t.id)).not.toContain("t1");
    });
  });

  describe("people filtering", () => {
    it("returns only people where interested_personas includes the filter ID", async () => {
      const human = makeHuman({
        people: [
          makePerson("p1", "Person One", ["persona-1"]),
          makePerson("p2", "Person Two", ["persona-2"]),
          makePerson("p3", "Person Three", ["persona-1", "persona-2"]),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "description", {
        types: ["person"],
        persona_filter: "persona-2",
      });

      expect(result.people.map(p => p.id)).toEqual(expect.arrayContaining(["p2", "p3"]));
      expect(result.people.map(p => p.id)).not.toContain("p1");
    });
  });

  // "quotes" don't have interested_personas like Fact/Topic/Person — visibility
  // is governed by group intersection (persona_groups vs. the persona's
  // group_primary + groups_visible), the same predicate prompt-context-builder.ts's
  // filterHumanDataByVisibility already applies. See group-visibility.ts.
  describe("quotes filtering — group-visibility", () => {
    it("a persona with visible groups gets only the group-visible quotes", async () => {
      const human = makeHuman({
        quotes: [
          makeQuote("q1", "About music", ["Music"]),
          makeQuote("q2", "About cooking", ["Cooking"]),
          makeQuote("q3", "No groups set", []), // defaults to "General"
        ],
      });
      const sm = createMockStateManager(human, {
        "persona-1": makePersonaEntity("persona-1", "Music", ["General"]),
      });

      const result = await searchHumanData(sm as unknown as StateManager, "about", {
        types: ["quote"],
        persona_filter: "persona-1",
      });

      expect(result.quotes.map(q => q.id)).toEqual(expect.arrayContaining(["q1", "q3"]));
      expect(result.quotes.map(q => q.id)).not.toContain("q2");
    });

    it("a persona with NO visible groups gets zero quotes — this is correct filtering, not a bug", async () => {
      // Per Flare's IRQ-2 ruling: a persona whose group_primary/groups_visible
      // don't intersect any quote's persona_groups SHOULD see zero quotes.
      // That's the filter doing its job, not an exclusion defect to "fix".
      const human = makeHuman({
        quotes: [
          makeQuote("q1", "About music", ["Music"]),
          makeQuote("q2", "About cooking", ["Cooking"]),
        ],
      });
      const sm = createMockStateManager(human, {
        "persona-1": makePersonaEntity("persona-1", "Woodworking", []),
      });

      const result = await searchHumanData(sm as unknown as StateManager, "about", {
        types: ["quote"],
        persona_filter: "persona-1",
      });

      expect(result.quotes).toEqual([]);
    });
  });

  describe("no persona_filter", () => {
    it("returns all items when persona_filter is not set", async () => {
      const human = makeHuman({
        facts: [
          makeFact("f1", "Fact One", ["persona-1"]),
          makeFact("f2", "Fact Two", ["persona-2"]),
        ],
        topics: [
          makeTopic("t1", "Topic One", ["persona-1"]),
        ],
        people: [
          makePerson("p1", "Person One", ["persona-2"]),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "description", {
        types: ["fact", "topic", "person"],
      });

      expect(result.facts).toHaveLength(2);
      expect(result.topics).toHaveLength(1);
      expect(result.people).toHaveLength(1);
    });

    it("no persona_filter still returns all quotes unscoped, unchanged", async () => {
      const human = makeHuman({
        quotes: [
          makeQuote("q1", "About music", ["Music"]),
          makeQuote("q2", "About cooking", ["Cooking"]),
          makeQuote("q3", "No groups set", []),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "about", {
        types: ["quote"],
      });

      expect(result.quotes.map(q => q.id)).toEqual(expect.arrayContaining(["q1", "q2", "q3"]));
      expect(result.quotes).toHaveLength(3);
    });

    it("returns all items when persona_filter is undefined", async () => {
      const human = makeHuman({
        facts: [
          makeFact("f1", "Fact", ["persona-1"]),
          makeFact("f2", "Another Fact", undefined),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "fact", {
        types: ["fact"],
        persona_filter: undefined,
      });

      expect(result.facts).toHaveLength(2);
    });
  });

  describe("edge cases", () => {
    it("handles items with undefined interested_personas", async () => {
      const human = makeHuman({
        facts: [
          makeFact("f1", "Fact With Personas", ["persona-1"]),
          makeFact("f2", "Fact Without Personas", undefined),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "fact", {
        types: ["fact"],
        persona_filter: "persona-1",
      });

      expect(result.facts.map(f => f.id)).toEqual(["f1"]);
    });

    it("handles items with empty interested_personas array", async () => {
      const human = makeHuman({
        topics: [
          makeTopic("t1", "Topic With Personas", ["persona-1"]),
          makeTopic("t2", "Topic With Empty Array", []),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "topic", {
        types: ["topic"],
        persona_filter: "persona-1",
      });

      expect(result.topics.map(t => t.id)).toEqual(["t1"]);
    });

    it("filters across multiple types simultaneously", async () => {
      const human = makeHuman({
        facts: [
          makeFact("f1", "Fact", ["shared-persona"]),
          makeFact("f2", "Other Fact", ["other-persona"]),
        ],
        topics: [
          makeTopic("t1", "Topic", ["shared-persona"]),
          makeTopic("t2", "Other Topic", ["other-persona"]),
        ],
        people: [
          makePerson("p1", "Person", ["shared-persona"]),
          makePerson("p2", "Other Person", ["other-persona"]),
        ],
      });
      const sm = createMockStateManager(human);

      const result = await searchHumanData(sm as unknown as StateManager, "shared", {
        types: ["fact", "topic", "person"],
        persona_filter: "shared-persona",
      });

      expect(result.facts.map(f => f.id)).toEqual(["f1"]);
      expect(result.topics.map(t => t.id)).toEqual(["t1"]);
      expect(result.people.map(p => p.id)).toEqual(["p1"]);
    });
  });
});
