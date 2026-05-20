import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFindMemoryExecutor } from "../../../../src/core/tools/builtin/find-memory.js";
import type { Person, Quote } from "../../../../src/core/types.js";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    name: "Flare",
    description: "A developer",
    relationship: "Self",
    sentiment: 0.9,
    exposure_current: 0.5,
    exposure_desired: 0.7,
    last_updated: "2026-01-01T00:00:00Z",
    interested_personas: [],
    identifiers: [
      { type: "GitHub", value: "flare576" },
      { type: "Nickname", value: "Flare" },
    ],
    validated_date: "",
    ...overrides,
  };
}

function makeSearchHumanData(person: Person) {
  return vi.fn().mockResolvedValue({
    facts: [],
    topics: [],
    people: [person],
    quotes: [],
  });
}

describe("find_memory — people results", () => {
  it("includes id in people output", async () => {
    const executor = createFindMemoryExecutor(makeSearchHumanData(makePerson()));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    expect(result.people[0]).toHaveProperty("id", "person-1");
  });

  it("includes identifiers array in people output", async () => {
    const executor = createFindMemoryExecutor(makeSearchHumanData(makePerson()));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    expect(result.people).toBeDefined();
    expect(result.people[0]).toHaveProperty("identifiers");
    expect(Array.isArray(result.people[0].identifiers)).toBe(true);
  });

  it("identifiers contain type and value fields", async () => {
    const executor = createFindMemoryExecutor(makeSearchHumanData(makePerson()));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    expect(result.people[0].identifiers).toContainEqual({ type: "GitHub", value: "flare576" });
    expect(result.people[0].identifiers).toContainEqual({ type: "Nickname", value: "Flare" });
  });

  it("person with no identifiers returns empty array (not undefined)", async () => {
    const executor = createFindMemoryExecutor(makeSearchHumanData(makePerson({ identifiers: undefined as any })));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    expect(result.people[0].identifiers).toEqual([]);
  });

  it("still returns name, relationship, description alongside identifiers", async () => {
    const executor = createFindMemoryExecutor(makeSearchHumanData(makePerson()));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    const person = result.people[0];
    expect(person).toHaveProperty("name", "Flare");
    expect(person).toHaveProperty("relationship", "Self");
    expect(person).toHaveProperty("description", "A developer");
    expect(person).toHaveProperty("identifiers");
  });
});

describe("find_memory — quotes with linked_items", () => {
  it("includes linked_items on quotes when getHuman is provided", async () => {
    const quote: Quote = {
      id: "quote-1",
      text: "Birthday cake is the best",
      speaker: "human",
      timestamp: "2026-01-15T10:00:00Z",
      message_id: "msg-1",
      data_item_ids: ["topic-1"],
      persona_groups: [],
      start: null,
      end: null,
      created_at: "2026-01-15T10:00:00Z",
      created_by: "extraction",
    };
    const searchFn = vi.fn().mockResolvedValue({ facts: [], topics: [], people: [], quotes: [quote] });
    const getHuman = vi.fn().mockReturnValue({
      facts: [],
      topics: [{ id: "topic-1", name: "Birthday Cake" }],
      people: [],
      quotes: [],
    });
    const executor = createFindMemoryExecutor(searchFn, undefined, getHuman);
    const result = JSON.parse(await executor.execute({ query: "cake" }));

    expect(result.quotes[0].linked_items).toContainEqual({ id: "topic-1", name: "Birthday Cake", type: "topic" });
  });
});

describe("find_memory — persona filter resolution", () => {
  const makeSearchFn = () =>
    vi.fn().mockResolvedValue({ facts: [{ id: "f1", name: "Test Fact", description: "desc" }], topics: [], people: [], quotes: [] });

  it("exact display_name match passes persona id as persona_filter", async () => {
    const searchFn = makeSearchFn();
    const getPersonaList = vi.fn().mockResolvedValue([
      { id: "persona-abc", display_name: "DJ" },
      { id: "persona-xyz", display_name: "Flare" },
    ]);
    const executor = createFindMemoryExecutor(searchFn, getPersonaList);
    await executor.execute({ query: "music", persona: "DJ" });

    expect(searchFn).toHaveBeenCalledWith("music", expect.objectContaining({ persona_filter: "persona-abc" }));
  });

  it("case-insensitive match resolves persona filter", async () => {
    const searchFn = makeSearchFn();
    const getPersonaList = vi.fn().mockResolvedValue([
      { id: "persona-dj", display_name: "dj" },
    ]);
    const executor = createFindMemoryExecutor(searchFn, getPersonaList);
    await executor.execute({ query: "music", persona: "DJ" });

    expect(searchFn).toHaveBeenCalledWith("music", expect.objectContaining({ persona_filter: "persona-dj" }));
  });

  it("no match calls searchHumanData without persona_filter", async () => {
    const searchFn = makeSearchFn();
    const getPersonaList = vi.fn().mockResolvedValue([
      { id: "persona-xyz", display_name: "Flare" },
    ]);
    const executor = createFindMemoryExecutor(searchFn, getPersonaList);
    await executor.execute({ query: "music", persona: "Unknown" });

    const callOptions = searchFn.mock.calls[0][1] as Record<string, unknown>;
    expect(callOptions.persona_filter).toBeUndefined();
  });

  it("getPersonaList not provided — no filter applied", async () => {
    const searchFn = makeSearchFn();
    const executor = createFindMemoryExecutor(searchFn);
    await executor.execute({ query: "music", persona: "DJ" });

    const callOptions = searchFn.mock.calls[0][1] as Record<string, unknown>;
    expect(callOptions.persona_filter).toBeUndefined();
  });
});

describe("find_memory — recent flag and query validation", () => {
  const makeSearchFn = () =>
    vi.fn().mockResolvedValue({ facts: [{ id: "f1", name: "Recent Fact", description: "desc" }], topics: [], people: [], quotes: [] });

  it("recent=true with no query returns results (not an error)", async () => {
    const searchFn = makeSearchFn();
    const executor = createFindMemoryExecutor(searchFn);
    const result = JSON.parse(await executor.execute({ recent: true }));

    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("facts");
  });

  it("recent=false with no query returns missing query error", async () => {
    const searchFn = makeSearchFn();
    const executor = createFindMemoryExecutor(searchFn);
    const result = JSON.parse(await executor.execute({ recent: false }));

    expect(result).toHaveProperty("error", "Missing required argument: query (or use recent: true)");
  });
});
