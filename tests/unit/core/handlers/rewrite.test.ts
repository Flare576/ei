import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,

  type LLMRequestState,
  type LLMResponse,
  type LLMRequest,
  type HumanEntity,
  type Fact,
  type Topic,
  type Person,
} from "../../../../src/core/types.js";

// Mock orchestrators (same shape as extraction.test.ts)
vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
}));

// Mock embedding service so handleRewriteRewrite can compute embeddings
vi.mock("../../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description: string }) =>
    `${name}: ${description}`,
}));

// Mock human-data-manager so searchHumanData can be controlled per-test
vi.mock("../../../../src/core/human-data-manager.js", () => ({
  searchHumanData: vi.fn().mockResolvedValue({
    facts: [], topics: [], people: [], quotes: [],
  }),
}));

import { handlers } from "../../../../src/core/handlers/index.js";
import { searchHumanData } from "../../../../src/core/human-data-manager.js";

// ---------------------------------------------------------------------------
// Helpers (mirroring extraction.test.ts patterns)
// ---------------------------------------------------------------------------

function createMockStateManager() {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
  };

  return {
    getHuman: vi.fn(() => human),
    setHuman: vi.fn((h: HumanEntity) => Object.assign(human, h)),
    human_fact_upsert: vi.fn((fact: Fact) => human.facts.push(fact)),
    human_topic_upsert: vi.fn((topic: Topic) => human.topics.push(topic)),
    human_person_upsert: vi.fn((person: Person) => human.people.push(person)),
    queue_enqueue: vi.fn(),
    _human: human,
  };
}

function createMockRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    id: "test-id",
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending" as LLMRequestState,
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandleRewriteScan,
    data: {
      itemId: "bloated-topic-1",
      itemType: "topic",
      rewriteModel: "TestProvider:test-model",
    },
    ...overrides,
  };
}

function seedBloatedTopic(state: ReturnType<typeof createMockStateManager>, id = "bloated-topic-1"): Topic {
  const topic: Topic = {
    id,
    name: "Software Engineering",
    description: "A".repeat(800), // over 750 threshold
    sentiment: 0.7,
    category: "Interest",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
    persona_groups: ["group-a"],
  };
  state._human.topics.push(topic);
  return topic;
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

function seedBloatedFact(state: ReturnType<typeof createMockStateManager>, id = "bloated-fact-1"): Fact {
  const fact: Fact = {
    id,
    name: "Coding Background",
    description: "A".repeat(800),
    sentiment: 0.7,
    validated_date: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    persona_groups: ["group-a"],
  };
  state._human.facts.push(fact);
  return fact;
}

// ---------------------------------------------------------------------------
// Phase 1 — handleRewriteScan
// ---------------------------------------------------------------------------

describe("Rewrite Handlers - Phase 1 (Scan)", () => {
  let state: ReturnType<typeof createMockStateManager>;
  beforeEach(() => {
    state = createMockStateManager();
    vi.mocked(searchHumanData).mockResolvedValue({
      facts: [], topics: [], people: [], quotes: [],
    });
    vi.clearAllMocks();
    // Re-register after clearAllMocks
    vi.mocked(searchHumanData).mockResolvedValue({
      facts: [], topics: [], people: [], quotes: [],
    });
  })

  describe("handleRewriteScan", () => {
    it("returns early when missing itemId", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteScan,
        data: { itemType: "fact", rewriteModel: "TestProvider:test-model" },
      });
      const response = createMockResponse(request, ["subject1"]);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("returns early when missing itemType", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteScan,
        data: { itemId: "bloated-fact-1", rewriteModel: "TestProvider:test-model" },
      });
      const response = createMockResponse(request, ["subject1"]);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("returns early when no subjects found (empty array) and item not in state", async () => {
      seedBloatedFact(state);
      const request = createMockRequest();
      const response = createMockResponse(request, []);

      await handlers.handleRewriteScan(response, state as any);

      expect(vi.mocked(searchHumanData)).not.toHaveBeenCalled();
      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("marks rewrite_checked=true on topic when no subjects found", async () => {
      seedBloatedTopic(state);
      const request = createMockRequest();
      const response = createMockResponse(request, []);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.human_topic_upsert).toHaveBeenCalledTimes(1);
      expect(state.human_topic_upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "bloated-topic-1", rewrite_checked: true })
      );
      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("marks rewrite_checked=true on person when no subjects found", async () => {
      const person: Person = {
        id: "bloated-person-1",
        name: "Alice",
        description: "A".repeat(800),
        sentiment: 0.5,
        relationship: "Friend",
        exposure_current: 0.5,
        exposure_desired: 0.5,
        last_updated: new Date().toISOString(),
      };
      state._human.people.push(person);
      const request = createMockRequest({
        data: { itemId: "bloated-person-1", itemType: "person", rewriteModel: "TestProvider:test-model" },
      });
      const response = createMockResponse(request, []);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.human_person_upsert).toHaveBeenCalledTimes(1);
      expect(state.human_person_upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "bloated-person-1", rewrite_checked: true })
      );
      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("returns early when subjects is not an array", async () => {
      seedBloatedFact(state);
      const request = createMockRequest();
      const response = createMockResponse(request, { subjects: ["not_an_array"] });

      await handlers.handleRewriteScan(response, state as any);

      expect(vi.mocked(searchHumanData)).not.toHaveBeenCalled();
      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("returns early when item no longer exists in human data", async () => {
      // Don't seed the fact — item with id "bloated-fact-1" won't be found
      const request = createMockRequest();
      const response = createMockResponse(request, ["programming", "databases"]);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("searches each subject and queues Phase 2", async () => {
      seedBloatedTopic(state);
      const request = createMockRequest();
      const response = createMockResponse(request, ["programming", "databases"]);

      await handlers.handleRewriteScan(response, state as any);

      expect(vi.mocked(searchHumanData)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(searchHumanData)).toHaveBeenCalledWith(state, "programming", expect.objectContaining({
        types: ["topic", "person"],
        limit: 4,
      }));
      expect(vi.mocked(searchHumanData)).toHaveBeenCalledWith(state, "databases", expect.objectContaining({
        types: ["topic", "person"],
        limit: 4,
      }));

      expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
      expect(state.queue_enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LLMRequestType.JSON,
          priority: LLMPriority.Normal,
          next_step: LLMNextStep.HandleRewriteRewrite,
          model: "TestProvider:test-model",
          data: { itemId: "bloated-topic-1", itemType: "topic" },
        })
      );
    });

    it("excludes original item from search results passed to Phase 2", async () => {
      const topic = seedBloatedTopic(state);
      const otherTopic: Topic = {
        id: "other-topic",
        name: "Other",
        description: "Other topic",
        sentiment: 0.5,
        category: "Interest",
        exposure_current: 0.3,
        exposure_desired: 0.5,
        last_updated: new Date().toISOString(),
      };

      vi.mocked(searchHumanData).mockResolvedValue({
        facts: [],
        topics: [topic, otherTopic],
        people: [],
        quotes: [],
      });

      const request = createMockRequest();
      const response = createMockResponse(request, ["programming"]);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
      const enqueued = state.queue_enqueue.mock.calls[0][0];
      expect(enqueued.system).toBeDefined();
      expect(enqueued.user).toBeDefined();
    });

    it("handles search failure gracefully — still queues Phase 2", async () => {
      seedBloatedTopic(state);
      vi.mocked(searchHumanData).mockRejectedValue(new Error("Search unavailable"));

      const request = createMockRequest();
      const response = createMockResponse(request, ["programming"]);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
    });

    it("passes rewriteModel through to Phase 2 queue item", async () => {
      seedBloatedTopic(state);
      const request = createMockRequest({
        data: {
          itemId: "bloated-topic-1",
          itemType: "topic",
          rewriteModel: "MyProvider:big-model",
        },
      });
      const response = createMockResponse(request, ["subject"]);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.queue_enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "MyProvider:big-model",
        })
      );
    });

    it("skips facts — facts are read-only and never rewritten", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        data: { itemId: "bloated-fact-1", itemType: "fact", rewriteModel: "TestProvider:test-model" },
      });
      const response = createMockResponse(request, ["subject"]);

      await handlers.handleRewriteScan(response, state as any);

      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — handleRewriteRewrite
// ---------------------------------------------------------------------------

describe("Rewrite Handlers - Phase 2 (Rewrite)", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  describe("handleRewriteRewrite", () => {
    it("returns early when missing itemId", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [{ id: "x", type: "fact", name: "X", description: "X desc" }],
        new: [],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    it("returns early when no changes returned", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, { existing: [], new: [] });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    it("returns early when result is null", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, null);
      response.parsed = undefined;

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    // --- Existing item updates ---

    it("skips existing item when id not found in human data", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [{
          id: "nonexistent-id",
          type: "fact",
          name: "Ghost",
          description: "This item doesn't exist",
        }],
        new: [],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    it("skips existing item with missing required fields", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [{
          id: "bloated-fact-1",
          type: "fact",
          name: "Has Name",
          // missing description
        }],
        new: [],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    // --- New item creation ---

    it("creates new topic with hard default exposure and category fallback", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "topic",
          name: "New Topic",
          description: "A new topic",
          sentiment: 0.4,
          // no category — should default to "Interest"
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_topic_upsert).toHaveBeenCalledTimes(1);
      const created = state.human_topic_upsert.mock.calls[0][0];
      expect(created.exposure_current).toBe(0.5);
      expect(created.exposure_desired).toBe(0.5);
      expect(created.category).toBe("Interest");
    });

    it("creates new person with hard default exposure and relationship fallback", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "person",
          name: "New Person",
          description: "A person mentioned",
          sentiment: 0.6,
          // no relationship — should default to "Unknown"
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_person_upsert).toHaveBeenCalledTimes(1);
      const created = state.human_person_upsert.mock.calls[0][0];
      expect(created.exposure_current).toBe(0.5);
      expect(created.exposure_desired).toBe(0.5);
      expect(created.relationship).toBe("Unknown");
    });

    it("skips new item with missing type", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          // missing type
          name: "No Type",
          description: "Item without type",
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
      expect(state.human_topic_upsert).not.toHaveBeenCalled();
      expect(state.human_person_upsert).not.toHaveBeenCalled();
    });

    it("skips new item with unknown type", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "alien_artifact",
          name: "Unknown Type",
          description: "Item with unknown type",
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
      expect(state.human_topic_upsert).not.toHaveBeenCalled();
      expect(state.human_person_upsert).not.toHaveBeenCalled();
    });

    it("inherits persona_groups from original topic item", async () => {
      const topic: Topic = {
        id: "bloated-topic-1",
        name: "Software Engineering",
        description: "A".repeat(800),
        sentiment: 0.7,
        last_updated: new Date().toISOString(),
        category: "Interest",
        exposure_current: 0.5,
        exposure_desired: 0.5,
        persona_groups: ["group-a"],
      };
      state._human.topics.push(topic);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-topic-1", itemType: "topic" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "topic",
          name: "Extracted Topic",
          description: "Extracted from bloated topic",
          sentiment: 0.5,
          category: "Interest",
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_topic_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          persona_groups: ["group-a"],
        })
      );
    });

    it("skips new item of type 'fact' — facts are read-only, created only by FactFinder", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "fact",
          name: "Would-be New Fact",
          description: "Facts are read-only; this should be skipped",
          sentiment: 0.5,
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
      expect(state.human_topic_upsert).not.toHaveBeenCalled();
      expect(state.human_person_upsert).not.toHaveBeenCalled();
    });

    it("processes both existing and new items in one response", async () => {
      const topic: Topic = {
        id: "bloated-topic-1",
        name: "Software Engineering",
        description: "A".repeat(800),
        sentiment: 0.7,
        last_updated: new Date().toISOString(),
        category: "Interest",
        exposure_current: 0.5,
        exposure_desired: 0.5,
      };
      state._human.topics.push(topic);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-topic-1", itemType: "topic" },
      });
      const response = createMockResponse(request, {
        existing: [{
          id: "bloated-topic-1",
          type: "topic",
          name: "Software Engineering (Focused)",
          description: "Focused description",
          sentiment: 0.7,
          category: "Interest",
        }],
        new: [{
          type: "person",
          name: "New Person From Rewrite",
          description: "Person mentioned in the topic",
          sentiment: 0.4,
          relationship: "coworker",
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_topic_upsert).toHaveBeenCalledTimes(2);
      expect(state.human_person_upsert).toHaveBeenCalledTimes(1);

      const updatedTopic = state.human_topic_upsert.mock.calls[0][0];
      expect(updatedTopic.name).toBe("Software Engineering (Focused)");

      const markingCall = state.human_topic_upsert.mock.calls[1][0];
      expect(markingCall.rewrite_checked).toBe(true);

      const newPerson = state.human_person_upsert.mock.calls[0][0];
      expect(newPerson.name).toBe("New Person From Rewrite");
      expect(newPerson.relationship).toBe("coworker");
    });

    it("marks rewrite_checked=true on original topic after processing completes", async () => {
      seedBloatedTopic(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-topic-1", itemType: "topic" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "topic",
          name: "Split Topic",
          description: "Content split out of original",
          sentiment: 0.5,
          category: "Interest",
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      const markingCall = state.human_topic_upsert.mock.calls.find(
        ([t]: [Topic]) => t.id === "bloated-topic-1" && t.rewrite_checked === true
      );
      expect(markingCall).toBeDefined();
    });

    it("marks rewrite_checked=true on original person after processing completes", async () => {
      const person: Person = {
        id: "bloated-person-1",
        name: "Alice",
        description: "A".repeat(800),
        sentiment: 0.5,
        relationship: "Friend",
        exposure_current: 0.5,
        exposure_desired: 0.5,
        last_updated: new Date().toISOString(),
      };
      state._human.people.push(person);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-person-1", itemType: "person" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "topic",
          name: "Topic from person",
          description: "Content split out",
          sentiment: 0.5,
          category: "Interest",
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      const markingCall = state.human_person_upsert.mock.calls.find(
        ([p]: [Person]) => p.id === "bloated-person-1" && p.rewrite_checked === true
      );
      expect(markingCall).toBeDefined();
    });
  });
});
