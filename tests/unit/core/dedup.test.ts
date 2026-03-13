import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMResponse,
  type LLMRequest,
  type HumanEntity,
  type Fact,
  type Trait,
  type Topic,
  type Person,
  type Quote,
} from "../../../src/core/types.js";

// Mock orchestrators
vi.mock("../../../src/core/orchestrators/index.js", () => ({
  queueItemMatch: vi.fn().mockResolvedValue(1),
}));

// Mock embedding service
vi.mock("../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description: string }) =>
    `${name}: ${description}`,
}));

import { handlers } from "../../../src/core/handlers/index.js";
import { queueDedupPhase } from "../../../src/core/orchestrators/dedup-phase.js";
import type { StateManager } from "../../../src/core/state-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStateManager(): StateManager & { _human: HumanEntity } {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    traits: [],
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
    human_trait_upsert: vi.fn((trait: Trait) => {
      const idx = human.traits.findIndex(t => t.id === trait.id);
      if (idx >= 0) human.traits[idx] = trait;
      else human.traits.push(trait);
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
    human_trait_remove: vi.fn((id: string) => {
      const idx = human.traits.findIndex(t => t.id === id);
      if (idx >= 0) human.traits.splice(idx, 1);
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

/** Create a person with embedding for similarity tests */
function createPersonWithEmbedding(
  id: string,
  name: string,
  description: string,
  embedding: number[],
  relationship = "Friend"
): Person {
  return {
    id,
    name,
    description,
    sentiment: 0.5,
    relationship,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
    persona_groups: [],
    embedding,
  };
}

// ---------------------------------------------------------------------------
// Phase 1 — queueDedupPhase (Clustering)
// ---------------------------------------------------------------------------

describe("Dedup Phase - Clustering", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("finds no duplicates when threshold not met", async () => {
    // Create two facts with low similarity (orthogonal vectors)
    const fact1 = createFactWithEmbedding(
      "fact-1",
      "Python",
      "I code in Python",
      new Array(384).fill(1).map((_, i) => (i % 2 === 0 ? 1 : 0))
    );
    const fact2 = createFactWithEmbedding(
      "fact-2",
      "JavaScript",
      "I code in JavaScript",
      new Array(384).fill(1).map((_, i) => (i % 2 === 0 ? 0 : 1))
    );

    state._human.facts = [fact1, fact2];

    await queueDedupPhase(state as unknown as StateManager);

    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("finds duplicates when threshold met", async () => {
    // Create two facts with high similarity (nearly identical vectors)
    const baseVector = new Array(384).fill(0.5);
    const fact1 = createFactWithEmbedding(
      "fact-1",
      "Python Developer",
      "I am a Python developer",
      baseVector
    );
    const fact2 = createFactWithEmbedding(
      "fact-2",
      "Python Coder",
      "I code in Python professionally",
      baseVector.map(v => v * 0.99) // 99% similar
    );

    state._human.facts = [fact1, fact2];

    await queueDedupPhase(state as unknown as StateManager);

    expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Normal,
        next_step: LLMNextStep.HandleDedupCurate,
      })
    );
  });

  it("clusters transitive duplicates (A→B, B→C forms one cluster)", async () => {
    // Three facts: A similar to B, B similar to C, but A not similar to C
    const vecA = new Array(384).fill(0.5);
    const vecB = vecA.map(v => v * 0.98); // 98% similar to A
    const vecC = vecB.map(v => v * 0.98); // 98% similar to B, ~96% to A

    const factA = createFactWithEmbedding("fact-a", "A", "Item A", vecA);
    const factB = createFactWithEmbedding("fact-b", "B", "Item B", vecB);
    const factC = createFactWithEmbedding("fact-c", "C", "Item C", vecC);

    state._human.facts = [factA, factB, factC];

    await queueDedupPhase(state as unknown as StateManager);

    // Should create ONE cluster with all three IDs
    expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
    const request = vi.mocked(state.queue_enqueue).mock.calls[0][0];
    expect(request.data.entity_ids).toHaveLength(3);
    expect(request.data.entity_ids).toContain("fact-a");
    expect(request.data.entity_ids).toContain("fact-b");
    expect(request.data.entity_ids).toContain("fact-c");
  });

  it("creates separate clusters for disjoint groups", async () => {
    // Group 1: A ↔ B (high similarity)
    const vecA = new Array(384).fill(0.5);
    const vecB = vecA.map(v => v * 0.99);

    // Group 2: X ↔ Y (high similarity, but unrelated to A/B)
    const vecX = new Array(384).fill(-0.5); // Negative values, orthogonal to A/B
    const vecY = vecX.map(v => v * 0.99);

    const factA = createFactWithEmbedding("fact-a", "A", "Group 1 A", vecA);
    const factB = createFactWithEmbedding("fact-b", "B", "Group 1 B", vecB);
    const factX = createFactWithEmbedding("fact-x", "X", "Group 2 X", vecX);
    const factY = createFactWithEmbedding("fact-y", "Y", "Group 2 Y", vecY);

    state._human.facts = [factA, factB, factX, factY];

    await queueDedupPhase(state as unknown as StateManager);

    // Should create TWO clusters
    expect(state.queue_enqueue).toHaveBeenCalledTimes(2);
  });

  it("rejects clusters exceeding size limit (50)", async () => {
    // Create 51 nearly identical facts
    const baseVector = new Array(384).fill(0.5);
    const facts = Array.from({ length: 51 }, (_, i) =>
      createFactWithEmbedding(
        `fact-${i}`,
        `Fact ${i}`,
        `Description ${i}`,
        baseVector.map(v => v * (1 - i * 0.001)) // Slight variations
      )
    );

    state._human.facts = facts;

    await queueDedupPhase(state as unknown as StateManager);

    // Should reject the cluster (size > 50)
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("rejects clusters with spread > 10%", async () => {
    // Create three facts with cosine similarity spread > 10%
    // vecA: baseline
    const vecA = new Array(384).fill(0).map((_, i) => i % 2 === 0 ? 1 : 0);
    // vecB: high similarity to A (~0.96)
    const vecB = vecA.map((v, i) => i % 3 === 0 ? 1 - v : v);
    // vecC: lower similarity to A (~0.82), creating spread of 0.14
    const vecC = vecA.map((v, i) => i % 2 === 0 ? 0 : 1);

    const factA = createFactWithEmbedding("fact-a", "A", "Item A", vecA);
    const factB = createFactWithEmbedding("fact-b", "B", "Item B", vecB);
    const factC = createFactWithEmbedding("fact-c", "C", "Item C", vecC);

    state._human.facts = [factA, factB, factC];

    await queueDedupPhase(state as unknown as StateManager);

    // Cluster should be rejected due to spread (maxSim - minSim > 0.10)
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("skips entities marked as Persona relationship", async () => {
    const baseVector = new Array(384).fill(0.5);
    const person1 = createPersonWithEmbedding(
      "person-1",
      "Normal Person",
      "Regular person",
      baseVector,
      "Friend"
    );
    const person2 = createPersonWithEmbedding(
      "person-2",
      "Persona Person",
      "Persona relationship",
      baseVector,
      "Persona"
    );

    state._human.people = [person1, person2];

    await queueDedupPhase(state as unknown as StateManager);

    // Should not queue anything (person2 has Persona relationship)
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("handles empty entity list gracefully", async () => {
    state._human.facts = [];
    state._human.traits = [];
    state._human.topics = [];
    state._human.people = [];

    await queueDedupPhase(state as unknown as StateManager);

    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("handles entities without embeddings gracefully", async () => {
    const fact1: Fact = {
      id: "fact-1",
      name: "No Embedding",
      description: "This fact has no embedding",
      sentiment: 0.5,
      validated_date: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      persona_groups: [],
      // NO embedding field
    };

    state._human.facts = [fact1];

    await queueDedupPhase(state as unknown as StateManager);

    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — handleDedupCurate (Handler)
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
    const fact1 = createFactWithEmbedding(
      "fact-1",
      "Original Name",
      "Original description",
      new Array(384).fill(0.1)
    );

    state._human.facts = [fact1];

    const request = createMockRequest({
      data: {
        entity_type: "fact",
        entity_ids: ["fact-1"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [
        {
          id: "fact-1",
          description: "Updated description after merge",
        },
      ],
      remove: [],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_fact_upsert).toHaveBeenCalledTimes(1);
    expect(state.human_fact_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fact-1",
        name: "Original Name", // Name preserved
        description: "Updated description after merge",
      })
    );
  });

  it("removes entities after updating quote foreign keys", async () => {
    const fact1 = createFactWithEmbedding("fact-1", "Keep", "Primary fact", []);
    const fact2 = createFactWithEmbedding("fact-2", "Remove", "Duplicate fact", []);

    const quote1: Quote = {
      id: "quote-1",
      message_id: null,
      data_item_ids: ["fact-2"], // Points to fact being removed
      persona_groups: [],
      text: "Test quote",
      speaker: "human",
      timestamp: new Date().toISOString(),
      start: null,
      end: null,
      created_at: new Date().toISOString(),
      created_by: "human",
    };

    state._human.facts = [fact1, fact2];
    state._human.quotes = [quote1];

    const request = createMockRequest({
      data: {
        entity_type: "fact",
        entity_ids: ["fact-1", "fact-2"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [],
      remove: [{ to_be_removed: "fact-2", replaced_by: "fact-1" }],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    // Quote should have been updated to point to remaining entity
    expect(state.human_quote_update).toHaveBeenCalledWith(
      "quote-1",
      expect.objectContaining({
        data_item_ids: ["fact-1"], // Updated to survivor
      })
    );

    // Fact should have been removed
    expect(state.human_fact_remove).toHaveBeenCalledWith("fact-2");
  });

  it("adds new merged entities with embeddings", async () => {
    const request = createMockRequest({
      data: {
        entity_type: "fact",
        entity_ids: ["fact-1", "fact-2"],
        ceremony_progress: 1,
      },
    });

    const fact1 = createFactWithEmbedding("fact-1", "Fact 1", "First fact", []);
    const fact2 = createFactWithEmbedding("fact-2", "Fact 2", "Second fact", []);

    state._human.facts = [fact1, fact2]; // Add entities for hydration

    const dedupResult = {
      update: [],
      remove: [
        { to_be_removed: "fact-1", replaced_by: "" },
        { to_be_removed: "fact-2", replaced_by: "" }
      ],
      add: [
        {
          name: "Merged Fact",
          description: "Combined from fact-1 and fact-2",
          sentiment: 0.7,
          persona_groups: ["group-a"],
        },
      ],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_fact_upsert).toHaveBeenCalledTimes(1);
    expect(state.human_fact_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Merged Fact",
        description: "Combined from fact-1 and fact-2",
        id: expect.any(String), // Generated ID
        embedding: expect.any(Array), // Computed embedding
      })
    );
  });

  it("handles all four entity types (fact, trait, topic, person)", async () => {
    const trait1: Trait = {
      id: "trait-1",
      name: "Trait 1",
      description: "Original trait",
      sentiment: 0.5,
      strength: 0.8,
      last_updated: new Date().toISOString(),
      persona_groups: [],
      embedding: new Array(384).fill(0.1),
    };

    state._human.traits = [trait1];

    const request = createMockRequest({
      data: {
        entity_type: "trait",
        entity_ids: ["trait-1"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [{ id: "trait-1", name: "Original Trait Name", description: "Updated trait" }],
      remove: [],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_trait_upsert).toHaveBeenCalledTimes(1);
    expect(state.human_trait_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "trait-1",
        description: "Updated trait",
      })
    );
  });

  it("deduplicates multiple quotes pointing to same removed entity", async () => {
    const fact1 = createFactWithEmbedding("fact-1", "Keep", "Primary", []);
    const fact2 = createFactWithEmbedding("fact-2", "Remove", "Duplicate", []);

    const quote1: Quote = {
      id: "quote-1",
      message_id: null,
      data_item_ids: ["fact-2"],
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
      data_item_ids: ["fact-2"],
      persona_groups: [],
      text: "Quote 1", // Same text as quote1
      speaker: "human",
      timestamp: new Date().toISOString(),
      start: null,
      end: null,
      created_at: new Date().toISOString(),
      created_by: "human",
    };

    state._human.facts = [fact1, fact2];
    state._human.quotes = [quote1, quote2];

    const request = createMockRequest({
      data: {
        entity_type: "fact",
        entity_ids: ["fact-1", "fact-2"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [],
      remove: [{ to_be_removed: "fact-2", replaced_by: "fact-1" }],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    // Both quotes should be updated (no deduplication in handler)
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
    const fact1: Fact = {
      id: "fact-1",
      name: "Original Name",
      description: "Original description",
      sentiment: 0.8,
      validated_date: "2026-01-01T00:00:00Z",
      last_updated: "2026-01-01T00:00:00Z",
      persona_groups: ["group-a", "group-b"],
      embedding: new Array(384).fill(0.1),
    };

    state._human.facts = [fact1];

    const request = createMockRequest({
      data: {
        entity_type: "fact",
        entity_ids: ["fact-1"],
        ceremony_progress: 1,
      },
    });

    const dedupResult = {
      update: [{ id: "fact-1", description: "Updated description" }],
      remove: [],
      add: [],
    };

    const response = createMockResponse(request, dedupResult);

    await handlers[LLMNextStep.HandleDedupCurate](response, state as unknown as StateManager);

    expect(state.human_fact_upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "fact-1",
        name: "Original Name", // Preserved
        description: "Updated description",
        sentiment: 0.8, // Preserved
        persona_groups: ["group-a", "group-b"], // Preserved
      })
    );
  });
});
