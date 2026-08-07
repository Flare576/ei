import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMResponse,
  type LLMRequest,
  type HumanEntity,
  type Fact,
  type Topic,
  type Person,
  type PersonIdentifier,
  type Quote,
} from "../../../src/core/types.js";

// Mock orchestrators
vi.mock("../../../src/core/orchestrators/index.js", () => ({}));

// Mock embedding service
vi.mock("../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description: string }) =>
    `${name}: ${description}`,
}));

import { handlers } from "../../../src/core/handlers/index.js";
import { StateManager } from "../../../src/core/state-manager.js";
import { createMockStorage } from "../../helpers/mock-storage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStateManager(): StateManager & { _human: HumanEntity } {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    settings: {
      rewrite_model: "test-provider:test-model",
    },
  };

  return {
    getHuman: vi.fn(() => human),
    setHuman: vi.fn((h: HumanEntity) => Object.assign(human, h)),
    human_fact_upsert: vi.fn((fact: Fact) => {
      const idx = human.facts.findIndex(f => f.id === fact.id);
      if (idx >= 0) human.facts[idx] = fact;
      else human.facts.push(fact);
    }),
    human_topic_upsert: vi.fn((topic: Topic) => {
      const idx = human.topics.findIndex(t => t.id === topic.id);
      if (idx >= 0) human.topics[idx] = topic;
      else human.topics.push(topic);
    }),
    human_person_upsert: vi.fn((person: Person) => {
      const idx = human.people.findIndex(p => p.id === person.id);
      if (idx >= 0) human.people[idx] = person;
      else human.people.push(person);
    }),
    human_fact_remove: vi.fn((id: string) => {
      const idx = human.facts.findIndex(f => f.id === id);
      if (idx >= 0) human.facts.splice(idx, 1);
    }),
    human_topic_remove: vi.fn((id: string) => {
      const idx = human.topics.findIndex(t => t.id === id);
      if (idx >= 0) human.topics.splice(idx, 1);
    }),
    human_person_remove: vi.fn((id: string) => {
      const idx = human.people.findIndex(p => p.id === id);
      if (idx >= 0) human.people.splice(idx, 1);
    }),
    human_quote_update: vi.fn((quoteId: string, updates: Partial<Quote>) => {
      const idx = human.quotes.findIndex(q => q.id === quoteId);
      if (idx >= 0) {
        human.quotes[idx] = { ...human.quotes[idx], ...updates };
      }
    }),
    queue_enqueue: vi.fn(),
    queue_length: vi.fn(() => 0),
    _human: human,
  } as unknown as StateManager & { _human: HumanEntity };
}

function createMockRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    id: "test-dedup-request",
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending",
    type: LLMRequestType.JSON,
    priority: LLMPriority.Normal,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandleDedupCurate,
    data: {
      entity_type: "topic",
      entity_ids: ["topic-1", "topic-2"],
      ceremony_progress: 1,
    },
    ...overrides,
  };
}

function createMockResponse(
  request: LLMRequest,
  parsed: unknown,
  success = true
): LLMResponse {
  return {
    request,
    success,
    content: success ? JSON.stringify(parsed) : null,
    parsed: success ? parsed : undefined,
    error: success ? undefined : "Test error",
  };
}

/** Create a fact with embedding for similarity tests */
function createFactWithEmbedding(
  id: string,
  name: string,
  description: string,
  embedding: number[]
): Fact {
  return {
    id,
    name,
    description,
    sentiment: 0.5,
    validated_date: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    persona_groups: [],
    embedding,
  };
}

function createTopicWithEmbedding(
  id: string,
  name: string,
  description: string,
  embedding: number[],
  category = "Interest"
): Topic {
  return {
    id,
    name,
    description,
    sentiment: 0.5,
    category,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
    persona_groups: [],
    embedding,
  };
}

// ---------------------------------------------------------------------------
// handleDedupCurate (Handler)
// ---------------------------------------------------------------------------

describe("Dedup Handler - handleDedupCurate", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("throws on invalid entity_type", async () => {
    const request = createMockRequest({
      data: {
        entity_type: "fact",
        entity_ids: ["missing-1", "missing-2"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [{ id: "missing-1", description: "Updated description" }],
      remove: ["missing-2"],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await expect(
      handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager)
    ).rejects.toThrow('[Dedup] Invalid entity_type: "fact"');
  });

  it("updates entity descriptions with embedding recalculation", async () => {
    const topic1 = createTopicWithEmbedding(
      "topic-1",
      "Original Name",
      "Original description",
      new Array(384).fill(0.1)
    );

    state._human.topics = [topic1];

    const request = createMockRequest({
      data: {
        entity_type: "topic",
        entity_ids: ["topic-1"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [
        {
          id: "topic-1",
          description: "Updated description after merge",
        },
      ],
      remove: [],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_topic_upsert).toHaveBeenCalledTimes(1);
    expect(state.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "topic-1",
        name: "Original Name",
        description: "Updated description after merge",
      })
    );
  });

  it("removes entities after updating quote foreign keys", async () => {
    const topic1 = createTopicWithEmbedding("topic-1", "Keep", "Primary topic", []);
    const topic2 = createTopicWithEmbedding("topic-2", "Remove", "Duplicate topic", []);

    const quote1: Quote = {
      id: "quote-1",
      message_id: null,
      data_item_ids: ["topic-2"],
      persona_groups: [],
      text: "Test quote",
      speaker: "human",
      timestamp: new Date().toISOString(),
      start: null,
      end: null,
      created_at: new Date().toISOString(),
      created_by: "human",
    };

    state._human.topics = [topic1, topic2];
    state._human.quotes = [quote1];

    const request = createMockRequest({
      data: {
        entity_type: "topic",
        entity_ids: ["topic-1", "topic-2"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [],
      remove: [{ to_be_removed: "topic-2", replaced_by: "topic-1" }],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_quote_update).toHaveBeenCalledWith(
      "quote-1",
      expect.objectContaining({
        data_item_ids: ["topic-1"],
      })
    );

    expect(state.human_topic_remove).toHaveBeenCalledWith("topic-2");
  });

  it("adds new merged entities with embeddings (topics)", async () => {
    const request = createMockRequest({
      data: {
        entity_type: "topic",
        entity_ids: ["topic-1", "topic-2"],
        ceremony_progress: 1,
      },
    });

    const topic1 = createTopicWithEmbedding("topic-1", "Topic 1", "First topic", []);
    const topic2 = createTopicWithEmbedding("topic-2", "Topic 2", "Second topic", []);

    state._human.topics = [topic1, topic2];

    const dedupResult = {
      update: [],
      remove: [
        { to_be_removed: "topic-1", replaced_by: "" },
        { to_be_removed: "topic-2", replaced_by: "" },
      ],
      add: [
        {
          name: "Merged Topic",
          description: "Combined from topic-1 and topic-2",
          sentiment: 0.7,
          category: "Interest",
        },
      ],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_topic_upsert).toHaveBeenCalledTimes(1);
    expect(state.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Merged Topic",
        description: "Combined from topic-1 and topic-2",
        id: expect.any(String),
        embedding: expect.any(Array),
      })
    );
  });

  it("deduplicates multiple quotes pointing to same removed entity", async () => {
    const topic1 = createTopicWithEmbedding("topic-1", "Keep", "Primary", []);
    const topic2 = createTopicWithEmbedding("topic-2", "Remove", "Duplicate", []);

    const quote1: Quote = {
      id: "quote-1",
      message_id: null,
      data_item_ids: ["topic-2"],
      persona_groups: [],
      text: "Quote 1",
      speaker: "human",
      timestamp: new Date().toISOString(),
      start: null,
      end: null,
      created_at: new Date().toISOString(),
      created_by: "human",
    };

    const quote2: Quote = {
      id: "quote-2",
      message_id: null,
      data_item_ids: ["topic-2"],
      persona_groups: [],
      text: "Quote 2",
      speaker: "human",
      timestamp: new Date().toISOString(),
      start: null,
      end: null,
      created_at: new Date().toISOString(),
      created_by: "human",
    };

    state._human.topics = [topic1, topic2];
    state._human.quotes = [quote1, quote2];

    const request = createMockRequest({
      data: {
        entity_type: "topic",
        entity_ids: ["topic-1", "topic-2"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [],
      remove: [{ to_be_removed: "topic-2", replaced_by: "topic-1" }],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_quote_update).toHaveBeenCalledTimes(2);
  });

  it("throws on parsing errors", async () => {
    const request = createMockRequest();
    const response = createMockResponse(request, null, false);

    await expect(
      handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager)
    ).rejects.toThrow("[Dedup] Failed to parse Opus response");
  });

  it("handles empty dedup result gracefully", async () => {
    const request = createMockRequest();
    const dedupResult = { update: [], remove: [], add: [] };
    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    // Should complete without errors
    expect(state.human_fact_upsert).not.toHaveBeenCalled();
    expect(state.human_fact_remove).not.toHaveBeenCalled();
  });

  it("preserves unchanged fields during updates", async () => {
    const topic1: Topic = {
      id: "topic-1",
      name: "Original Name",
      description: "Original description",
      sentiment: 0.8,
      category: "Interest",
      exposure_current: 0.6,
      exposure_desired: 0.7,
      last_updated: "2026-01-01T00:00:00Z",
      persona_groups: ["group-a", "group-b"],
      embedding: new Array(384).fill(0.1),
    };

    state._human.topics = [topic1];

    const request = createMockRequest({
      data: {
        entity_type: "topic",
        entity_ids: ["topic-1"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [{ id: "topic-1", description: "Updated description" }],
      remove: [],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_topic_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "topic-1",
        name: "Original Name",
        description: "Updated description",
        sentiment: 0.8,
        persona_groups: ["group-a", "group-b"],
      })
    );
  });

  it("drops quote links to already-merged entities in cascade dedup", async () => {
    const topicC = createTopicWithEmbedding("topic-c", "Survivor", "The last one standing", []);
    const topicB = createTopicWithEmbedding("topic-b", "Intermediate", "Gets removed in this call", []);

    const quote: Quote = {
      id: "quote-1",
      message_id: null,
      data_item_ids: ["topic-b"],
      persona_groups: [],
      text: "it's not impossible to add those features.",
      speaker: "human",
      timestamp: new Date().toISOString(),
      start: null,
      end: null,
      created_at: new Date().toISOString(),
      created_by: "human",
    };

    state._human.topics = [topicB, topicC];
    state._human.quotes = [quote];

    const request = createMockRequest({
      data: {
        entity_type: "topic",
        entity_ids: ["topic-b", "topic-c"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [{ id: "topic-c", name: "Survivor", description: "The last one standing" }],
      remove: [{ to_be_removed: "topic-b", replaced_by: "topic-a" }],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_quote_update).toHaveBeenCalledWith(
      "quote-1",
      expect.objectContaining({
        data_item_ids: [],
      })
    );
  });
});

// ---------------------------------------------------------------------------
// IRQ-4 / ADR-006 / ADR-010 — dedup's person-identifier union must not
// reintroduce a duplicate Persona link, even though neither donor alone
// violated it. Uses a REAL StateManager (not the lightweight mock above)
// so this exercises the actual guardPersonaLinks call inside
// human_person_upsert, not just that dedup.ts calls it with some args.
// ---------------------------------------------------------------------------
describe("Dedup Handler - handleDedupCurate — persona-link guard on the identifier union", () => {
  const PERSONA_A = "11111111-1111-4111-8111-111111111111";
  const PERSONA_B = "22222222-2222-4222-8222-222222222222";

  async function createRealState(): Promise<StateManager> {
    const sm = new StateManager();
    await sm.initialize(createMockStorage());
    return sm;
  }

  function makeLinkedPerson(id: string, name: string, identifiers: PersonIdentifier[] = []): Person {
    return {
      id,
      name,
      description: `${name}'s description`,
      relationship: "friend",
      sentiment: 0,
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: "",
      identifiers,
    };
  }

  it("a survivor legally inherits its one donor's link — excludeIds prevents a false B-many against the still-present donor (update-before-remove ordering)", async () => {
    const sm = await createRealState();
    sm.human_person_upsert(makeLinkedPerson("survivor", "Survivor"));
    sm.human_person_upsert(makeLinkedPerson("donor", "Donor", [{ type: "Ei Persona", value: PERSONA_A }]));

    const request = createMockRequest({
      data: { entity_type: "person", entity_ids: ["survivor", "donor"], ceremony_progress: 1 },
    });
    const dedupResult = {
      update: [{ id: "survivor", name: "Survivor", description: "Survivor's description" }],
      remove: [{ to_be_removed: "donor", replaced_by: "survivor" }],
      add: [],
    };
    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, sm);

    expect(sm.getHuman().people.find((p) => p.id === "survivor")?.identifiers).toEqual([
      { type: "Ei Persona", value: PERSONA_A },
    ]);
    // Phase 3 really did remove the donor — this isn't merely a lucky
    // ordering where the donor was gone before the guard ever ran.
    expect(sm.getHuman().people.find((p) => p.id === "donor")).toBeUndefined();
  });

  it("a union of two independently-linked donors merging into a link-less survivor keeps neither link — the guard never picks a winner", async () => {
    const sm = await createRealState();
    sm.human_person_upsert(makeLinkedPerson("survivor", "Survivor"));
    sm.human_person_upsert(makeLinkedPerson("donorA", "DonorA", [{ type: "Ei Persona", value: PERSONA_A }]));
    sm.human_person_upsert(makeLinkedPerson("donorB", "DonorB", [{ type: "Ei Persona", value: PERSONA_B }]));

    const request = createMockRequest({
      data: { entity_type: "person", entity_ids: ["survivor", "donorA", "donorB"], ceremony_progress: 1 },
    });
    const dedupResult = {
      update: [{ id: "survivor", name: "Survivor", description: "Survivor's description" }],
      remove: [
        { to_be_removed: "donorA", replaced_by: "survivor" },
        { to_be_removed: "donorB", replaced_by: "survivor" },
      ],
      add: [],
    };
    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, sm);

    expect(sm.getHuman().people.find((p) => p.id === "survivor")?.identifiers).toEqual([]);
  });

  it("a survivor that ALREADY carries a link keeps it over a donor's independently-linked arrival", async () => {
    const sm = await createRealState();
    sm.human_person_upsert(makeLinkedPerson("survivor", "Survivor", [{ type: "Ei Persona", value: PERSONA_A }]));
    sm.human_person_upsert(makeLinkedPerson("donor", "Donor", [{ type: "Ei Persona", value: PERSONA_B }]));

    const request = createMockRequest({
      data: { entity_type: "person", entity_ids: ["survivor", "donor"], ceremony_progress: 1 },
    });
    const dedupResult = {
      update: [{ id: "survivor", name: "Survivor", description: "Survivor's description" }],
      remove: [{ to_be_removed: "donor", replaced_by: "survivor" }],
      add: [],
    };
    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, sm);

    expect(sm.getHuman().people.find((p) => p.id === "survivor")?.identifiers).toEqual([
      { type: "Ei Persona", value: PERSONA_A },
    ]);
  });
});
