import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  ValidationLevel,

  type LLMResponse,
  type LLMRequest,
  type HumanEntity,
  type Fact,
  type Trait,
  type Topic,
  type Person,
} from "../../../../src/core/types.js";

// Mock orchestrators (same shape as extraction.test.ts)
vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueItemMatch: vi.fn().mockResolvedValue(1),
  queueItemUpdate: vi.fn(),
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
    facts: [], traits: [], topics: [], people: [], quotes: [],
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
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  };

  return {
    getHuman: vi.fn(() => human),
    setHuman: vi.fn((h: HumanEntity) => Object.assign(human, h)),
    human_fact_upsert: vi.fn((fact: Fact) => human.facts.push(fact)),
    human_trait_upsert: vi.fn((trait: Trait) => human.traits.push(trait)),
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
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandleRewriteScan,
    data: {
      itemId: "bloated-fact-1",
      itemType: "fact",
      rewriteModel: "TestProvider:test-model",
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

/** Seed a bloated fact into the state manager's human data. */
function seedBloatedFact(state: ReturnType<typeof createMockStateManager>, id = "bloated-fact-1"): Fact {
  const fact: Fact = {
    id,
    name: "Coding Background",
    description: "A".repeat(800), // over 750 threshold
    sentiment: 0.7,
    validated: ValidationLevel.None,
    validated_date: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    persona_groups: ["group-a"],
  };
  state._human.facts.push(fact);
  return fact;
}

function seedBloatedTrait(state: ReturnType<typeof createMockStateManager>, id = "bloated-trait-1"): Trait {
  const trait: Trait = {
    id,
    name: "Curiosity",
    description: "B".repeat(800),
    sentiment: 0.6,
    strength: 0.8,
    last_updated: new Date().toISOString(),
    persona_groups: ["group-a"],
  };
  state._human.traits.push(trait);
  return trait;
}

// ---------------------------------------------------------------------------
// Phase 1 — handleRewriteScan
// ---------------------------------------------------------------------------

describe("Rewrite Handlers - Phase 1 (Scan)", () => {
  let state: ReturnType<typeof createMockStateManager>;
  beforeEach(() => {
    state = createMockStateManager();
    vi.mocked(searchHumanData).mockResolvedValue({
      facts: [], traits: [], topics: [], people: [], quotes: [],
    });
    vi.clearAllMocks();
    // Re-register after clearAllMocks
    vi.mocked(searchHumanData).mockResolvedValue({
      facts: [], traits: [], topics: [], people: [], quotes: [],
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

    it("returns early when no subjects found (empty array)", async () => {
      seedBloatedFact(state);
      const request = createMockRequest();
      const response = createMockResponse(request, []);

      await handlers.handleRewriteScan(response, state as any);

      expect(vi.mocked(searchHumanData)).not.toHaveBeenCalled();
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
      const fact = seedBloatedFact(state);
      const request = createMockRequest();
      const response = createMockResponse(request, ["programming", "databases"]);

      await handlers.handleRewriteScan(response, state as any);

      // Should search for each subject
      expect(vi.mocked(searchHumanData)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(searchHumanData)).toHaveBeenCalledWith(state, "programming", expect.objectContaining({
        types: ["fact", "trait", "topic", "person"],
        limit: 4,
      }));
      expect(vi.mocked(searchHumanData)).toHaveBeenCalledWith(state, "databases", expect.objectContaining({
        types: ["fact", "trait", "topic", "person"],
        limit: 4,
      }));

      // Should queue Phase 2
      expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
      expect(state.queue_enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: LLMRequestType.JSON,
          priority: LLMPriority.Normal,
          next_step: LLMNextStep.HandleRewriteRewrite,
          model: "TestProvider:test-model",
          data: { itemId: "bloated-fact-1", itemType: "fact" },
        })
      );
    });

    it("excludes original item from search results passed to Phase 2", async () => {
      const fact = seedBloatedFact(state);
      // Search returns the original item plus others
      const otherFact: Fact = {
        id: "other-fact",
        name: "Other",
        description: "Other fact",
        sentiment: 0.5,
        validated: ValidationLevel.None,
        last_updated: new Date().toISOString(),
      };

      vi.mocked(searchHumanData).mockResolvedValue({
        facts: [fact, otherFact],
        traits: [],
        topics: [],
        people: [],
        quotes: [],
      });

      const request = createMockRequest();
      const response = createMockResponse(request, ["programming"]);

      await handlers.handleRewriteScan(response, state as any);

      // Phase 2 should be queued — the prompt builder receives subject matches
      // The handler filters out the original item, so it won't be in the prompt
      expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
      const enqueued = state.queue_enqueue.mock.calls[0][0];
      // The prompt is built from subjectMatches which exclude the original.
      // We can verify the prompt was generated (system and user are strings).
      expect(enqueued.system).toBeDefined();
      expect(enqueued.user).toBeDefined();
    });

    it("handles search failure gracefully — still queues Phase 2", async () => {
      seedBloatedFact(state);
      vi.mocked(searchHumanData).mockRejectedValue(new Error("Search unavailable"));

      const request = createMockRequest();
      const response = createMockResponse(request, ["programming"]);

      await handlers.handleRewriteScan(response, state as any);

      // Should still queue Phase 2, just with empty matches
      expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
    });

    it("passes rewriteModel through to Phase 2 queue item", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        data: {
          itemId: "bloated-fact-1",
          itemType: "fact",
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

    it("updates existing fact with new name and description", async () => {
      const fact = seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [{
          id: "bloated-fact-1",
          type: "fact",
          name: "Coding Background (Focused)",
          description: "Focused description of coding background",
          sentiment: 0.8,
        }],
        new: [],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).toHaveBeenCalledTimes(1);
      expect(state.human_fact_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "bloated-fact-1",
          name: "Coding Background (Focused)",
          description: "Focused description of coding background",
          sentiment: 0.8,
        })
      );
    });

    it("updates existing trait preserving strength from original when LLM omits it", async () => {
      seedBloatedTrait(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-trait-1", itemType: "trait" },
      });
      const response = createMockResponse(request, {
        existing: [{
          id: "bloated-trait-1",
          type: "trait",
          name: "Curiosity (Refined)",
          description: "Refined curiosity description",
          // No sentiment or strength — should fall back to existing values
        }],
        new: [],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_trait_upsert).toHaveBeenCalledTimes(1);
      const calledWith = state.human_trait_upsert.mock.calls[0][0];
      expect(calledWith.name).toBe("Curiosity (Refined)");
      expect(calledWith.strength).toBe(0.8); // preserved from original
      expect(calledWith.sentiment).toBe(0.6); // preserved from original
    });

    it("resolves type from existing records, not from LLM response", async () => {
      // Seed a fact, but LLM says it's a "trait" — handler should resolve to "fact"
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [{
          id: "bloated-fact-1",
          type: "trait", // LLM lies about type
          name: "Updated Name",
          description: "Updated desc",
        }],
        new: [],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      // Should call fact_upsert, not trait_upsert, because the item is actually a fact
      expect(state.human_fact_upsert).toHaveBeenCalledTimes(1);
      expect(state.human_trait_upsert).not.toHaveBeenCalled();
    });

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

    it("creates new fact with correct fields", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "fact",
          name: "New Extracted Fact",
          description: "A new fact extracted from the bloated item",
          sentiment: 0.5,
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).toHaveBeenCalledTimes(1);
      expect(state.human_fact_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Extracted Fact",
          description: "A new fact extracted from the bloated item",
          sentiment: 0.5,
          validated: ValidationLevel.None,
          learned_by: "ei",
        })
      );
      // Should have an auto-generated id
      const created = state.human_fact_upsert.mock.calls[0][0];
      expect(created.id).toBeDefined();
      expect(typeof created.id).toBe("string");
    });

    it("creates new trait with default strength when LLM omits it", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "trait",
          name: "New Trait",
          description: "A new trait",
          sentiment: 0.3,
          // no strength — should default to 0.5
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_trait_upsert).toHaveBeenCalledTimes(1);
      const created = state.human_trait_upsert.mock.calls[0][0];
      expect(created.strength).toBe(0.5);
    });

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
      expect(state.human_trait_upsert).not.toHaveBeenCalled();
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
      expect(state.human_trait_upsert).not.toHaveBeenCalled();
      expect(state.human_topic_upsert).not.toHaveBeenCalled();
      expect(state.human_person_upsert).not.toHaveBeenCalled();
    });

    it("inherits persona_groups from original item", async () => {
      const fact = seedBloatedFact(state);
      // fact.persona_groups is ["group-a"] from seedBloatedFact
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [],
        new: [{
          type: "fact",
          name: "Extracted Fact",
          description: "Extracted from bloated item",
          sentiment: 0.5,
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          persona_groups: ["group-a"],
        })
      );
    });

    it("processes both existing and new items in one response", async () => {
      seedBloatedFact(state);
      const request = createMockRequest({
        next_step: LLMNextStep.HandleRewriteRewrite,
        data: { itemId: "bloated-fact-1", itemType: "fact" },
      });
      const response = createMockResponse(request, {
        existing: [{
          id: "bloated-fact-1",
          type: "fact",
          name: "Focused Original",
          description: "Focused description",
          sentiment: 0.7,
        }],
        new: [{
          type: "topic",
          name: "New Topic From Rewrite",
          description: "Spun off from bloated fact",
          sentiment: 0.4,
          category: "Skill",
        }],
      });

      await handlers.handleRewriteRewrite(response, state as any);

      expect(state.human_fact_upsert).toHaveBeenCalledTimes(1);
      expect(state.human_topic_upsert).toHaveBeenCalledTimes(1);

      const updatedFact = state.human_fact_upsert.mock.calls[0][0];
      expect(updatedFact.name).toBe("Focused Original");

      const newTopic = state.human_topic_upsert.mock.calls[0][0];
      expect(newTopic.name).toBe("New Topic From Rewrite");
      expect(newTopic.category).toBe("Skill");
    });
  });
});
