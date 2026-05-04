import { describe, it, expect } from "vitest";
import { buildSynthesisPrompt } from "../../../src/prompts/synthesis/index.js";
import type { SynthesisPromptData } from "../../../src/prompts/synthesis/types.js";
import type { Fact, Topic, Person, Quote } from "../../../src/core/types.js";

function makeFact(overrides?: Partial<Fact>): Fact {
  return {
    id: "fact-1",
    name: "Favorite Color",
    description: "Loves blue.",
    sentiment: 0.8,
    validated_date: "2026-01-01T00:00:00Z",
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTopic(overrides?: Partial<Topic>): Topic {
  return {
    id: "topic-1",
    name: "Music",
    description: "Enjoys jazz.",
    sentiment: 0.9,
    exposure_current: 0.5,
    exposure_desired: 0.8,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makePerson(overrides?: Partial<Person>): Person {
  return {
    id: "person-1",
    name: "Alice",
    description: "A close friend.",
    sentiment: 0.9,
    exposure_current: 0.4,
    exposure_desired: 0.6,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeQuote(overrides?: Partial<Quote>): Quote {
  return {
    id: "quote-1",
    name: "Life is short.",
    description: "Said during a reflective moment.",
    sentiment: 0.7,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function baseData(overrides?: Partial<SynthesisPromptData>): SynthesisPromptData {
  return {
    subject: "Test Subject",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    ...overrides,
  };
}

describe("buildSynthesisPrompt", () => {
  it("returns { system, user } — both non-empty strings", () => {
    const result = buildSynthesisPrompt(baseData({ facts: [makeFact()] }));
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("injects subject into user prompt", () => {
    const result = buildSynthesisPrompt(baseData({ subject: "My Unique Subject" }));
    expect(result.user).toContain("My Unique Subject");
  });

  it("all 4 types populated → output contains sections for each", () => {
    const result = buildSynthesisPrompt(
      baseData({
        subject: "Full Test",
        facts: [makeFact()],
        topics: [makeTopic()],
        people: [makePerson()],
        quotes: [makeQuote()],
      })
    );
    expect(result.user).toContain("## Facts");
    expect(result.user).toContain("## Topics");
    expect(result.user).toContain("## People");
    expect(result.user).toContain("## Quotes");
  });

  it("empty types are omitted — headings not present for empty arrays", () => {
    const result = buildSynthesisPrompt(
      baseData({
        subject: "Partial Test",
        facts: [makeFact()],
        topics: [],
        people: [],
        quotes: [],
      })
    );
    expect(result.user).toContain("## Facts");
    expect(result.user).not.toContain("## Topics");
    expect(result.user).not.toContain("## People");
    expect(result.user).not.toContain("## Quotes");
  });
});
