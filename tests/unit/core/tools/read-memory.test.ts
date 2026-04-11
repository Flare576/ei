import { describe, it, expect, vi } from "vitest";
import { createReadMemoryExecutor } from "../../../../src/core/tools/builtin/read-memory.js";
import type { Person } from "../../../../src/core/types.js";

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

describe("read_memory — identifiers in people results", () => {
  it("includes identifiers array in people output", async () => {
    const executor = createReadMemoryExecutor(makeSearchHumanData(makePerson()));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    expect(result.people).toBeDefined();
    expect(result.people[0]).toHaveProperty("identifiers");
    expect(Array.isArray(result.people[0].identifiers)).toBe(true);
  });

  it("identifiers contain type and value fields", async () => {
    const executor = createReadMemoryExecutor(makeSearchHumanData(makePerson()));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    expect(result.people[0].identifiers).toContainEqual({ type: "GitHub", value: "flare576" });
    expect(result.people[0].identifiers).toContainEqual({ type: "Nickname", value: "Flare" });
  });

  it("person with no identifiers returns empty array (not undefined)", async () => {
    const executor = createReadMemoryExecutor(makeSearchHumanData(makePerson({ identifiers: undefined as any })));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    expect(result.people[0].identifiers).toEqual([]);
  });

  it("still returns name, relationship, description alongside identifiers", async () => {
    const executor = createReadMemoryExecutor(makeSearchHumanData(makePerson()));
    const result = JSON.parse(await executor.execute({ query: "Flare" }));

    const person = result.people[0];
    expect(person).toHaveProperty("name", "Flare");
    expect(person).toHaveProperty("relationship", "Self");
    expect(person).toHaveProperty("description", "A developer");
    expect(person).toHaveProperty("identifiers");
  });
});
