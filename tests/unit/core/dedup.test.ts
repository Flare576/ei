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
import type { StateManager } from "../../../src/core/state-manager.js";

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
    last_activity: new Date().toISOString(),
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
      entity_type: "fact",
      entity_ids: ["fact-1", "fact-2"],
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

  it("handles missing entities gracefully", async () => {
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

    // Execute handler
    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    // Should not crash, just log warnings
    expect(state.human_fact_upsert).not.toHaveBeenCalled();
    expect(state.human_fact_remove).not.toHaveBeenCalled();
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

  it("handles parsing errors gracefully", async () => {
    const request = createMockRequest();
    const response = createMockResponse(request, null, false);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    // Should not crash or call any state methods
    expect(state.human_fact_upsert).not.toHaveBeenCalled();
    expect(state.human_fact_remove).not.toHaveBeenCalled();
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
});
