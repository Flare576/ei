import { describe, it, expect } from "vitest";
import {
  stripDataItemEmbedding,
  stripQuoteEmbedding,
  stripHumanEmbeddings,
} from "../../../src/core/context-utils.js";
import type { Fact, Topic, Person, Quote, HumanEntity } from "../../../src/core/types.js";

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "fact-1",
    name: "Birthday",
    description: "March 3rd",
    sentiment: 0.5,
    last_updated: "2026-01-01T00:00:00.000Z",
    validated_date: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: "topic-1",
    name: "Woodworking",
    description: "Builds furniture on weekends",
    sentiment: 0.7,
    last_updated: "2026-01-01T00:00:00.000Z",
    exposure_current: 0.2,
    exposure_desired: 0.5,
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    name: "Jamie",
    description: "Coworker on the platform team",
    sentiment: 0.6,
    last_updated: "2026-01-01T00:00:00.000Z",
    relationship: "coworker",
    exposure_current: 0.1,
    exposure_desired: 0.3,
    ...overrides,
  };
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "quote-1",
    message_id: "msg-1",
    data_item_ids: ["fact-1"],
    persona_groups: [],
    text: "The lease bug is the real defect",
    speaker: "human",
    timestamp: "2026-01-01T00:00:00.000Z",
    start: 0,
    end: 10,
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "human",
    ...overrides,
  };
}

describe("stripDataItemEmbedding", () => {
  it("strips the embedding field while preserving every other field", () => {
    const fact = makeFact({ embedding: [1, 2, 3] });

    const stripped = stripDataItemEmbedding(fact);

    expect(stripped).not.toHaveProperty("embedding");
    expect(stripped).toMatchObject({
      id: "fact-1",
      name: "Birthday",
      description: "March 3rd",
      sentiment: 0.5,
      validated_date: "2026-01-01T00:00:00.000Z",
    });
  });

  it("is a no-op on fields when no embedding is present", () => {
    const topic = makeTopic();

    const stripped = stripDataItemEmbedding(topic);

    expect(stripped).not.toHaveProperty("embedding");
    expect(stripped).toEqual(topic);
  });

  it("does not mutate the original item", () => {
    const person = makePerson({ embedding: [0.1, 0.2] });

    stripDataItemEmbedding(person);

    expect(person).toHaveProperty("embedding");
  });
});

describe("stripQuoteEmbedding", () => {
  it("strips the embedding field while preserving every other field", () => {
    const quote = makeQuote({ embedding: [4, 5, 6] });

    const stripped = stripQuoteEmbedding(quote);

    expect(stripped).not.toHaveProperty("embedding");
    expect(stripped).toMatchObject({
      id: "quote-1",
      message_id: "msg-1",
      data_item_ids: ["fact-1"],
      text: "The lease bug is the real defect",
      speaker: "human",
    });
  });

  it("is a no-op on fields when no embedding is present", () => {
    const quote = makeQuote();

    const stripped = stripQuoteEmbedding(quote);

    expect(stripped).not.toHaveProperty("embedding");
    expect(stripped).toEqual(quote);
  });
});

describe("stripHumanEmbeddings", () => {
  function makeHuman(overrides: Partial<HumanEntity> = {}): HumanEntity {
    return {
      entity: "human",
      facts: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: "2026-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("recurses into facts, topics, people, and quotes and strips their embeddings", () => {
    const human = makeHuman({
      facts: [makeFact({ id: "fact-1", embedding: [1] })],
      topics: [makeTopic({ id: "topic-1", embedding: [2] })],
      people: [makePerson({ id: "person-1", embedding: [3] })],
      quotes: [makeQuote({ id: "quote-1", embedding: [4] })],
    });

    const stripped = stripHumanEmbeddings(human);

    expect(stripped.facts[0]).not.toHaveProperty("embedding");
    expect(stripped.topics[0]).not.toHaveProperty("embedding");
    expect(stripped.people[0]).not.toHaveProperty("embedding");
    expect(stripped.quotes[0]).not.toHaveProperty("embedding");

    // Non-embedding fields survive the recursion unchanged.
    expect(stripped.facts[0]).toMatchObject({ id: "fact-1", name: "Birthday" });
    expect(stripped.topics[0]).toMatchObject({ id: "topic-1", name: "Woodworking" });
    expect(stripped.people[0]).toMatchObject({ id: "person-1", name: "Jamie" });
    expect(stripped.quotes[0]).toMatchObject({ id: "quote-1", text: "The lease bug is the real defect" });
  });

  it("preserves top-level HumanEntity fields untouched", () => {
    const human = makeHuman({ last_updated: "2026-02-02T00:00:00.000Z" });

    const stripped = stripHumanEmbeddings(human);

    expect(stripped.entity).toBe("human");
    expect(stripped.last_updated).toBe("2026-02-02T00:00:00.000Z");
  });

  it("defaults missing collections to empty arrays instead of throwing", () => {
    const human = {
      entity: "human",
      last_updated: "2026-01-01T00:00:00.000Z",
    } as unknown as HumanEntity;

    const stripped = stripHumanEmbeddings(human);

    expect(stripped.facts).toEqual([]);
    expect(stripped.topics).toEqual([]);
    expect(stripped.people).toEqual([]);
    expect(stripped.quotes).toEqual([]);
  });
});
