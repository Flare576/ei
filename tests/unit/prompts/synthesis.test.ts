import { describe, it, expect } from "vitest";
import { buildSynthesisPrompt } from "../../../src/prompts/synthesis/index.js";
import type { SynthesisPromptData, EnrichedTopic, EnrichedPerson } from "../../../src/prompts/synthesis/types.js";
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
    relationship: "Friend",
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
    message_id: "msg-1",
    data_item_ids: [],
    persona_groups: [],
    text: "Life is short.",
    speaker: "human",
    timestamp: "2026-01-01T00:00:00Z",
    start: null,
    end: null,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "extraction",
    ...overrides,
  };
}

function makeEnrichedTopic(topicOverrides?: Partial<Topic>, quotes: Quote[] = []): EnrichedTopic {
  return { topic: makeTopic(topicOverrides), quotes };
}

function makeEnrichedPerson(personOverrides?: Partial<Person>, quotes: Quote[] = []): EnrichedPerson {
  return { person: makePerson(personOverrides), quotes };
}

function baseData(overrides?: Partial<SynthesisPromptData>): SynthesisPromptData {
  return {
    subject: "Test Subject",
    facts: [],
    topics: [],
    people: [],
    standaloneQuotes: [],
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
        topics: [makeEnrichedTopic()],
        people: [makeEnrichedPerson()],
        standaloneQuotes: [makeQuote()],
      })
    );
    expect(result.user).toContain("## Facts");
    expect(result.user).toContain("## Topics");
    expect(result.user).toContain("## People");
    expect(result.user).toContain("## Additional Quotes");
  });

  it("empty types are omitted — headings not present for empty arrays", () => {
    const result = buildSynthesisPrompt(
      baseData({
        subject: "Partial Test",
        facts: [makeFact()],
        topics: [],
        people: [],
        standaloneQuotes: [],
      })
    );
    expect(result.user).toContain("## Facts");
    expect(result.user).not.toContain("## Topics");
    expect(result.user).not.toContain("## People");
    expect(result.user).not.toContain("## Additional Quotes");
  });

  it("topic id and category are rendered in user prompt", () => {
    const result = buildSynthesisPrompt(
      baseData({
        topics: [makeEnrichedTopic({ id: "topic-42", category: "Technical" })],
      })
    );
    expect(result.user).toContain("topic-42");
    expect(result.user).toContain("Technical");
  });

  it("person relationship is rendered in user prompt", () => {
    const result = buildSynthesisPrompt(
      baseData({
        people: [makeEnrichedPerson({ relationship: "Colleague" })],
      })
    );
    expect(result.user).toContain("Colleague");
  });

  it("linked quotes appear under their topic with message_id", () => {
    const q = makeQuote({ message_id: "msg-xyz", text: "This is important.", speaker: "Sisyphus", channel: "OpenCode" });
    const result = buildSynthesisPrompt(
      baseData({
        topics: [makeEnrichedTopic({}, [q])],
      })
    );
    expect(result.user).toContain("msg-xyz");
    expect(result.user).toContain("This is important.");
    expect(result.user).toContain("Sisyphus");
    expect(result.user).toContain("OpenCode");
  });

  it("standalone quotes section appears with message_id", () => {
    const q = makeQuote({ message_id: "msg-standalone", text: "Standalone quote." });
    const result = buildSynthesisPrompt(
      baseData({ standaloneQuotes: [q] })
    );
    expect(result.user).toContain("## Additional Quotes");
    expect(result.user).toContain("msg-standalone");
    expect(result.user).toContain("Standalone quote.");
  });

  it("system prompt mentions fetch_message for quote context", () => {
    const result = buildSynthesisPrompt(baseData());
    expect(result.system).toContain("fetch_message");
  });
});
